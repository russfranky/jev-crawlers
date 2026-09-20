#!/usr/bin/env node
// run-labeled-eval.mjs — measure the judge on a labeled node set.
// Ground truth lives OUTSIDE the node state: the judge never sees labels.
// Usage: node examples/labeled-eval/run-labeled-eval.mjs [--dry-run]
// Writes results JSON next to this script; prints a metrics summary.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const dryRun = process.argv.includes('--dry-run');

// Ground truth, labeled by construction. Never placed in the node state.
const LABELS = {
  'bugs.js::totalBroken': { label: 'bug', bugType: 'off-by-one' },
  'bugs.js::zipOf': { label: 'bug', bugType: 'nil-deref' },
  'bugs.js::applyDiscount': { label: 'bug', bugType: 'injection' },
  'bugs.js::STRIPE_KEY': { label: 'bug', bugType: 'hardcoded-secret' },
  'bugs.js::parseQty': { label: 'bug', bugType: 'radix' },
  'bugs.js::chargeAmount': { label: 'bug', bugType: 'float-money' },
  'benign.js::clamp': { label: 'benign' },
  'benign.js::newCart': { label: 'benign' },
  'benign.js::zipOfSafe': { label: 'benign' },
  'benign.js::addItemSafe': { label: 'benign' },
  'benign.js::totalFixed': { label: 'benign' },
  'benign.js::VERSION': { label: 'benign' },
};

function symbolsOf(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const lines = src.split('\n');
  const out = [];
  const re = /^export (?:(?:async )?function|const|let|var)\s+([A-Za-z_$][\w$]*)/;
  lines.forEach((ln, i) => {
    const m = ln.match(re);
    if (m) out.push({ symbol: m[1], line: i + 1 });
  });
  return out;
}

const nodes = [];
for (const file of ['bugs.js', 'benign.js']) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  for (const { symbol, line } of symbolsOf(file)) {
    const id = `${file}::${symbol}`;
    if (!LABELS[id]) continue;
    nodes.push({
      id,
      file: `examples/labeled-eval/${file}`,
      symbol,
      scope: '<file>',
      kind: 'eval',
      depth: 0,
      seed: { type: 'labeled-eval', evidence: 'node from labeled eval fixture; assess on the code alone' },
      excerpt: src,
      symbolLine: line,
      evidence: [],
    });
  }
}
console.error(`built ${nodes.length} nodes`);

const args = [path.join(ROOT, 'bin', 'jev-judge.mjs')];
if (dryRun) args.push('--dry-run');
const res = spawnSync('node', args, { input: JSON.stringify(nodes), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (res.status !== 0) {
  console.error('judge failed:', res.stderr?.slice(0, 2000));
  process.exit(1);
}
const judged = res.stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// Metrics against ground truth (judge never saw labels).
const rows = judged.map((j) => {
  const truth = LABELS[j.node.id].label;
  const a = j.judgment.answers || {};
  const risk = a.risk?.score ?? null;
  const bugLikely = a.bug_likely?.probability ?? null;
  return {
    id: j.node.id,
    truth,
    bugType: LABELS[j.node.id].bugType || null,
    verdict: a.verdict?.choice || null,
    risk,
    riskBand: risk == null ? null : risk >= 2 ? 'high' : risk >= 1 ? 'mid' : 'low',
    bugLikely,
    routing: j.judgment.routing || null,
    latencyMs: j.judgment.latencyMs ?? null,
    estCost: j.judgment.marketCostUsd ?? null,
  };
});

const bugs = rows.filter((r) => r.truth === 'bug');
const benign = rows.filter((r) => r.truth === 'benign');
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const band = (rows, b) => rows.filter((r) => r.riskBand === b).length;

// Pairwise concordance of bug_likely: P(bug outranks benign).
let wins = 0, ties = 0, pairs = 0;
for (const b of bugs) for (const n of benign) {
  if (b.bugLikely == null || n.bugLikely == null) continue;
  pairs++;
  if (b.bugLikely > n.bugLikely) wins++;
  else if (b.bugLikely === n.bugLikely) ties++;
}
const concordance = pairs ? (wins + 0.5 * ties) / pairs : null;

const summary = {
  n: rows.length,
  bugs: bugs.length,
  benign: benign.length,
  riskBands: {
    bug: { high: band(bugs, 'high'), mid: band(bugs, 'mid'), low: band(bugs, 'low') },
    benign: { high: band(benign, 'high'), mid: band(benign, 'mid'), low: band(benign, 'low') },
  },
  meanRisk: { bug: +mean(bugs.map((r) => r.risk)).toFixed(2), benign: +mean(benign.map((r) => r.risk)).toFixed(2) },
  bugLikelyConcordance: concordance == null ? null : +concordance.toFixed(3),
  routing: {
    bug: Object.fromEntries([...new Set(bugs.map((r) => r.routing))].map((k) => [k, bugs.filter((r) => r.routing === k).length])),
    benign: Object.fromEntries([...new Set(benign.map((r) => r.routing))].map((k) => [k, benign.filter((r) => r.routing === k).length])),
  },
  meanLatencyMs: Math.round(mean(rows.map((r) => r.latencyMs || 0))),
  estCostUsd: +rows.reduce((s, r) => s + (r.estCost || 0), 0).toFixed(5),
};

const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIR, `results-${stamp}.json`), JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
