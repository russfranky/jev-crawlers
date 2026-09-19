// lib/evidence.mjs — shared evidence helpers.
//
// attachEvidence(node): normalize the node's own cited code locations into a
// flat array of { kind, file, line, text } items for the judgment record.
//
// The driver calls this on every verify-bound judgment BEFORE crawl-verify
// runs, so verification grounds the claim against three things:
//   (a) the judge's stated artifact (verdict choice + artifact_stated),
//   (b) the node's own evidence, including the node's own symbol location —
//       the claim is always about this code, so its location is always a
//       legitimate grounding source,
//   (c) the actual files on disk.
//
// Sources, in order: the node's structured evidence items (kind code or
// pattern with file:line), then the node's own symbol location (file +
// symbolLine) as a fallback that can only add confirmation. Every location
// still passes through the verifier's on-disk check: a cited file:line
// that does not exist on disk, or whose content does not match, demotes by
// itself (fail-closed against fabricated evidence). Deduplicated by
// file:line. No Jev calls, no I/O — pure and free to call in tests.
export function attachEvidence(node) {
  const items = [];
  const seen = new Set();
  const add = (kind, file, line, text) => {
    if (!file || !Number.isInteger(line) || line < 1) return;
    const key = `${file}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ kind, file, line, text: text || '' });
  };
  for (const e of (node.evidence || [])) {
    if (e && typeof e === 'object' && (e.kind === 'code' || e.kind === 'pattern')) {
      add(e.kind, e.file, e.line, e.text);
    }
  }
  // The node's own symbol location: the claim's referent. Always a
  // legitimate grounding source; the on-disk check still applies.
  add('code', node.file, node.symbolLine, '');
  return items;
}
