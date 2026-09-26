// lib/redact.mjs — pre-judge redaction pass (spec: "Secret leakage in
// evidence" control; "evidence extraction applies redaction and deny
// rules before any remote call"; "A pre-judge redaction pass strips
// secrets and tokens").
//
// What it does: scans text for credential-shaped values and replaces
// each value with the literal marker [REDACTED:credential]. It is
// LOSSY-SAFE by construction: only the secret value is replaced —
// keys, assignment operators, quoting, and surrounding code structure
// are left intact, so the judge still sees the code shape around a
// redacted secret.
//
// Detectors (the spec's "entropy and key-name detection"):
//   1. Key-name: an assignment whose key looks like a credential name
//      (api_key, secret, token, password, ...) — the value is replaced.
//   2. Bearer: the "Authorization: Bearer <token>" header shape, which
//      has no assignment operator.
//   3. PEM: unquoted multi-line private-key blocks. Quoted high-entropy
//      tokens never see the BEGIN/END wrapper or the newlines, so the
//      entropy detector misses them.
//   4. Well-known prefixes: ghp_, sk_live_, AKIA, AIza, xoxb-, … even
//      when the value is unquoted or shorter than the entropy floor.
//   5. Entropy: a long quoted string over a token alphabet whose
//      Shannon entropy is high — catches hex keys and other opaque
//      credential blobs not tied to a key name.
//
// What it never does: it never redacts file paths, symbol names, code
// structure, comments, or prose. A redacted value keeps its position,
// so line numbers and excerpts stay aligned with the on-disk file.
//
// No I/O, no network — pure and free to call in tests and gates.

// Credential-ish key names. Word-boundary anchored; the assignment
// shape (key [: =] value) is required, so prose mentions of "secret"
// or "token" without a value are never touched. Inner groups are
// non-capturing: the KEY_RE backreference must land on the quote group.
const KEY_NAMES = [
  'api[_-]?key', 'apikey', 'client[_-]?secret', 'secret[_-]?(?:key)?',
  'token', 'auth[_-]?token', 'access[_-]?token', 'refresh[_-]?token',
  'bearer', 'password', 'passwd', 'pwd', 'private[_-]?key',
  'aws[_-]?[_-]?(?:secret|access)', 'db[_-]?pass(?:word)?',
];
const KEY_RE = new RegExp(
  `\\b(${KEY_NAMES.join('|')})\\b(\\s*[:=]\\s*)(['"]?)([^\\s'"\`;,}]+)\\3`,
  'gi',
);

// "Authorization: Bearer <token>" — the canonical header shape has no
// assignment operator, so the key rule above never fires on it.
const BEARER_RE = /\bBearer\s+([A-Za-z0-9\-_~+/=]{20,})/g;

// Unquoted PEM private-key blocks. Public certificates are left alone.
const PEM_RE = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/g;

// Well-known credential prefixes that identify a secret even without a
// credential-shaped key name or surrounding quotes.
const PREFIX_RE = /\b((?:sk-ant-|sk_live_|sk_test_|rk_live_|rk_test_|sk-live-|sk-test-|sk-proj-|sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza)[A-Za-z0-9_\-]{8,})/g;

// Opaque token blobs: long quoted strings over a token alphabet with
// high Shannon entropy. Length >= 24 and entropy >= 3.5 bits/char keeps
// ordinary identifiers, URLs, and prose far below the bar.
const TOKEN_RE = /(['"])([A-Za-z0-9+/=_.\-]{24,})\1/g;
const ENTROPY_FLOOR = 3.5;
const TOKEN_MIN_LEN = 24;

function shannon(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export const REDACTED_MARKER = '[REDACTED:credential]';

// Redact credential-shaped values in one text string.
// Returns { text, count } — count is the number of replaced values.
export function redactText(input) {
  let text = String(input ?? '');
  let count = 0;
  text = text.replace(PEM_RE, (m, kind) => {
    count++;
    return `-----BEGIN ${kind}-----\n${REDACTED_MARKER}\n-----END ${kind}-----`;
  });
  text = text.replace(KEY_RE, (m, key, sep, quote) => {
    count++;
    return `${key}${sep}${quote}${REDACTED_MARKER}${quote}`;
  });
  text = text.replace(BEARER_RE, (m, tok) => {
    count++;
    return m.replace(tok, REDACTED_MARKER);
  });
  text = text.replace(PREFIX_RE, (m) => {
    if (m.includes(REDACTED_MARKER)) return m;
    count++;
    return REDACTED_MARKER;
  });
  text = text.replace(TOKEN_RE, (m, quote, body) => {
    if (body === REDACTED_MARKER) return m;
    if (body.length < TOKEN_MIN_LEN || shannon(body) < ENTROPY_FLOOR) return m;
    count++;
    return `${quote}${REDACTED_MARKER}${quote}`;
  });
  return { text, count };
}

// Pre-judge redaction pass over one node's text-bearing fields. Returns
// a redacted COPY of the node with `redactions: [{ class:
// 'credential', count }]` attached (the spec's evidence-record format).
// The original node is never mutated: local stages (seeding, expansion,
// verification grounding) keep working on raw text; only the judge
// input is redacted.
export function redactNode(node) {
  if (!node || typeof node !== 'object') return { node, redactions: [] };
  const copy = { ...node };
  let count = 0;
  if (typeof copy.excerpt === 'string') {
    const r = redactText(copy.excerpt);
    copy.excerpt = r.text;
    count += r.count;
  }
  if (copy.seed && typeof copy.seed === 'object' && typeof copy.seed.evidence === 'string') {
    const seed = { ...copy.seed };
    const r = redactText(seed.evidence);
    seed.evidence = r.text;
    copy.seed = seed;
    count += r.count;
  }
  if (Array.isArray(copy.evidence)) {
    copy.evidence = copy.evidence.map((e) => {
      if (!e || typeof e !== 'object' || typeof e.text !== 'string') return e;
      const r = redactText(e.text);
      count += r.count;
      return r.count ? { ...e, text: r.text } : e;
    });
  }
  copy.redactions = count ? [{ class: 'credential', count }] : [];
  return { node: copy, redactions: copy.redactions };
}
