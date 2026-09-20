// lib/verdicts.mjs — reviewer outcome records (spec §18).
//
// "Suppressions are explicit records with fingerprint, reason, author,
// creation time, and optional expiry."
//
// Record schema (data/fp-verdicts.json, a JSON array). Legacy fields,
// present on every record shipped before 2026-09-20:
//   file, line, pattern, evidence, verdict, reason, date
// New fields (all optional; absent on legacy records):
//   fingerprint — "sha256:<64 hex>" stable finding identity (see
//     lib/fingerprint.mjs); the cross-run key CI uses to mark a finding
//     unchanged / resolved / regressed.
//   author      — who recorded the outcome.
//   created     — ISO-8601 creation time (replaces legacy `date`).
//   expires     — ISO-8601 expiry time, or null. An expired record no
//     longer suppresses and is no longer fed to the judge as a negative
//     example; the finding is reconsidered on the next run.
//
// Suppression semantics are unchanged: a seed is suppressed only when
// its (file, pattern, matched evidence text) exactly repeats a
// verdict:false-positive entry with non-null evidence. The fingerprint
// is the stable identity for CI; the seeder still matches on the
// evidence triple because fingerprints are computed downstream in
// jev-verify, after seeding.
import fs from 'node:fs';

// The only verdicts the write path accepts. The seeder and the judge
// negative-example block act on 'false-positive' only; 'accepted-finding'
// records a human-confirmed bug for the audit trail.
export const VERDICT_VALUES = ['false-positive', 'accepted-finding'];

// Wire format for new fingerprints (matches lib/fingerprint.mjs output).
export const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;

// True when the record carries an expiry time that has passed. Records
// without an expiry never expire.
export function isExpired(v) {
  if (!v || v.expires == null) return false;
  const t = Date.parse(v.expires);
  return Number.isFinite(t) && t <= Date.now();
}

// Creation time, new field first, legacy fallback. Legacy records sort
// and log exactly as before.
export function verdictDate(v) {
  return (v && (v.created || v.date)) || '';
}

// Load the verdict store. A missing, unreadable, or corrupt store yields
// an empty list — callers proceed without verdicts, exactly as before
// this module existed. (Strict validation of the store is a separate,
// future decision; silently tolerating corruption here preserves the
// long-standing behavior of both consumers.)
export function loadVerdicts(storePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
