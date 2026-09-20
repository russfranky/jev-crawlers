# Reviewer outcome records

Reviewer outcome records close the feedback loop the false-positive
suppression started (spec §18: "Suppressions are explicit records with
fingerprint, reason, author, creation time, and optional expiry").
They live in `data/fp-verdicts.json`, a JSON array.

## Schema

Legacy fields (present on every record shipped before 2026-09-20):

| field    | meaning                                                        |
|----------|----------------------------------------------------------------|
| file     | repo-relative path of the finding                              |
| line     | 1-based line number (may shift; never used as the match key)   |
| pattern  | seed type that fired, e.g. `pattern:auth`                      |
| evidence | matched evidence text verbatim, or `null` for class-level notes |
| verdict  | `false-positive` (only value shipped so far)                   |
| reason   | human-readable reason for the verdict                          |
| date     | creation date (`YYYY-MM-DD`)                                   |

New fields (all optional; absent on legacy records):

| field       | meaning                                                                 |
|-------------|---------------------------------------------------------------------------|
| fingerprint | `sha256:<64 hex>` stable finding identity (see `lib/fingerprint.mjs`); the cross-run key CI uses to mark a finding unchanged / resolved / regressed |
| author      | who recorded the outcome                                                  |
| created     | ISO-8601 creation time (supersedes `date` for new records)                |
| expires     | ISO-8601 expiry time, or `null`. An expired record no longer suppresses seeds and is no longer fed to the judge as a negative example; the finding is reconsidered on the next run |

## Semantics

- **Suppression is unchanged.** A seed is suppressed only when its
  `(file, pattern, matched evidence text)` exactly repeats a
  `verdict: false-positive` entry with non-null evidence — never by
  bare file:line, since lines shift. The fingerprint is the stable
  identity for CI; the seeder still matches on the evidence triple
  because fingerprints are computed downstream in `jev-verify`,
  after seeding.
- **Legacy records behave exactly as before.** Records without the new
  fields validate, suppress, sort (by `date`), and log exactly as they
  always have. Verified by a before/after seeder parity run, 2026-09-20
  (see progress log).
- **Expiry is enforced.** A record whose `expires` time has passed
  stops suppressing and drops out of the judge's negative examples.
  Records without `expires` never expire.
- **Negative examples.** `packState` feeds the 10 most recent
  unexpired `false-positive` verdicts to the judge (newest first by
  `created`, falling back to `date`).

## Recording an outcome

```sh
bin/jev-verdict.mjs \
  --fingerprint sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --verdict false-positive \
  --reason "Fixture label, not a committed secret." \
  --author russ \
  --file examples/labeled-eval/bugs.js --line 21 \
  --pattern pattern:auth \
  --evidence 'bugType: hardcoded-secret'
```

Required: `--fingerprint`, `--verdict` (`false-positive` |
`accepted-finding`), `--reason`, `--author`. Optional: `--expires
YYYY-MM-DD`, `--file`, `--line`, `--pattern`, `--evidence`.
Malformed records are refused (exit 64) and nothing is appended.
`--file/--line/--pattern/--evidence` locate the finding for the
suppression matcher; omit them for a class-level note (never
suppresses, still teaches the judge).

## Backfill note (2026-09-20)

No fingerprints were backfilled onto the 19 existing records. The v1
fingerprint preimage requires the judge's verdict choice
(`report`/`escalate`), which no existing record stores — computing one
would mean inventing it, so the field stays absent. New records
written via `bin/jev-verdict.mjs` always carry one.
