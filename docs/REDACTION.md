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
`[REDACTED:credential]`. Two detectors (the spec's "entropy and
key-name detection"):

1. **Key-name**: an assignment whose key looks like a credential name
   (`api_key`, `secret`, `token`, `password`, `passwd`, `auth_token`,
   `bearer`, `client_secret`, `private_key`, …) — the value is
   replaced, e.g. `const api_key = "[REDACTED:credential]";`.
2. **Entropy**: a long quoted string (≥ 24 chars) over a token
   alphabet with high Shannon entropy (≥ 3.5 bits/char) — catches
   bearer tokens, hex keys, and opaque credential blobs.
3. **`Authorization: Bearer <token>`** — the canonical header shape,
   which has no assignment operator.

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
rm -rf /tmp/red_scratch && mkdir /tmp/red_scratch
printf 'function connect() {\n  const api_key = "EXAMPLE_KEY_NOT_REAL_12345";\n  return db.open(api_key);\n}\n' > /tmp/red_scratch/db.js
# 1. The pattern still seeds (redaction is pre-judge, not pre-seed):
./bin/jev-seed.mjs --repo /tmp/red_scratch --patterns | grep -c api_key  # expect >= 1
# 2. The judge input carries no raw secret (run from the repo root):
cat > ./red_check.mjs <<'EOF'
import { packState } from './lib/jev.mjs';
import { fileExcerpt } from './lib/search.mjs';
const { excerpt } = fileExcerpt('/tmp/red_scratch', 'db.js', 2, 40);
const { state, redactions } = packState({ file: 'db.js', symbolLine: 2, excerpt, evidence: [] });
if (state.includes('EXAMPLE_KEY_NOT_REAL_12345')) throw new Error('LEAK: raw secret in judge state');
if (!state.includes('[REDACTED:credential]')) throw new Error('no redaction marker');
console.log('clean;', JSON.stringify(redactions));
EOF
node ./red_check.mjs; rm ./red_check.mjs
```

Expected: the seeder fires, the packed state contains
`[REDACTED:credential]` and no raw secret, and `redactions` reports
`[{ "class": "credential", "count": N }]`.
