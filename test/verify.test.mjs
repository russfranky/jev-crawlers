// test/verify.test.mjs — regression tests for D-008 (jev-verify checkOnDisk).
//
// checkOnDisk is module-private, so these exercise it through the exported
// pipeline: records are piped into `bin/jev-verify.mjs --repo <tmpdir>`
// and the finding statuses / demotion notes are asserted.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/jev-verify.mjs');

// Fixture repo:
//   code.js — 4 real lines (one blank interior line) + trailing '\n',
//             so line 5 is the phantom trailing-newline line ('').
//   empty.js — 0 bytes.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-verify-test-'));
fs.writeFileSync(path.join(repo, 'code.js'), 'const a = 1;\nconst b = 2;\n\nconst c = 3;\n');
fs.writeFileSync(path.join(repo, 'empty.js'), '');
after(() => fs.rmSync(repo, { recursive: true, force: true }));

async function verify(records) {
  // NOTE: child_process.execFile's `input` option does not close the child's
  // stdin on Node 24 (the child hangs waiting for EOF), so write + end the
  // stream explicitly with spawn.
  const input = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const child = spawn(process.execPath, [BIN, '--repo', repo], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdin.write(input);
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, `jev-verify exited ${code}: ${stderr.slice(0, 300)}`);
  return stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const judgment = () => ({
  routing: 'file-report',
  answers: { verdict: { choice: 'report' }, risk: { score: 2 } },
});

const node = (file, evidence) => ({
  file,
  symbol: 'a',
  symbolLine: 1,
  scope: '<top>',
  excerpt: file === 'empty.js' ? 'x' : 'const a = 1;\nconst b = 2;\n\nconst c = 3;\n',
  evidence,
});

const cite = (file, line, text) => ({ kind: 'code', file, line, text });

test('D-008: phantom trailing-newline line with fabricated text fails grounding', async () => {
  const [finding] = await verify([{ node: node('code.js', [cite('code.js', 5, 'totally fabricated line')]), judgment: judgment() }]);
  assert.equal(finding.status, 'unverified-lead');
  assert.ok(finding.note.includes('content mismatch'), `note was: ${finding.note}`);
  assert.ok(finding.note.includes('code.js:5'), `note was: ${finding.note}`);
});

test('D-008: phantom line with empty cited text still grounds (no false positive)', async () => {
  const [finding] = await verify([{ node: node('code.js', [cite('code.js', 5, '')]), judgment: judgment() }]);
  assert.equal(finding.status, 'bug');
});

test('D-008: legitimate blank interior line with empty cited text still grounds', async () => {
  const [finding] = await verify([{ node: node('code.js', [cite('code.js', 3, '')]), judgment: judgment() }]);
  assert.equal(finding.status, 'bug');
});

test('D-008: blank interior line with fabricated text fails grounding', async () => {
  const [finding] = await verify([{ node: node('code.js', [cite('code.js', 3, 'not blank at all')]), judgment: judgment() }]);
  assert.equal(finding.status, 'unverified-lead');
  assert.ok(finding.note.includes('content mismatch'), `note was: ${finding.note}`);
});

test('D-008: empty file reports out-of-range, not not-found', async () => {
  const [finding] = await verify([{ node: node('empty.js', [cite('empty.js', 1, 'anything at all')]), judgment: judgment() }]);
  assert.equal(finding.status, 'unverified-lead');
  assert.ok(finding.note.includes('out of range (empty file)'), `note was: ${finding.note}`);
  assert.ok(!finding.note.includes('file not found on disk:'), `note was: ${finding.note}`);
});

test('D-008: normal matching line still grounds', async () => {
  const [finding] = await verify([{ node: node('code.js', [cite('code.js', 2, 'const b = 2;')]), judgment: judgment() }]);
  assert.equal(finding.status, 'bug');
});

test('D-008: normal mismatching line still demotes', async () => {
  const [finding] = await verify([{ node: node('code.js', [cite('code.js', 2, 'something else entirely')]), judgment: judgment() }]);
  assert.equal(finding.status, 'unverified-lead');
  assert.ok(finding.note.includes('content mismatch'), `note was: ${finding.note}`);
});

test('D-008: genuinely missing file still reports not-found', async () => {
  const [finding] = await verify([{ node: node('code.js', [cite('nope.js', 1, 'x')]), judgment: judgment() }]);
  assert.equal(finding.status, 'unverified-lead');
  assert.ok(finding.note.includes('file not found on disk: nope.js'), `note was: ${finding.note}`);
});
