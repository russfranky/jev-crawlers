#!/usr/bin/env node
// crawl-verify — separate verifier step between judge and report.
//
// The judge can only say "this looks like a bug". The verifier assembles a
// falsifiable artifact for each report candidate and checks that it is
// grounded: it must name a real file, a real symbol, and a real line, and
// it must state the input/trigger, the wrong behavior, and a reproduction
// path. Anything that fails the check is demoted to an "unverified lead"
// and is never called a bug.
//
// v0 verification is artifact grounding, not execution: the verifier cannot
// run the reproducer. Running reproducers is on the roadmap. The report
// labels this honestly.
//
// Reads [{ node, judgment }] from stdin. Writes findings:
//   { node, judgment, status: "bug" | "unverified-lead" | "escalated",
//     artifact: { kind, text } | null }
import { readStdinJson, asArray, writeJson, fail } from '../lib/io.mjs';

const args = process.argv.slice(2);
let bugThreshold = 0.6;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--bug-threshold' && args[i + 1]) bugThreshold = parseFloat(args[++i]);
  else if (a === '--help' || a === '-h') {
    console.log('usage: crawl-verify [--bug-threshold 0.6] < judged.json');
    process.exit(0);
  } else fail(`unknown arg ${a}`, 64);
}

const input = await readStdinJson();
if (!input) fail('no judged nodes on stdin', 64);

const findings = [];
for (const { node, judgment } of asArray(input)) {
  const routing = judgment?.routing || 'auto-prune';
  if (routing === 'escalate-owner' || routing === 'needs-artifact') {
    findings.push({ node, judgment, status: 'escalated', artifact: null,
      note: routing === 'needs-artifact'
        ? 'judge saw a bug but the case is not falsifiable; human decides'
        : 'serious blast radius or ambiguous evidence; human decides' });
    continue;
  }
  if (routing !== 'file-report') continue; // expand/prune verdicts are not findings

  const bugP = judgment.answers?.bug_likely?.probability ?? 0;
  const reasons = [];
  if (bugP < bugThreshold) reasons.push(`bug_likely P${bugP.toFixed(2)} below threshold ${bugThreshold}`);
  const artifact = assembleArtifact(node, judgment);
  if (!artifact) reasons.push('no grounded artifact could be assembled');
  else {
    const gaps = groundedGaps(node, artifact);
    if (gaps.length) reasons.push(...gaps);
  }

  if (reasons.length) {
    findings.push({ node, judgment, status: 'unverified-lead', artifact: artifact || null,
      note: 'demoted: ' + reasons.join('; ') });
  } else {
    findings.push({ node, judgment, status: 'bug', artifact,
      note: 'artifact grounded in real code locations; reproducer not executed (v0)' });
  }
}

// Build the falsifiable artifact from the node's concrete evidence.
function assembleArtifact(node, judgment) {
  const evidence = [...(node.evidence || []), ...(node.seed ? [`seed(${node.seed.type}): ${node.seed.evidence}`] : [])];
  const excerpt = (node.excerpt || '').trim();
  if (!node.file || !excerpt) return null;
  const lines = [
    `REPRODUCER SKETCH for ${node.file} :: ${node.scope || '<file>'} :: ${node.symbol || '?'}`,
    `location: ${node.file}${node.symbolLine ? ':' + node.symbolLine : ''}`,
    `seed: ${node.seed ? node.seed.type : 'manual'} — ${node.seed ? node.seed.evidence : ''}`,
    'wrong behavior (per judge): ' + (judgment?.answers?.verdict?.choice === 'report' ? 'named in evidence below' : 'see evidence'),
    'evidence:',
    ...evidence.slice(0, 6).map((e) => `  - ${String(e).slice(0, 300)}`),
    'code under test:',
    ...excerpt.split('\n').slice(0, 25).map((l) => `  | ${l}`),
    'to falsify: run the sketch above against the code; if the stated wrong behavior does not occur, the finding is wrong.',
  ];
  return { kind: 'reproducer-sketch', text: lines.join('\n').slice(0, 4000) };
}

// Deterministic grounding checks: the artifact must point at real locations.
function groundedGaps(node, artifact) {
  const gaps = [];
  const t = artifact.text;
  if (!t.includes(node.file)) gaps.push('artifact does not name the file');
  if (node.symbol && node.symbol !== '?' && !t.includes(node.symbol)) gaps.push('artifact does not name the symbol');
  if (!node.excerpt || !node.excerpt.trim()) gaps.push('node has no code excerpt');
  const ev = node.evidence || [];
  const joined = ev.join('\n').toLowerCase();
  const hasTrigger = /input|trigger|call|invoke|request/.test(joined);
  const hasWrong = /wrong|incorrect|bug|fail|mismatch|off-by|leak/.test(joined);
  if (!hasTrigger) gaps.push('evidence does not name an input or trigger');
  if (!hasWrong) gaps.push('evidence does not name the wrong behavior');
  return gaps;
}

writeJson(findings);
