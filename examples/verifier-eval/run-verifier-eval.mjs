#!/usr/bin/env node
// run-verifier-eval.mjs — U7: does verifier grounding approximate bug validity?
//
// Named experiment from docs/ASSUMPTIONS.md U7: a file-report judgment with
// real pipeline evidence on a human-confirmed bug. The 12 labeled nodes come
// from examples/labeled-eval (ground truth by construction; labels never
// enter the node state). Evidence strings are byte-identical to real
// crawl-seed output on the fixture (mapped to symbols by line range).
//
// Design (verifier isolation):
//   - The judge runs for real on all 12 nodes (labels withheld).
//   - The verifier is deterministic (no Jev calls), so every variant is free.
//   - Primary measurement (V-attached x R-forced): the full production
//     chain — every node carries the seeder's real structured evidence
//     items verbatim, the driver's attach step (bin/crawl.mjs, via
//     lib/evidence.mjs) attaches the node's own cited code locations into
//     the judgment record, and routing is forced to file-report while
//     keeping the judge's REAL answers. This isolates the verifier: given
//     a bug claim with everything the pipeline knows, does its
//     grounded/demoted decision track ground truth?
//   - Context: R-natural (the judge's real routing; non-file-report nodes
//     are escalated or skipped by crawl-verify, as in production).
//   - Control: V-stripped x R-forced (evidence removed; the verifier must
//     demote everything, proving it requires real evidence).
//
// Metrics: verifier precision = accepted bugs / all accepted;
//          verifier recall   = accepted bugs / 6 true bugs.
// Plus a reason breakdown: risk-floor demotions vs grounding-gap demotions.
//
// Usage: node examples/verifier-eval/run-verifier-eval.mjs
// Writes results JSON next to this script; prints the metrics.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachEvidence } from '../../lib/evidence.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const FIXTURE = path.join(ROOT, 'examples', 'labeled-eval');

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
  const src = fs.readFileSync(path.join(FIXTURE, file), 'utf8');
  const lines = src.split('\n');
  const re = /^export (?:(?:async )?function|const|let|var)\s+([A-Za-z_$][\w$]*)/;
  const syms = [];
  lines.forEach((ln, i) => {
    const m = ln.match(re);
    if (m) syms.push({ symbol: m[1], start: i + 1 });
  });
  syms.forEach((s, i) => { s.end = i + 1 < syms.length ? syms[i + 1].start - 1 : lines.length; });
  return { src, syms };
}

// Real seeder evidence: run the shipped crawl-seed on the fixture and use
// its structured evidence items verbatim (byte-identical by construction).
const seedRes = spawnSync('node', [path.join(ROOT, 'bin', 'crawl-seed.mjs'),
  '--repo', FIXTURE, '--patterns', '--todo'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (seedRes.status !== 0) { console.error('crawl-seed failed:', seedRes.stderr?.slice(0, 1000)); process.exit(1); }
const seeds = JSON.parse(seedRes.stdout);
console.error(`real seeder fired ${seeds.length} seeds on the fixture`);

// Build per-symbol nodes; attach the seeder's real structured evidence
// items whose file:line falls inside the symbol's line range. Item files
// are rewritten to repo-relative paths so the verifier's on-disk check
// resolves them.
const nodes = [];
for (const file of ['bugs.js', 'benign.js']) {
  const { src, syms } = symbolsOf(file);
  for (const { symbol, start, end } of syms) {
    const id = `${file}::${symbol}`;
    if (!LABELS[id]) continue;
    const items = [];
    let seedType = null, seedEv = null;
    for (const s of seeds) {
      if (s.file !== file) continue;
      for (const it of (s.evidence || [])) {
        if (it.line >= start && it.line <= end) {
          items.push({ ...it, file: `examples/labeled-eval/${file}` });
          if (!seedType) { seedType = s.seed.type; seedEv = s.seed.evidence; }
        }
      }
    }
    nodes.push({ id, file: `examples/labeled-eval/${file}`, symbol, scope: '<file>',
      kind: 'eval', depth: 0, symbolLine: start, excerpt: src,
      seed: { type: seedType || 'labeled-eval', evidence: seedEv || 'node from labeled eval fixture; assess on the code alone' },
      evidence: items });
  }
}
const withEv = nodes.filter((n) => n.evidence.length).length;
console.error(`nodes with real seeder evidence attached: ${withEv}/${nodes.length}`);

// Judge all 12 for real (labels withheld from the judge).
const judgeRes = spawnSync('node', [path.join(ROOT, 'bin', 'crawl-judge.mjs')],
  { input: JSON.stringify(nodes), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (judgeRes.status !== 0) { console.error('judge failed:', judgeRes.stderr?.slice(0, 2000)); process.exit(1); }
const judged = JSON.parse(judgeRes.stdout);
console.error(`judged ${judged.length} nodes`);

function runVerify(pairs) {
  const res = spawnSync('node', [path.join(ROOT, 'bin', 'crawl-verify.mjs'), '--repo', ROOT],
    { input: JSON.stringify(pairs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) { console.error('verify failed:', res.stderr?.slice(0, 1000)); process.exit(1); }
  return JSON.parse(res.stdout);
}

const truthOf = (node) => LABELS[`${path.basename(node.file)}::${node.symbol}`].label;

function metrics(findings, name) {
  const rows = findings.map((f) => ({
    id: `${path.basename(f.node.file)}::${f.node.symbol}`,
    truth: truthOf(f.node),
    routingIn: f.judgment.routing,
    risk: f.judgment.answers?.risk?.score ?? null,
    status: f.status,
    note: f.note,
  }));
  const accepted = rows.filter((r) => r.status === 'bug');
  const accBugs = accepted.filter((r) => r.truth === 'bug').length;
  const accBenign = accepted.filter((r) => r.truth === 'benign').length;
  const demoted = rows.filter((r) => r.status === 'unverified-lead');
  return {
    variant: name, n: rows.length,
    acceptedBugs: accBugs, acceptedBenign: accBenign,
    demotedBugs: demoted.filter((r) => r.truth === 'bug').length,
    demotedBenign: demoted.filter((r) => r.truth === 'benign').length,
    escalatedOrSkipped: rows.filter((r) => r.status === 'escalated').length,
    precision: (accBugs + accBenign) ? +(accBugs / (accBugs + accBenign)).toFixed(3) : null,
    recall: +(accBugs / 6).toFixed(3),
    rows,
  };
}

// Mirror the driver's attach step (bin/crawl.mjs): before verification,
// the driver attaches the node's own cited code locations
// (lib/evidence.mjs) into the judgment record, so the verifier grounds
// against judge artifact + node evidence + disk.
function withAttached(node, judgment) {
  const j = { ...judgment };
  j.attachedEvidence = attachEvidence(node);
  return { node, judgment: j };
}

// Variant A (primary, verifier isolation): the full production chain —
// real seeder evidence on the node, the driver's attach step on the
// judgment, routing forced to file-report while keeping the judge's REAL
// answers. This isolates the verifier: given a bug claim with everything
// the pipeline knows, does its grounded/demoted decision track truth?
const forcedA = judged.map(({ node, judgment }) => {
  const p = withAttached(node, judgment);
  p.judgment.routing = 'file-report';
  return p;
});
const mA = metrics(runVerify(forcedA), 'V-attached x R-forced (primary)');

// Variant B (context): the judge's real routing, as production would run it.
const mB = metrics(runVerify(judged.map(({ node, judgment }) => withAttached(node, judgment))),
  'V-attached x R-natural (production routing)');

// Variant C (control): evidence stripped. The fixed verifier must demote
// everything here — it proves the verifier now requires real evidence,
// the exact failure mode of the old pipeline.
const forcedC = judged.map(({ node, judgment }) => {
  const p = withAttached(
    { ...node, evidence: [], symbolLine: 0, seed: { type: 'none', evidence: '' } },
    judgment);
  p.judgment.routing = 'file-report';
  return p;
});
const mC = metrics(runVerify(forcedC), 'V-stripped x R-forced (control)');

const summary = {
  date: new Date().toISOString().slice(0, 10),
  n: 12, bugs: 6, benign: 6,
  judgeRoutings: Object.fromEntries([...new Set(judged.map((j) => j.judgment.routing))]
    .map((k) => [k, judged.filter((j) => j.judgment.routing === k).length])),
  judgeRoutingsByClass: {
    bug: judged.filter((j) => truthOf(j.node) === 'bug').map((j) => `${path.basename(j.node.file)}::${j.node.symbol}=${j.judgment.routing}`),
    benign: judged.filter((j) => truthOf(j.node) === 'benign').map((j) => `${path.basename(j.node.file)}::${j.node.symbol}=${j.judgment.routing}`),
  },
  variants: [mA, mB, mC],
};

const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIR, `results-${stamp}.json`), JSON.stringify(summary, null, 2));
for (const m of [mA, mB, mC]) {
  console.log(`\n== ${m.variant} ==`);
  console.log(`accepted bugs ${m.acceptedBugs}/6, accepted benign ${m.acceptedBenign}/6, ` +
    `demoted bugs ${m.demotedBugs}, demoted benign ${m.demotedBenign}, escalated ${m.escalatedOrSkipped}`);
  console.log(`verifier precision ${m.precision}, recall ${m.recall}`);
}
console.log('\n-- demotion reasons (primary variant) --');
for (const r of mA.rows.filter((x) => x.status !== 'bug')) console.log(`${r.id} [${r.truth}] -> ${r.status}: ${r.note}`);
console.log('\n-- accepted (primary variant) --');
for (const r of mA.rows.filter((x) => x.status === 'bug')) console.log(`${r.id} [${r.truth}] risk=${r.risk}`);
