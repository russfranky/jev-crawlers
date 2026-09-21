import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enclosingScope, loadIgnores, grepRegex, fileExcerpt, evidenceLine } from '../lib/search.mjs';

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-search-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

test('enclosingScope finds the nearest function above the hit', () => {
  const text = 'function outer() {\n  const x = 1;\n  foo(x);\n}\n';
  assert.equal(enclosingScope(text, 3), 'outer');
  assert.equal(enclosingScope('const x = 1;\n', 1), '<file>');
});

test('enclosingScope ignores bare calls like eval(x)', () => {
  const src = 'function wrap() {\n  eval(userExpr);\n}\n';
  assert.equal(enclosingScope(src, 2), 'wrap');
});

test('loadIgnores skips node_modules and secret files', () => {
  const repo = tmpRepo({ 'src/a.js': 'ok', '.crawlersignore': 'secret/\n' });
  const ignore = loadIgnores(repo);
  assert.equal(ignore('node_modules/x.js'), true);
  assert.equal(ignore('foo.pem'), true);
  assert.equal(ignore('src/a.js'), false);
  assert.equal(ignore('secret/x.js'), true);
});

test('grepRegex reports 1-based hit lines', () => {
  const repo = tmpRepo({ 'a.js': 'alpha\nTODO: later\nomega\n' });
  const hits = grepRegex(repo, /\bTODO\b/, () => false);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'a.js');
  assert.equal(hits[0].line, 2);
});

test('fileExcerpt windows around the hit line and reports excerptStartLine', () => {
  const repo = tmpRepo({
    'f.js': Array.from({ length: 80 }, (_, i) => `line-${i + 1}`).join('\n'),
  });
  const { excerpt, symbolLine, excerptStartLine } = fileExcerpt(repo, 'f.js', 50, 5);
  assert.equal(symbolLine, 50);
  assert.equal(excerptStartLine, 45);
  assert.ok(excerpt.includes('line-50'));
  assert.ok(!excerpt.includes('line-1'));
  assert.ok(!excerpt.includes('line-80'));
});

test('evidenceLine prefers symbolLine then a cited evidence line', () => {
  assert.equal(evidenceLine({ symbolLine: 12, evidence: [{ line: 99 }] }), 12);
  assert.equal(evidenceLine({ evidence: [{ line: '7' }] }), 7);
  assert.equal(evidenceLine({}), 1);
});
