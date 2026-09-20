# Secret redaction

Pre-judge redaction for `bin/crawl`, per the product spec's "Secret
leakage in evidence" control: "evidence extraction applies redaction
and deny rules before any remote call" and "a pre-judge redaction pass
strips secrets and tokens."

## Where it runs

`lib/jev.mjs` `packState()` — the single choke point before the only
network call (`judgeNode` → the Jev gateway). Every node is passed
through `redactNode()` (in `lib/redact.mjs`) before the judge state
string is built. Local stages — seeding, expansion, verification
grounding — keep working on raw text; **only the judge input is
redacted**. Nothing secret-bearing ever leaves the machine.

## What is redacted

Credential-shaped **values** are replaced with the literal marker
`[REDACTED:credential]`. Detectors (the spec's "entropy and key-name
detection" plus known credential prefixes):

1. **Key-name**: an assignment whose key looks like a credential name
   (`api_key`, `secret`, `token`, `password`, `passwd`, `auth_token`,
   `bearer`, `client_secret`, `private_key`, …) — the value is
   replaced, e.g. `const api_key = "[REDACTED:credential]";`.
2. **Entropy**: a long quoted string (≥ 24 chars) over a token
   alphabet with high Shannon entropy (≥ 3.5 bits/char) — catches
   bearer tokens, hex keys, and opaque credential blobs.
3. **`Authorization: Bearer <token>`** — the canonical header shape,
   which has no assignment operator.
4. **PEM / OpenSSH blocks**: `-----BEGIN … PRIVATE KEY-----` through
   the matching `END` line. Each interior line is replaced with the
   marker so line numbers stay aligned with the on-disk file.
5. **Known prefixes**: `sk-` / `sk-ant-` (OpenAI / Anthropic),
   `ghp_` / `github_pat_` (GitHub), `xox` (Slack), `AKIA` / `ASIA`
   followed by 16 alphanumeric chars (AWS access key ids).

The redaction is lossy-safe: only the value is replaced. Keys,
operators, quoting, and surrounding code stay intact, so the judge
still sees the code shape around a redacted secret, and line numbers
stay aligned with the on-disk file.

Each redacted node carries `redactions: [{ "class": "credential",
"count": N }]` (the spec's evidence-record format), surfaced on the
judgment record. The spec's truncation rule is honored: redaction
markers are never stripped by the state packer.

## What is NEVER redacted

- File paths, symbol names, and code structure.
- Comments and prose (a comment *mentioning* "secret" without a
  value is untouched).
- Short or low-entropy strings, URLs, ordinary identifiers.
- Anything outside the judge input: seeder output, local reports,
  and verification grounding still see raw text.

Redaction is a best-effort safety net, not a guarantee: exotic
secret shapes can slip through. Do not crawl code you are not
willing to have a human reviewer see; verify zero-data-retention
routing on your gateway plan before sending private code
(`jev-judge --show-metadata`).

## Deny rules

Secret-bearing files are never read, in any directory (see
`lib/search.mjs` `DEFAULT_IGNORES`, plus any repo-local
`.crawlersignore`):

- `.env` and every `.env.*` variant (`.env.example` stays readable —
  example values only),
- private keys: `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`,
  `*.pem`, `*.key`.

## Manual test

No live Jev call needed (packState is pure):

```sh
npm test
```

`test/redact.test.mjs` covers key-name, entropy, Bearer, PEM, and
prefix detectors. `packState` is the choke point: a raw secret must
never appear in the packed judge state.
