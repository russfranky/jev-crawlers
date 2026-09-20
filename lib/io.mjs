// lib/io.mjs — stdin/stdout JSON helpers for the crawl primitives.
// Every primitive speaks NDJSON or one JSON array on stdout.
import fs from 'node:fs';

export async function readStdinJson() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  text = text.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Fall back to NDJSON: one JSON object per line.
    const rows = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t) rows.push(JSON.parse(t));
    }
    return rows;
  }
}

export function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function writeJson(v) {
  process.stdout.write(JSON.stringify(v, null, 1) + '\n');
}

// writeJsonl: one compact JSON object per line (NDJSON). This is the
// pipeline framing: every stage reads NDJSON-or-array on stdin (see
// readStdinJson) and writes NDJSON on stdout, so stages compose with
// plain shell pipes: jev-seed --repo X | jev-judge | jev-verify.
export function writeJsonl(v) {
  for (const row of asArray(v)) {
    process.stdout.write(JSON.stringify(row) + '\n');
  }
}

export function readFileSafe(path, maxChars = 200000) {
  try {
    const s = fs.readFileSync(path, 'utf8');
    return s.length > maxChars ? s.slice(0, maxChars) : s;
  } catch {
    return null;
  }
}

export function fail(msg, code = 2) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}
