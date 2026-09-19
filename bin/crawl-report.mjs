#!/usr/bin/env node
// crawl-report — render findings as Markdown and JSON.
// Reads crawl-verify output from stdin. Never calls an unverified lead a
// bug. Writes Markdown to stdout (or --out FILE) and a JSON summary to
// stderr... no: JSON goes to --json FILE when given. Keep it simple.
import fs from 'node:fs';
import { readStdinJson, asArray, fail } from '../lib/io.mjs';

const args = process.argv.slice(2);
let outFile = null, jsonFile = null, stats = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out' && args[i + 1]) outFile = args[++i];
  else if (a === '--json' && args[i + 1]) jsonFile = args[++i];
  else if (a === '--stats' && args[i + 1]) stats = JSON.parse(args[++i]);
  else if (a === '--help' || a === '-h') {
    console.log('usage: crawl-report [--out report.md] [--json report.json] [--stats \'{...}\'] < verified.json');
    process.exit(0);
  } else fail(`unknown arg ${a}`, 64);
}

const input = await readStdinJson();
if (!input) fail('no verified findings on stdin', 64);
const findings = asArray(input);

const bugs = findings.filter((f) => f.status === 'bug');
const leads = findings.filter((f) => f.status === 'unverified-lead');
const escalated = findings.filter((f) => f.status === 'escalated');

const L = [];
L.push('# Crawl report');
L.push('');
L.push(`Findings: ${bugs.length} bug${bugs.length === 1 ? '' : 's'} (artifact attached, reproducer not executed), ` +
  `${leads.length} unverified lead${leads.length === 1 ? '' : 's'}, ${escalated.length} escalated.`);
L.push('');
L.push('> Unverified leads are not bugs. They are leads that did not survive verification.');
L.push('');

const renderFinding = (f) => {
  const n = f.node || {};
  const p = f.judgment?.answers?.bug_likely?.probability;
  const conf = f.judgment?.answers?.bug_likely?.confidence;
  const risk = f.judgment?.answers?.risk?.score;
  const lines = [];
  lines.push(`## ${n.file || '?'} :: ${n.symbol || '?'} (${n.scope || '<file>'})`);
  lines.push('');
  lines.push(`- verdict: ${f.judgment?.routing || '?'}${risk != null ? `, risk ${risk}/3 (band)` : ''}${p != null ? `, bug_likely P${p.toFixed(2)} (ranking signal, not calibrated confidence)` : ''}${conf != null ? `, Jev confidence ${conf.toFixed(2)} (vendor-reported, uncalibrated)` : ''}`);
  lines.push(`- depth: ${n.depth ?? 0}, relation: ${n.relation || n.seed?.type || 'seed'}`);
  if (f.note) lines.push(`- note: ${f.note}`);
  if (f.artifact) {
    lines.push('');
    lines.push('```');
    lines.push(f.artifact.text);
    lines.push('```');
  }
  return lines.join('\n');
};

if (bugs.length) {
  L.push('# Bugs (artifact attached, reproducer not executed in v0)');
  L.push('');
  for (const f of bugs) L.push(renderFinding(f), '');
}
if (leads.length) {
  L.push('# Unverified leads (not bugs)');
  L.push('');
  for (const f of leads) L.push(renderFinding(f), '');
}
if (escalated.length) {
  L.push('# Escalated to a human');
  L.push('');
  for (const f of escalated) L.push(renderFinding(f), '');
}
if (stats) {
  L.push('# Crawl stats');
  L.push('');
  L.push(`- nodes visited: ${stats.nodesVisited ?? '?'}`);
  L.push(`- judgments: ${stats.judgments ?? '?'} (Jev calls)`);
  L.push(`- pruned: ${stats.pruned ?? '?'}, expanded: ${stats.expanded ?? '?'}`);
  L.push(`- est. Jev cost: $${(stats.estCostUsd ?? 0).toFixed(5)}`);
  L.push(`- termination: ${stats.termination || '?'}`);
  L.push('');
}

const md = L.join('\n');
if (outFile) fs.writeFileSync(outFile, md);
else process.stdout.write(md + '\n');
if (jsonFile) fs.writeFileSync(jsonFile, JSON.stringify(findings, null, 1));
