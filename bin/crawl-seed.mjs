#!/usr/bin/env node
// crawl-seed — emit starting leads as JSON.
// Sources: --diff (git diff vs --base), --todo (TODO/FIXME/XXX/HACK),
// --patterns (risky code patterns: auth, money, eval, dynamic require).
// Output: JSON array of nodes. Pipes into crawl-expand or crawl.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { asArray, writeJson, readFileSafe, fail } from '../lib/io.mjs';
import { withId } from '../lib/graph.mjs';
import { loadIgnores, grepSymbol, grepRegex, enclosingScope, gitDiffFiles } from '../lib/search.mjs';

const args = process.argv.slice(2);
let repo = process.cwd(), base = 'HEAD', seeds = [], only = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--repo' && args[i + 1]) repo = args[++i];
  else if (a === '--base' && args[i + 1]) base = args[++i];
  else if (a === '--diff' || a === '--todo' || a === '--patterns') seeds.push(a.slice(2));
  else if (a === '--only' && args[i + 1]) only = args[++i].split(',');
  else if (a === '--help' || a === '-h') {
    console.log('usage: crawl-seed --repo PATH [--diff] [--todo] [--patterns] [--base HEAD] [--only a.js,b.js]');
    process.exit(0);
  } else fail(`unknown arg ${a}`, 64);
}
if (!seeds.length) seeds = ['diff', 'todo', 'patterns'];
const isIgnored = loadIgnores(repo);
const nodes = [];

function addNode(file, symbol, scope, type, evidence, priority) {
  if (isIgnored(file)) return;
  if (only && !only.includes(file)) return;
  nodes.push(withId({
    file, symbol: symbol || '?', scope: scope || '<file>',
    kind: 'seed', depth: 0, priority,
    seed: { type, evidence: String(evidence).slice(0, 400) },
  }));
}

// Seed: git diff. Touched symbols become leads.
if (seeds.includes('diff')) {
  for (const file of gitDiffFiles(repo, base)) {
    const text = readFileSafe(path.join(repo, file));
    if (!text) { addNode(file, '?', '<file>', 'diff', `touched in diff vs ${base}`, 0.9); continue; }
    let diffText = '';
    try {
      diffText = execFileSync('git', ['diff', '-U0', base, '--', file],
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { /* fall through with file-level node */ }
    const syms = new Set();
    for (const m of diffText.matchAll(/^[-+].*\b(?:function|def|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) syms.add(m[1]);
    if (!syms.size) { addNode(file, '?', '<file>', 'diff', `touched in diff vs ${base}`, 0.9); continue; }
    for (const s of syms) {
      const scope = enclosingScope(text, 1);
      addNode(file, s, scope, 'diff', `symbol ${s} touched in diff vs ${base}`, 1.0);
    }
  }
}

// Seed: TODO/FIXME/XXX/HACK comments.
if (seeds.includes('todo')) {
  for (const hit of grepRegex(repo, /\b(TODO|FIXME|XXX|HACK)\b/, isIgnored)) {
    const m = hit.text.match(/\b(TODO|FIXME|XXX|HACK)\b\s*:?\s*(.{0,120})/);
    addNode(hit.file, '?', hit.scope, 'todo', `${m ? m[1] : 'TODO'}: ${m ? m[2] : hit.text}`, 0.7);
  }
}

// Seed: risky patterns (auth, money movement, dynamic code).
if (seeds.includes('patterns')) {
  const patterns = [
    ['auth', /\b(password|secret|token|api[_-]?key|auth|credential)\b/i, 0.8],
    ['money', /\b(charge|payment|invoice|refund|payout|balance|transfer)\b/i, 0.8],
    ['dynamic-code', /\beval\s*\(|new\s+Function\s*\(/, 0.9],
    ['dynamic-require', /\brequire\s*\(\s*[^)'"]/, 0.7],
    ['shell', /\bexec\s*\(|spawn\s*\(|system\s*\(/, 0.8],
    ['raw-html', /\.innerHTML\s*=/, 0.6],
  ];
  for (const [name, re, prio] of patterns) {
    for (const hit of grepRegex(repo, re, isIgnored)) {
      addNode(hit.file, '?', hit.scope, `pattern:${name}`, hit.text, prio);
    }
  }
}

writeJson(nodes);
