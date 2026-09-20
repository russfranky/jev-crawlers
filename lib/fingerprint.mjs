// lib/fingerprint.mjs — stable finding fingerprints (spec §18).
//
// "Repeated findings across runs keep a stable fingerprint so CI can
// mark them unchanged, resolved, or regressed." The spec's design:
// "Fingerprint combines defect class, primary location, and normalized
// evidence path." Wire format follows the spec's data contract:
// "fingerprint": "sha256:..." (hex digest with the sha256: prefix).
//
// Stability rules: the fingerprint is computed only from the claim
// (defect class, primary location, evidence path) — never from the
// verification outcome, timestamps, run IDs, or absolute paths. The
// same claim re-found in a later run gets the same fingerprint even if
// its status changed (bug vs unverified lead); CI tracks the finding
// by fingerprint and reads the status change as unchanged/regressed.
import { createHash } from 'node:crypto';
import path from 'node:path';

// Normalize a path the way the seeder emits them: repo-root-relative
// with forward slashes. Defensive only — the pipeline already passes
// repo-relative posix paths; this keeps the fingerprint stable if a
// caller passes an absolute path, backslashes, or a leading ./.
export function normRepoPath(p, repoRoot) {
  if (p == null) return '';
  let s = String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (repoRoot && path.isAbsolute(String(p))) {
    const rel = path.relative(repoRoot, String(p)).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) s = rel;
  }
  return s;
}

// Defect class: the judge's verdict choice ('report' | 'escalate').
// This is the finest claim classification the pipeline records; the
// judge contract (questions/crawl-judge.json) has no defect taxonomy,
// and inventing one would change what the judge is asked. Falls back
// to the finding status so a missing verdict still yields a stable,
// documented value rather than throwing.
function defectClass(finding) {
  return finding?.judgment?.answers?.verdict?.choice || finding?.status || '?';
}

// Primary location: the node's own file and symbol line, normalized.
// This is the "primary location" the spec's candidate contract shows
// as { path, lines }; the node record carries it as file/symbolLine.
function primaryLocation(node, repoRoot) {
  const file = normRepoPath(node?.file, repoRoot);
  const line = node?.symbolLine || 0;
  return `${file}:${line}`;
}

// Normalized evidence path: every cited code/pattern evidence
// location (file:line), deduplicated and sorted. Sorting makes the
// fingerprint independent of evidence-item order across runs; only
// locations feed the hash, never evidence text (text shifts when code
// is edited, paths identify the claim).
function evidencePath(node, judgment, repoRoot) {
  const seen = new Set(), locs = [];
  const add = (file, line) => {
    const f = normRepoPath(file, repoRoot);
    if (!f || !line) return;
    const key = `${f}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    locs.push(key);
  };
  for (const e of (node?.evidence || [])) {
    if (e && typeof e === 'object' && (e.kind === 'code' || e.kind === 'pattern')) {
      add(e.file, e.line);
    }
  }
  for (const e of (judgment?.attachedEvidence || [])) {
    if (e && typeof e === 'object' && e.file && e.line) add(e.file, e.line);
  }
  return locs.sort().join(',');
}

// Canonical preimage, versioned so the format can evolve without
// silent collisions: v1 | defect class | primary location |
// evidence path, newline-joined.
export function fingerprintPreimage(finding, repoRoot) {
  return [
    'fingerprint-v1',
    defectClass(finding),
    primaryLocation(finding?.node, repoRoot),
    evidencePath(finding?.node, finding?.judgment, repoRoot),
  ].join('\n');
}

export function findingFingerprint(finding, repoRoot) {
  return 'sha256:' + createHash('sha256').update(fingerprintPreimage(finding, repoRoot), 'utf8').digest('hex');
}
