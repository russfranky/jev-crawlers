#!/usr/bin/env node
// jev-seed — emit starting leads as JSON lines.
// Sources: --diff (git diff vs --base), --todo (TODO/FIXME/XXX/HACK),
// --patterns (risky code patterns: auth, money, eval, dynamic require).
// Output: one seed node per line (NDJSON). Pipes into jev-expand or the
// crawl driver.
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeJsonl, readFileSafe, fail } from '../lib/io.mjs';
import { withId } from '../lib/graph.mjs';
import { loadIgnores, grepRegex, enclosingScope, gitDiffFiles } from '../lib/search.mjs';
import { loadVerdicts, isExpired, verdictDate } from '../lib/verdicts.mjs';

const args = process.argv.slice(2);
let repo = process.cwd(), base = 'HEAD', seeds = [], only = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--repo' && args[i + 1]) repo = args[++i];
  else if (a === '--base' && args[i + 1]) base = args[++i];
  else if (a === '--diff' || a === '--todo' || a === '--patterns') seeds.push(a.slice(2));
  else if (a === '--only' && args[i + 1]) only = args[++i].split(',');
  else if (a === '--help' || a === '-h') {
    console.log('usage: jev-seed --repo PATH [--diff] [--todo] [--patterns] [--base HEAD] [--only a.js,b.js]');
    process.exit(0);
  } else fail(`unknown arg ${a}`, 64);
}
if (!seeds.length) seeds = ['diff', 'todo', 'patterns'];
const isIgnored = loadIgnores(repo);
const nodes = [];

// Evidence items are structured so the verifier can ground them:
//   { kind: 'code'|'pattern'|'diff'|'context', file, line, text, pattern? }
// 'code' is a real code line with its file:line (the strongest grounding);
// 'pattern' names the risky pattern that fired; 'diff' marks diff touch;
// 'context' is free-form (seed summaries, relation notes). Seeds always
// carry real evidence items now; `evidence: []` is gone from the pipeline.
function ev(kind, file, line, text, extra) {
  return { kind, file, line: line || 0, text: String(text).slice(0, 200), ...(extra || {}) };
}

function addNode(file, symbol, scope, type, items, summary, priority) {
  if (isIgnored(file)) return;
  if (only && !only.includes(file)) return;
  nodes.push(withId({
    file, symbol: symbol || '?', scope: scope || '<file>',
    kind: 'seed', depth: 0, priority,
    seed: { type, evidence: String(summary).slice(0, 400) },
    evidence: items,
  }));
}

// Line number of a symbol's declaration in file text (best effort).
function declLine(text, symbol) {
  const lines = text.split('\n');
  const re = new RegExp(`^\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s+|class\\s+|(?:const|let|var)\\s+)${symbol}\\b`);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 0;
}

// Seed: git diff. Touched symbols become leads.
if (seeds.includes('diff')) {
  for (const file of gitDiffFiles(repo, base)) {
    const text = readFileSafe(path.join(repo, file));
    if (!text) {
      addNode(file, '?', '<file>', 'diff',
        [ev('diff', file, 0, `touched in diff vs ${base}`)],
        `touched in diff vs ${base}`, 0.9);
      continue;
    }
    let diffText = '';
    try {
      diffText = execFileSync('git', ['diff', '-U0', base, '--', file],
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { /* fall through with file-level node */ }
    const syms = new Set();
    for (const m of diffText.matchAll(/^[-+].*\b(?:function|def|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) syms.add(m[1]);
    if (!syms.size) {
      addNode(file, '?', '<file>', 'diff',
        [ev('diff', file, 0, `touched in diff vs ${base}`)],
        `touched in diff vs ${base}`, 0.9);
      continue;
    }
    for (const s of syms) {
      const scope = enclosingScope(text, 1);
      const dl = declLine(text, s);
      const items = [ev('diff', file, 0, `symbol ${s} touched in diff vs ${base}`)];
      if (dl) {
        const line = text.split('\n')[dl - 1].trim();
        items.push(ev('code', file, dl, line));
      }
      addNode(file, s, scope, 'diff', items, `symbol ${s} touched in diff vs ${base}`, 1.0);
    }
  }
}

// Seed: TODO/FIXME/XXX/HACK comments.
if (seeds.includes('todo')) {
  for (const hit of grepRegex(repo, /\b(TODO|FIXME|XXX|HACK)\b/, isIgnored)) {
    const m = hit.text.match(/\b(TODO|FIXME|XXX|HACK)\b\s*:?\s*(.{0,120})/);
    const marker = `${m ? m[1] : 'TODO'}: ${m ? m[2] : hit.text}`;
    addNode(hit.file, '?', hit.scope, 'todo',
      [ev('code', hit.file, hit.line, hit.text),
       ev('context', hit.file, hit.line, `TODO-style comment: ${marker}`)],
      marker, 0.7);
  }
}

// Verdict-store file paths are repo-root-relative, but --repo may point at
// a subdirectory. Compare on trailing path segments so a verdict recorded
// at the root still matches a run scoped to a subtree (and vice versa).
// Combined with the exact pattern + exact evidence-text match, the
// collision risk is negligible; every suppression stays visible on stderr.
function sameFile(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = a.split('/'), pb = b.split('/');
  const shorter = pa.length < pb.length ? pa : pb;
  const longer = pa.length < pb.length ? pb : pa;
  return longer.slice(-shorter.length).join('/') === shorter.join('/');
}

// Seed: risky patterns (auth, money movement, dynamic code).
if (seeds.includes('patterns')) {
  const patterns = [
    ['auth', /\b(password|secret|api[_-]?key|credential|auth)\b/i, 0.8],
    // 'token' alone is noise (item display names, parser tokens, XML
    // serialization, timer tokens). Require an auth qualifier, a
    // secret-ish suffix, a context word on the same line, or a
    // secret-shaped value nearby — never a bare word match.
    ['auth-token', /\b(?:session|access|refresh|bearer|csrf|id|api|auth|secret|sign)[_-]?tokens?\b|\btokens?[_-]?(?:secret|key|value|password)\b|\btokens?\b.{0,60}\b(?:secret|password|credential|sign)\b|\b(?:secret|password|credential|sign)\b.{0,60}\btokens?\b|\btokens?\b\s*[:=]\s*['"](?:sk_|ghp_|xox|AKIA|ASIA|vck_|AIza|-----BEGIN)[A-Za-z0-9_\-+/=]{8,}['"]/i, 0.8],
    ['money', /\b(charge|payment|invoice|refund|payout|balance|transfer)\b/i, 0.8],
    ['dynamic-code', /\beval\s*\(|new\s+Function\s*\(/, 0.9],
    ['dynamic-require', /\brequire\s*\(\s*[^)'"]/, 0.7],
    // 'spawn'/'system' alone match English prose ('respawn (', 'the weather
    // system (', deprecation docs) and Luau's task.spawn (a coroutine
    // scheduler, not a shell). Only real OS-invocation forms count.
    ['shell', /\bexecSync\s*\(|\bexec\s*\(|\bos\.execute\s*\(|\bio\.popen\s*\(|(?:child_process|cp)\.spawn\s*\(/, 0.8],
    ['raw-html', /\.innerHTML\s*=/, 0.6],
  ];
  for (const [name, re, prio] of patterns) {
    for (const hit of grepRegex(repo, re, isIgnored)) {
      // The FP verdict store quotes matched evidence text verbatim; seeding
      // it would re-fire patterns on the quotes (self-referential noise).
      // It is machine data, not code under audit.
      if (sameFile(hit.file, 'data/fp-verdicts.json')) continue;
      addNode(hit.file, '?', hit.scope, `pattern:${name}`,
        [ev('code', hit.file, hit.line, hit.text),
         ev('pattern', hit.file, hit.line, `risky pattern fired: ${name}`, { pattern: name })],
        `pattern:${name} matched: ${hit.text}`, prio);
    }
  }
}

// False-positive feedback loop. Human verdicts live in
// data/fp-verdicts.json (schema: docs/VERDICTS.md). A seed is suppressed
// only when its (file, pattern, matched evidence text) exactly repeats a
// verdict:false-positive entry — never by bare file:line, since lines
// shift. Class-level entries (evidence: null) never suppress; they exist
// for the judge's negative examples. Expired records no longer suppress:
// the finding is reconsidered on the next run. Suppressions are logged to
// stderr so runs stay auditable. This does not weaken patterns.
function loadFpVerdicts() {
  const p = path.join(new URL(import.meta.url).pathname, '..', '..', 'data', 'fp-verdicts.json');
  return loadVerdicts(p);
}
const fpVerdicts = loadFpVerdicts().filter(v => v && v.verdict === 'false-positive' && v.evidence && !isExpired(v));
function isFpRepeat(node) {
  const codeTexts = (node.evidence || []).filter(e => e && e.kind === 'code').map(e => e.text);
  return fpVerdicts.find(v =>
    sameFile(v.file, node.file) && v.pattern === (node.seed && node.seed.type) &&
    codeTexts.some(t => t === v.evidence || t.includes(v.evidence)));
}

writeJsonl(nodes.filter(n => {
  const v = isFpRepeat(n);
  if (v) console.error(`fp-verdict: suppressed ${n.file} [${n.seed.type}] (verdict ${verdictDate(v)})`);
  return !v;
}));
