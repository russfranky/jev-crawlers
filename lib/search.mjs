// lib/search.mjs — mechanical expansion helpers (no model calls).
// Expansion is deterministic: text search, git co-change history, and
// config references. Nothing here judges; judgment belongs to crawl-judge.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSafe } from './io.mjs';

const DEFAULT_IGNORES = [
  /node_modules\//, /\.git\//, /\/dist\//, /\/build\//, /\/vendor\//,
  /\.min\.js$/, /-min\.js$/, /package-lock\.json$/, /yarn\.lock$/,
  /\.map$/, /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot)$/,
  // Secret-bearing files are never read. .env.example stays scannable
  // (example values only); every other .env variant is ignored.
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]*$/,
];

export function loadIgnores(repo) {
  const patterns = [...DEFAULT_IGNORES];
  const p = path.join(repo, '.crawlersignore');
  if (fs.existsSync(p)) {
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const body = line
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '(?:.*/)?');
      patterns.push(new RegExp(body));
    }
  }
  return (rel) => patterns.some((re) => re.test(rel));
}

function walkFiles(repo, isIgnored, maxFiles = 20000) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < maxFiles) {
    const rel = stack.pop();
    const abs = path.join(repo, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      if (rel && isIgnored(rel + '/')) continue;
      let kids;
      try { kids = fs.readdirSync(abs); } catch { continue; }
      for (const k of kids) stack.push(rel ? rel + '/' + k : k);
    } else if (st.isFile()) {
      if (isIgnored(rel)) continue;
      if (st.size > 500000) continue;
      out.push(rel);
    }
  }
  return out;
}

export function grepSymbol(repo, symbol, isIgnored) {
  const hits = [];
  if (!symbol || symbol === '?') return hits;
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return grepRegex(repo, re, isIgnored);
}

// Generic regex grep over the repo. Returns {file, line, text, scope}.
export function grepRegex(repo, re, isIgnored, maxHits = 400) {
  const hits = [];
  const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const rel of walkFiles(repo, isIgnored)) {
    let text;
    try { text = fs.readFileSync(path.join(repo, rel), 'utf8'); } catch { continue; }
    if (!re.test(text)) continue;
    const lines = text.split('\n');
    lines.forEach((ln, i) => {
      globalRe.lastIndex = 0;
      if (globalRe.test(ln)) {
        hits.push({ file: rel, line: i + 1, text: ln.trim().slice(0, 200), scope: enclosingScope(text, i + 1) });
      }
    });
    if (hits.length > maxHits) break;
  }
  return hits;
}

// Naive scope: nearest enclosing "function NAME", "def NAME", "class NAME",
// or "const NAME = ..." within 60 lines above the hit line.
export function enclosingScope(text, lineNo) {
  const lines = text.split('\n');
  const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'elif', 'except', 'foreach']);
  const scopeRe = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|def\s+([A-Za-z_][\w]*)|class\s+([A-Za-z_][\w]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(|([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{?)/;
  for (let i = Math.min(lineNo - 1, lines.length - 1); i >= Math.max(0, lineNo - 61); i--) {
    const m = lines[i].match(scopeRe);
    if (m) {
      const name = m.slice(1).find(Boolean);
      if (name && !keywords.has(name)) return name;
    }
  }
  return '<file>';
}

export function fileExcerpt(repo, file, symbolLine, window = 40) {
  const text = readFileSafe(path.join(repo, file));
  if (!text) return { excerpt: '', symbolLine: 0 };
  const lines = text.split('\n');
  const lo = Math.max(0, (symbolLine || 1) - 1 - window);
  const hi = Math.min(lines.length, (symbolLine || 1) - 1 + window + 1);
  return { excerpt: lines.slice(lo, hi).join('\n'), symbolLine: symbolLine || 1 };
}

// Files that historically change together with `file` (git log co-change).
export function coChangedFiles(repo, file, limit = 5) {
  try {
    const out = execFileSync('git', ['log', '--format=', '--name-only', '-n', '60', '--', file],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const counts = new Map();
    for (const f of out.split('\n').map((s) => s.trim())) {
      if (!f || f === file) continue;
      counts.set(f, (counts.get(f) || 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([f, c]) => ({ file: f, coChanges: c }));
  } catch {
    return [];
  }
}

// Config files that reference a symbol: package.json, yaml/toml/ini configs,
// *.config.js, .env.example. Secrets-bearing files (.env) are never read.
export function configReferences(repo, symbol, isIgnored) {
  const hits = [];
  if (!symbol || symbol === '?') return hits;
  const cfgRe = /(package\.json$|\.ya?ml$|\.toml$|\.ini$|\.cfg$|\.config\.[jt]s$|\.env\.example$|Dockerfile$)/;
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  for (const rel of walkFiles(repo, isIgnored)) {
    if (!cfgRe.test(rel)) continue;
    let text;
    try { text = fs.readFileSync(path.join(repo, rel), 'utf8'); } catch { continue; }
    if (re.test(text)) hits.push({ file: rel });
    if (hits.length > 20) break;
  }
  return hits;
}

export function gitDiffFiles(repo, base = 'HEAD') {
  try {
    const out = execFileSync('git', ['diff', '--name-only', base], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
