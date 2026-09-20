# Architecture

## The graph

A crawl explores a graph of **nodes**. One node is one lead: a file, a symbol, and an enclosing scope.

- **Identity**: `file::scope::symbol`. Two leads with the same identity are the same node. This kills cycles and duplicate work.
- **Visited set**: the driver judges each identity once per crawl.
- **Priority frontier**: a max-heap. Child priority = parent priority x decay (default 0.85), plus a boost when the judge says "expand" with high bug_likely. Ties favor shallow depth, so the crawl stays near the seed.

## The four primitives and the driver

The primitives are interfaces. The driver (`bin/crawl`) owns recursion.

```
jev-seed --repo X | jev-expand --repo X | jev-judge | jev-verify --repo X | jev-report
```

| Command | Input | Output | Model calls |
|---|---|---|---|
| jev-seed | flags | seed nodes, one per line (NDJSON) | none |
| jev-expand | node(s) | child nodes, one per line | none |
| jev-judge | node(s) | {node, judgment}, one per line | 1 Jev call per node |
| jev-verify | judged nodes | findings, one per line | none |
| jev-report | findings | markdown + JSON | none |

Gates live outside the crawler. Budget, depth, and the diminishing-returns gate are driver flags. Escalation policy is in the question set. The repo never holds a key; the judge reads `AI_GATEWAY_API_KEY` from the environment and fails closed without it.

## Termination

The driver stops on the first of:

1. **Budget spent**: the judgment count hits `--budget` (default 60).
2. **Depth cap**: nodes deeper than `--depth` (default 6) are not expanded.
3. **Empty frontier**: no leads left.
4. **Diminishing returns**: the last 8 judgments were all low-risk
   outcomes (pruned or sent to the review queue, all in the low risk
   band). The crawl is no longer finding anything worth a human's time.

## Expansion (mechanical)

`jev-expand` never calls a model. For each node it emits:

- **symbol-refs**: other files that mention the symbol (callers, importers).
- **co-change**: files that changed with this file in at least 2 of the last 60 commits.
- **config-ref**: config files (package.json, YAML, TOML, .config.js, .env.example) that name the symbol. Real `.env` files are never read.

AST and language-server expansion is roadmap. The current text search is honest about what it is.

## Judgment and context packing

`jev-judge` sends one packed state per node to Jev (`typesafe-ai/jev` via the AI Gateway). Truncation order is explicit; nothing drops silently:

1. Repo metadata drops first (informational only).
2. Evidence beyond the first 8 entries drops next.
3. The file excerpt window shrinks symmetrically around the symbol line.
4. Identity, seed context, and the question block never truncate.

The packer reports what it truncated in the judgment JSON.

The question set (`questions/crawl-judge.json`) asks four typed questions: a
`verdict` choice (expand, report, prune, escalate) used as a suggestion, a
`bug_likely` boolean kept as a ranking signal, a `risk` score from 0 to 3
with ordered level criteria, and an `artifact_stated` boolean. Routing is
driven by the risk score bands: 2 and above escalates to a human first;
1 to 2 with an explicit report choice goes to `file-report`, where the
verifier assembles and grounds the falsifiable artifact; below 1 with an
explicit prune choice and support-for-false from the boolean auto-prunes. The review queue is the default route: uncertain,
weak, or contradictory signals go to a human. No route is gated on a raw
boolean. This follows the measured evidence: the risk score separated
safe from unsafe in calibration (safe mean 1.16, unsafe mean 2.19, zero
false-safe), while the raw booleans were unusable as gates, and Jev runs
conservative and escalation-happy. Every assumption behind this design is
classified in `docs/ASSUMPTIONS.md` as measured, research-backed, or
unvalidated. The set is proposed and uncalibrated. Treat every
probability as a ranking signal.

## Verification

`jev-verify` is the separate verifier the spec requires. For each report candidate it assembles a falsifiable artifact (reproducer sketch: location, seed, wrong behavior, evidence, code under test, and how to falsify it) and checks grounding:

- the artifact names the real file, symbol, and line;
- the evidence names an input or trigger and the wrong behavior;
- the node has a non-empty code excerpt.

Anything that fails becomes an **unverified lead**. The report never calls it a bug. v0 does not execute reproducers; findings say so. As a defensive second check, the verifier demotes any `file-report` whose risk score sits below the `--risk-floor` (default 1): a score-band check, consistent with routing, never a boolean gate.

## Cost math

Honest numbers, measured or derived from the Jev calibration work (see
`docs/ASSUMPTIONS.md` for the register):

- One normal node: about $0.00008 of Jev input tokens (output is free).
  Derived with headroom above the measured $0.000042 per call on
  ~1.1k-token states.
- 500 nodes near the state cap: $0.04 to $0.05. Derived, not measured
  end to end.
- 500 nodes with realistic multi-file context: $0.17 to $0.34. Derived,
  not measured end to end.
- Latency: about 1 second per node, serial (measured p50 656 ms,
  p95 1.6 s). Parallel judging is untested.

The driver reports estimated cost per crawl. Set `--budget` to cap spend.

## Provenance

The question-config format and the predicate policy engine are ported from the `jev-decide.mjs` runner used in the Jev loop-gate work. The gate-outside-the-worker pattern comes from the ralph-jev gates. The crawler primitives and the driver are new, written to the approved spec (`docs/crawlers-spec.pdf`).
