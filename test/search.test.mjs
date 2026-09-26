import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { enclosingScope, loadIgnores, grepRegex, fileExcerpt, evidenceLine, coChangedFiles, configReferences } from '../lib/search.mjs';

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

function tmpGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-search-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  git('init');
  git('config', 'user.email', 'qa@example.com');
  git('config', 'user.name', 'qa');
  return { dir, git };
}

test('coChangedFiles finds files committed together (D-005)', () => {
  const { dir, git } = tmpGitRepo();
  const write = (rel, body) => fs.writeFileSync(path.join(dir, rel), body);
  write('a.js', 'v1'); write('b.js', 'v1');
  git('add', '-A'); git('commit', '-m', 'one');
  write('a.js', 'v2'); write('b.js', 'v2');
  git('add', '-A'); git('commit', '-m', 'two');
  write('a.js', 'v3');
  git('add', '-A'); git('commit', '-m', 'three');
  const got = coChangedFiles(dir, 'a.js');
  const b = got.find((r) => r.file === 'b.js');
  assert.ok(b, `expected b.js in ${JSON.stringify(got)}`);
  assert.equal(b.coChanges, 2);
  assert.ok(!got.some((r) => r.file === 'a.js'), 'queried file must not list itself');
});

test('coChangedFiles returns [] when nothing co-changes and on git failure (D-005)', () => {
  const { dir, git } = tmpGitRepo();
  fs.writeFileSync(path.join(dir, 'solo.js'), 'x');
  git('add', '-A'); git('commit', '-m', 'solo one');
  fs.writeFileSync(path.join(dir, 'solo.js'), 'y');
  git('add', '-A'); git('commit', '-m', 'solo two');
  assert.deepEqual(coChangedFiles(dir, 'solo.js'), []);
  assert.deepEqual(coChangedFiles(path.join(dir, 'no-such-dir'), 'solo.js'), []);
});

test('configReferences finds the product question set (D-006)', () => {
  const repo = path.resolve(new URL('..', import.meta.url).pathname);
  const got = configReferences(repo, 'zeroDataRetention', loadIgnores(repo));
  assert.ok(got.some((r) => r.file === 'questions/crawl-judge.json'),
    `expected questions/crawl-judge.json in ${JSON.stringify(got)}`);
});

test('loadIgnores anchors dist/build/vendor/node_modules/.git at root and nested (D-011)', () => {
  const repo = tmpRepo({});
  const ignore = loadIgnores(repo);
  const ignored = [
    'dist/a.js', 'sub/dist/a.js',
    'build/b.js', 'sub/build/b.js',
    'vendor/c.js', 'sub/vendor/c.js',
    'node_modules/x.js', 'sub/node_modules/x.js',
    '.git/config', 'sub/.git/config',
  ];
  for (const rel of ignored) assert.equal(ignore(rel), true, rel);
  const kept = ['distant/a.js', 'mybuild/b.js', 'src/gitkeep.js', 'src/a.js', 'buildinfo.txt'];
  for (const rel of kept) assert.equal(ignore(rel), false, rel);
});

test('crawl skips root and nested build output but keeps lookalikes (D-011)', () => {
  const repo = tmpRepo({
    'dist/a.js': 'TODO x\n', 'sub/dist/a.js': 'TODO x\n',
    'build/b.js': 'TODO x\n', 'vendor/c.js': 'TODO x\n',
    'src/ok.js': 'TODO x\n', 'distant/keep.js': 'TODO x\n',
  });
  const hits = grepRegex(repo, /\bTODO\b/, loadIgnores(repo));
  assert.deepEqual(hits.map((h) => h.file).sort(), ['distant/keep.js', 'src/ok.js']);
});
