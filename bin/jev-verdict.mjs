#!/usr/bin/env node
// jev-verdict — append a reviewer outcome record to data/fp-verdicts.json.
//
// Reviewer outcome records close the feedback loop the FP suppression
// started (spec §18): "Suppressions are explicit records with
// fingerprint, reason, author, creation time, and optional expiry."
// Full contract: docs/VERDICTS.md.
//
// Example:
//   bin/jev-verdict.mjs \
//     --fingerprint sha256:<64 hex> \
//     --verdict false-positive \
//     --reason "Fixture label, not a committed secret." \
//     --author russ \
//     --file examples/labeled-eval/bugs.js --line 21 \
//     --pattern pattern:auth --evidence "return eval(userExpr);"
//
// Required: --fingerprint, --verdict, --reason, --author.
// Optional: --expires YYYY-MM-DD, --file, --line, --pattern, --evidence.
// Malformed records are refused (exit 64); nothing is appended.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../lib/io.mjs';
import { VERDICT_VALUES, FINGERPRINT_RE, loadVerdicts } from '../lib/verdicts.mjs';

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'fp-verdicts.json');

const args = process.argv.slice(2);
let fingerprint = null, verdict = null, reason = null, author = null,
  expires = null, file = null, line = null, pattern = null, evidence = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--fingerprint' && args[i + 1]) fingerprint = args[++i];
  else if (a === '--verdict' && args[i + 1]) verdict = args[++i];
  else if (a === '--reason' && args[i + 1]) reason = args[++i];
  else if (a === '--author' && args[i + 1]) author = args[++i];
  else if (a === '--expires' && args[i + 1]) expires = args[++i];
  else if (a === '--file' && args[i + 1]) file = args[++i];
  else if (a === '--line' && args[i + 1]) line = args[++i];
  else if (a === '--pattern' && args[i + 1]) pattern = args[++i];
  else if (a === '--evidence' && args[i + 1]) evidence = args[++i];
  else if (a === '--help' || a === '-h') {
    console.log(`usage: jev-verdict --fingerprint sha256:<hex> --verdict {${VERDICT_VALUES.join('|')}}
             --reason "..." --author "..."
             [--expires YYYY-MM-DD] [--file PATH] [--line N]
             [--pattern pattern:name] [--evidence "..."]

Appends one reviewer outcome record to data/fp-verdicts.json.
--file/--line/--pattern/--evidence locate the finding for the
suppression matcher; the fingerprint is its stable cross-run identity.`);
    process.exit(0);
  } else fail(`unknown arg ${a}`, 64);
}

// Refuse malformed records: nothing is written unless every check passes.
if (!fingerprint || !FINGERPRINT_RE.test(fingerprint))
  fail('--fingerprint is required and must look like sha256:<64 lowercase hex>', 64);
if (!VERDICT_VALUES.includes(verdict))
  fail(`--verdict is required and must be one of: ${VERDICT_VALUES.join(', ')}`, 64);
if (!reason || !reason.trim()) fail('--reason is required and must not be empty', 64);
if (!author || !author.trim()) fail('--author is required and must not be empty', 64);
let expiresIso = null;
if (expires != null) {
  const t = Date.parse(expires);
  if (!Number.isFinite(t)) fail(`--expires is not a parseable date: ${expires}`, 64);
  expiresIso = new Date(t).toISOString();
}
let lineNum = null;
if (line != null) {
  lineNum = Number(line);
  if (!Number.isInteger(lineNum) || lineNum < 1) fail(`--line must be a positive integer: ${line}`, 64);
}

const record = {
  fingerprint,
  file: file ?? null,
  line: lineNum,
  pattern: pattern ?? null,
  evidence: evidence ?? null,
  verdict,
  reason: reason.trim(),
  author: author.trim(),
  created: new Date().toISOString(),
  expires: expiresIso,
};

const records = loadVerdicts(STORE);
records.push(record);
fs.writeFileSync(STORE, JSON.stringify(records, null, 2) + '\n');
console.log(JSON.stringify(record));
