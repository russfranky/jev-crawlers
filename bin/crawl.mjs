#!/usr/bin/env node
// crawl — the stateful driver. It owns recursion; the four primitives are
// interfaces, not the architecture.
//
//   crawl-seed -> [ frontier -> judge -> expand ]* -> crawl-verify -> crawl-report
//
// The driver keeps: canonical node identity (file+symbol+scope), a visited
// set, and a priority frontier. Termination: budget spent, depth cap,
// empty frontier, or the diminishing-returns gate (8 straight low-risk
// outcomes: pruned or sent to the review queue, all in the low risk band).
// Judgment calls Jev; expansion is mechanical.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Frontier, childPriority, nodeId, withId } from '../lib/graph.mjs';
import { fileExcerpt } from '../lib/search.mjs';
import { attachEvidence } from '../lib/evidence.mjs';
import { fail } from '../lib/io.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let repo = process.cwd(), seedKinds = [], base = 'HEAD', budget = 60, maxDepth = 6,
  decay = 0.85, maxChildren = 12, outFile = null, jsonFile = null, dryRun = false,
  only = null, statsJson = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--repo' && args[i + 1]) repo = args[++i];
  else if (a === '--seed' && args[i + 1]) seedKinds.push(args[++i]);
  else if (a === '--base' && args[i + 1]) base = args[++i];
  else if (a === '--budget' && args[i + 1]) budget = parseInt(args[++i], 10);
  else if (a === '--depth' && args[i + 1]) maxDepth = parseInt(args[++i], 10);
  else if (a === '--decay' && args[i + 1]) decay = parseFloat(args[++i]);
  else if (a === '--max-children' && args[i + 1]) maxChildren = parseInt(args[++i], 10);
  else if (a === '--only' && args[i + 1]) only = args[++i];
  else if (a === '--out' && args[i + 1]) outFile = args[++i];
  else if (a === '--json' && args[i + 1]) jsonFile = args[++i];
  else if (a === '--stats-json') statsJson = true;
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--help' || a === '-h') {
    console.log(`usage: crawl --repo PATH [--seed diff|todo|patterns] [--base HEAD] [--budget 60]
             [--depth 6] [--decay 0.85] [--max-children 12] [--only a.js,b.js]
             [--out report.md] [--json report.json] [--stats-json] [--dry-run]`);
    process.exit(0);
  } else fail(`unknown arg ${a}`, 64);
}
if (!seedKinds.length) seedKinds = ['diff', 'todo', 'patterns'];
repo = path.resolve(repo); // children run with cwd=repo; keep the path absolute

const t0 = Date.now();
const run = (bin, binArgs, stdinJson) => {
  const res = execFileSync('node', [path.join(HERE, bin), ...binArgs], {
    cwd: repo, encoding: 'utf8', env: process.env,
    input: stdinJson != null ? JSON.stringify(stdinJson) : undefined,
    stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(res);
};

// 1. Seed.
const seedArgs = ['--repo', repo, '--base', base, ...(only ? ['--only', only] : [])];
for (const s of seedKinds) seedArgs.push('--' + s);
let seeds;
try {
  seeds = run('crawl-seed.mjs', seedArgs, null);
} catch (e) { fail(`crawl-seed failed: ${e.message}`, 2); }
for (const s of seeds) {
  withId(s);
  const { excerpt, symbolLine } = fileExcerpt(repo, s.file, 1, 30);
  s.excerpt = excerpt; s.symbolLine = symbolLine;
}

const frontier = new Frontier();
const visited = new Set();
for (const s of seeds) frontier.push(s);

const candidates = [];      // file-report | needs-artifact | escalate-owner | review-queue, for crawl-verify
let judged = 0, pruned = 0, expanded = 0, depthCapped = 0;
let estCostUsd = 0, totalLatencyMs = 0;
const recent = [];          // last judgments, for the diminishing-returns gate
let termination = 'frontier-empty';

const stubJudgment = (node) => ({
  answers: {
    verdict: { choice: 'expand', probabilities: { expand: 1 }, top_probability: 1 },
    bug_likely: { probability: 0.5 },
    risk: { score: 1 },
    artifact_stated: { probability: 0 },
  },
  routing: 'expand-node', meaning: 'dry-run stub', latencyMs: 0, dryRun: true,
});

while (frontier.size > 0) {
  const node = frontier.pop();
  if (visited.has(node.id)) continue;
  visited.add(node.id);
  if ((node.depth ?? 0) > maxDepth) { depthCapped++; continue; }
  if (judged >= budget) { termination = 'budget-exhausted'; break; }

  let judgment;
  if (dryRun) {
    judgment = stubJudgment(node);
  } else {
    try {
      const [res] = run('crawl-judge.mjs', [], node);
      judgment = res.judgment;
    } catch (e) {
      process.stderr.write(`crawl: judge failed on ${node.id}, treating as review: ${e.message.slice(0, 120)}\n`);
      candidates.push({ node, judgment: { routing: 'escalate-owner', answers: {}, note: 'judge error' } });
      continue;
    }
  }
  judged++;
  totalLatencyMs += judgment.latencyMs || 0;
  // Prefer the gateway-reported list cost when present (M13); the M2
  // estimate is the fallback.
  if (!dryRun) estCostUsd += (typeof judgment.marketCostUsd === 'number' && judgment.marketCostUsd >= 0)
    ? judgment.marketCostUsd : 0.00008;

  const bugP = judgment.answers?.bug_likely?.probability ?? 0;
  const risk = judgment.answers?.risk?.score ?? 0;
  recent.push({ routing: judgment.routing, bugP, risk });
  if (recent.length > 8) recent.shift();

  const routing = judgment.routing || 'auto-prune';
  if (routing === 'expand-node') {
    expanded++;
    if ((node.depth ?? 0) >= maxDepth) continue;
    let children = [];
    try {
      children = run('crawl-expand.mjs', ['--repo', repo, '--max-children', String(maxChildren)], node);
    } catch (e) {
      process.stderr.write(`crawl: expand failed on ${node.id}: ${e.message.slice(0, 120)}\n`);
    }
    for (const c of children) {
      withId(c);
      if (visited.has(c.id)) continue;
      c.priority = childPriority(node, judgment, decay);
      frontier.push(c);
    }
  } else if (routing === 'auto-prune') {
    pruned++;
  } else {
    // Before verification, attach the node's own cited code locations into
    // the judgment record (lib/evidence.mjs), so crawl-verify grounds the
    // claim against judge artifact + node evidence + disk.
    judgment.attachedEvidence = attachEvidence(node);
    candidates.push({ node, judgment }); // file-report | needs-artifact | escalate-owner
  }

  // Diminishing-returns gate: 8 straight low-risk outcomes (pruned or sent
  // to the review queue, all in the low risk band). The crawl is no longer
  // finding anything worth a human's time. Uses the risk score band, never
  // a raw boolean.
  if (recent.length === 8 && recent.every((r) => (r.routing === 'auto-prune' || r.routing === 'review-queue') && r.risk < 1)) {
    termination = 'diminishing-returns';
    break;
  }
}
if (termination === 'frontier-empty' && judged >= budget) termination = 'budget-exhausted';

const stats = {
  nodesVisited: visited.size, seeds: seeds.length, judgments: judged,
  pruned, expanded, depthCapped,
  candidates: candidates.length,
  estCostUsd: Math.round(estCostUsd * 100000) / 100000,
  avgLatencyMs: judged ? Math.round(totalLatencyMs / judged) : 0,
  wallMs: Date.now() - t0, termination, dryRun,
};

// 2. Verify, then 3. report.
let verified = [];
if (candidates.length) {
  try {
    verified = run('crawl-verify.mjs', [], candidates);
  } catch (e) { fail(`crawl-verify failed: ${e.message}`, 2); }
}
let report = '';
try {
  const reportArgs = ['--stats', JSON.stringify(stats)];
  if (outFile) reportArgs.push('--out', outFile);
  if (jsonFile) reportArgs.push('--json', jsonFile);
  report = execFileSync('node', [path.join(HERE, 'crawl-report.mjs'), ...reportArgs], {
    cwd: repo, encoding: 'utf8', env: process.env,
    input: JSON.stringify(verified), stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) { fail(`crawl-report failed: ${e.message}`, 2); }

if (!outFile) process.stdout.write(report);
if (statsJson) process.stderr.write(JSON.stringify(stats) + '\n');
else process.stderr.write(`crawl: ${visited.size} nodes, ${judged} judgments, ` +
  `${verified.filter((v) => v.status === 'bug').length} bugs, ` +
  `${verified.filter((v) => v.status === 'unverified-lead').length} unverified leads, ` +
  `~$${stats.estCostUsd.toFixed(5)} est., done: ${termination}\n`);
