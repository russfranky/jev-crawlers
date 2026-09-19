#!/usr/bin/env node
// run-cost-eval.mjs — U10: measure real end-to-end crawl cost on N nodes.
//
// Named experiment from docs/ASSUMPTIONS.md U10: run a 500-node crawl and
// measure actual input tokens and spend. The only costed operation in the
// pipeline is the Jev judgment (seed/expand/verify/report are mechanical),
// so this script runs the REAL seeder and the REAL crawl-judge on N seed
// nodes, in parallel batches (the M14 setup: 6 parallel), and aggregates
// the gateway-reported usage and marketCost.
//
// Safety: the tooling has NO secret redaction (verified 2026-09-19; only
// .env files are excluded via .crawlersignore). Every node excerpt is
// scanned for secret-shaped values BEFORE any byte is sent; hits are
// dropped and counted, never transmitted.
//
// Usage: node examples/cost-eval/run-cost-eval.mjs --repo PATH [--nodes 500] [--parallel 6]
// Writes results JSON next to this script; prints the cost summary.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const require = createRequire(import.meta.url);
const { fileExcerpt } = require(path.join(ROOT, 'lib', 'search.mjs'));

const args = process.argv.slice(2);
let repo = null, N = 500, K = 6;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--repo' && args[i + 1]) repo = path.resolve(args[++i]);
  else if (a === '--nodes' && args[i + 1]) N = parseInt(args[++i], 10);
  else if (a === '--parallel' && args[i + 1]) K = parseInt(args[++i], 10);
  else if (a === '--help' || a === '-h') {
    console.log('usage: run-cost-eval.mjs --repo PATH [--nodes 500] [--parallel 6]');
    process.exit(0);
  } else { console.error(`unknown arg ${a}`); process.exit(64); }
}
if (!repo) { console.error('--repo is required'); process.exit(64); }

// Secret-shaped values. Names only are fine (the auth seeder fires on
// names); these patterns require a VALUE shape.
const SECRET_RES = [
  ['vercel-ai-key', /vck_[A-Za-z0-9_-]{16,}/],
  ['surrogate', /hsurr:[A-Za-z0-9_-]+/],
  ['stripe-live', /sk-live-[A-Za-z0-9]{8,}/],
  ['stripe-test', /sk-test-[A-Za-z0-9]{8,}/],
  ['aws-key', /AKIA[0-9A-Z]{16}/],
  ['github-pat', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['slack-token', /xox[bpas]-[A-Za-z0-9-]{8,}/],
  ['gcp-key', /AIza[0-9A-Za-z_-]{30,}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['assigned-secret', /["']?(?:password|passwd|pwd|api[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token)["']?\s*[:=]\s*["'][^"']{6,}["']/i],
];
function secretHits(text) {
  const hits = [];
  for (const [name, re] of SECRET_RES) if (re.test(text)) hits.push(name);
  return hits;
}

// 1. Real seeder.
console.error('seeding...');
const seedRes = spawnSync('node', [path.join(ROOT, 'bin', 'crawl-seed.mjs'),
  '--repo', repo, '--patterns', '--todo'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (seedRes.status !== 0) { console.error('crawl-seed failed:', seedRes.stderr?.slice(0, 1000)); process.exit(1); }
let seeds = JSON.parse(seedRes.stdout);
console.error(`seeds: ${seeds.length}`);

// 2. Top-N by priority (deterministic tie-break), excerpts like the driver.
seeds.sort((a, b) => (b.priority - a.priority) || (a.file < b.file ? -1 : 1) || (a.seed.type < b.seed.type ? -1 : 1));
const picked = seeds.slice(0, N);
let secretDropped = 0;
const secretFiles = new Set();
const nodes = [];
for (const s of picked) {
  const { excerpt, symbolLine } = fileExcerpt(repo, s.file, 1, 30);
  const body = `${excerpt}\n${s.seed.evidence}`;
  const hits = secretHits(body);
  if (hits.length) { secretDropped++; secretFiles.add(s.file); continue; }
  nodes.push({ ...s, excerpt, symbolLine });
}
console.error(`nodes after secret scan: ${nodes.length} (dropped ${secretDropped} with secret-shaped values)`);

// 3. Judge in parallel batches of K via the real crawl-judge CLI.
function judgeOne(node) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn('node', [path.join(ROOT, 'bin', 'crawl-judge.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve({ node, error: 'timeout' }); }, 90000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ node, error: `exit ${code}: ${err.slice(0, 200)}` });
      try {
        const [res] = JSON.parse(out);
        resolve({ node, judgment: res.judgment, cliMs: Date.now() - t0 });
      } catch (e) { resolve({ node, error: `parse: ${String(e.message).slice(0, 120)}` }); }
    });
    p.stdin.write(JSON.stringify(node));
    p.stdin.end();
  });
}

console.error(`judging ${nodes.length} nodes in parallel batches of ${K}...`);
const t0 = Date.now();
const results = [];
for (let i = 0; i < nodes.length; i += K) {
  const batch = await Promise.all(nodes.slice(i, i + K).map(judgeOne));
  results.push(...batch);
  if ((i / K) % 10 === 0) console.error(`  ${Math.min(i + K, nodes.length)}/${nodes.length}`);
}
const wallMs = Date.now() - t0;

// 4. Aggregate.
const ok = results.filter((r) => r.judgment);
const failed = results.filter((r) => r.error);
let inTok = 0, outTok = 0, cost = 0, costMissing = 0, latSum = 0, truncated = 0;
const routings = {};
for (const r of ok) {
  const j = r.judgment;
  inTok += j.usage?.inputTokens ?? 0;
  outTok += j.usage?.outputTokens ?? 0;
  if (typeof j.marketCostUsd === 'number' && j.marketCostUsd >= 0) cost += j.marketCostUsd;
  else costMissing++;
  latSum += j.latencyMs || 0;
  if (j.truncated?.length) truncated++;
  routings[j.routing] = (routings[j.routing] || 0) + 1;
}
const summary = {
  date: new Date().toISOString().slice(0, 10),
  repo, seedsTotal: seeds.length, nodesRequested: N,
  nodesJudged: ok.length, nodesFailed: failed.length,
  secretDropped, secretFiles: secretFiles.size,
  parallel: K, wallMs, wallMin: +(wallMs / 60000).toFixed(1),
  inputTokens: inTok, outputTokens: outTok,
  meanInputTokens: ok.length ? Math.round(inTok / ok.length) : 0,
  spendUsd: +cost.toFixed(5),
  spendMissingMarketCost: costMissing,
  meanSpendPerNodeUsd: ok.length ? +((cost / ok.length).toFixed(6)) : 0,
  meanLatencyMs: ok.length ? Math.round(latSum / ok.length) : 0,
  truncatedNodes: truncated,
  routings,
  errors: failed.slice(0, 5).map((f) => ({ id: f.node.id, error: f.error })),
};
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIR, `results-${stamp}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
