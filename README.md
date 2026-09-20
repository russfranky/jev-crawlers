# jev-crawlers

Small unix tools for bug-discovery, powered by Jev. One tool, one job, JSON lines on stdin/stdout, composed with pipes.

AI writes code faster than humans can review it. Linters match patterns. One-shot AI reviewers read a diff once and stop. Few tools follow the lead: they never ask "who else calls this?", "what config changes it?", "where does this input become trusted?" These tools do, and keep going until the lead dries up.

The trick is cheap judgment. [Jev](https://vercel.com/docs/ai-gateway) (typesafe-ai/jev, via the Vercel AI Gateway) returns typed verdicts, choice, boolean, and score, for about $0.00006 per normal node in our calibration runs. When each judgment costs a fraction of a cent, you can judge every node instead of every scan.

## The tools

Each tool reads JSON lines on stdin and writes JSON lines on stdout. They compose with plain shell pipes:

```
jev-seed --repo X | jev-judge | jev-verify | jev-report
```

- **jev-seed**: emits starting leads, one per line. Sources: the current diff, TODO and FIXME comments, and risky patterns (auth, money movement, eval, shell). Human false-positive verdicts (`data/fp-verdicts.json`) suppress exact repeats; suppressions log to stderr.
- **jev-expand**: follows context cues from one lead. It finds symbol references (callers), files that change together in git history, and config files that name the symbol. Mechanical. No model calls.
- **jev-judge**: one Jev call per node. Typed answers: a `verdict` suggestion
  (expand, report, prune, escalate), a `bug_likely` ranking signal, a `risk`
  score from 0 to 3, and whether a falsifiable artifact is stated. Routing
  follows the risk bands; no route is gated on a raw boolean. Recent
  human false-positive verdicts ride along as negative examples.
- **jev-verify**: a separate verifier and the keeper of the set (see below).
  It builds a falsifiable artifact for each report candidate (reproducer sketch) and checks that the artifact is grounded in real code: every cited file:line must exist on disk with matching content. Fabricated or missing citations fail closed. Anything that fails is an **unverified lead**, never a bug.
- **jev-report**: renders the findings with full evidence chains.

**crawl** is a thin orchestrator over the pipe. It owns recursion: canonical node identity (file, symbol, scope), a visited set, a priority frontier, and four stop rules (budget spent, depth cap, empty frontier, diminishing returns). The stages stay dumb filters; all orchestration lives here. The limits live outside the tools as flags and policy: `--budget` caps Jev spend, `--depth` caps recursion, the diminishing-returns gate stops dead crawls, and the question set routes low-confidence or high-blast-radius findings to a human.

## Quickstart

You need Node 20 or newer and a Vercel AI Gateway key. The repo never stores your key.

```sh
npm install
export AI_GATEWAY_API_KEY="your-key-here"
./bin/crawl --repo /path/to/your/repo --seed diff --budget 40 --out report.md
```

Run the pipe by hand, stage by stage:

```sh
./bin/jev-seed.mjs --repo /path/to/repo --todo \
  | ./bin/jev-expand.mjs --repo /path/to/repo \
  | ./bin/jev-judge.mjs \
  | ./bin/jev-verify.mjs --repo /path/to/repo \
  | ./bin/jev-report.mjs --out report.md
```

Copy `.crawlersignore` into the target repo to skip generated and vendored code. It never reads `.env` files.

## jev-verify as a standalone gate

`jev-verify` is deliberately dependency-light: node 20+, one shared
helper file (`lib/io.mjs`), no Jev calls, no key, no crawler imports. It
takes `{ node, judgment }` records on stdin — from any pipeline that can
emit them — and writes findings on stdout, one JSON object per line:

```sh
some-other-pipeline --format ndjson \
  | ./bin/jev-verify --repo /path/to/code --risk-floor 1
```

Each input record needs the shape the verifier grounds against: the
node's `file`, `symbol`, `excerpt`, and structured `evidence` items with
`file:line` citations (`{ kind: 'code', file, line, text }`), plus the
judgment's `routing` and `answers` (`verdict.choice`, `risk.score`,
`artifact_stated.probability`, `bug_likely.probability`). The verifier
reads every cited file:line off disk and confirms it exists with
matching content; a fabricated citation demotes the finding to an
**unverified lead** by itself. Routings in the escalate family
(`escalate-owner`, `needs-artifact`, `review-queue`) pass through as
`escalated` — the verifier never invents a bug claim the judge did
not make. Driver-internal routings (`expand-node`, `auto-prune`) are
not findings and produce no output; the driver consumes those before
verification.

Example: gating the ThatMgmt Jev loop. The loop's gates (`ralph-jev`)
already emit typed judgments per step; piping a gate's output through
`jev-verify` before acting on a `file-report`-style claim adds the
evidence-grounding check for free:

```sh
node libexec/jev-decide.mjs --gate output-verify --format ndjson \
  | /path/to/jev-crawlers/bin/jev-verify --repo /path/to/thatmgmt --risk-floor 1 \
  | node -e "let s='';for await (const c of process.stdin) s+=c;
     for (const l of s.split('\n')) { if (!l.trim()) continue;
       const f = JSON.parse(l);
       if (f.status === 'bug') { console.log('GROUNDED:', f.artifact.text.split('\n')[0]); process.exit(0); }
       if (f.status === 'unverified-lead') { console.log('DEMOTED:', f.note); process.exit(1); } }"
```

Exit 0 means the claim cites real code; exit 1 means it did not survive
verification. The gate keeps its own policy; `jev-verify` only answers
"does this claim cite real code?"

## Honest limits

This is an experiment, not a finished product. Read this before you trust it.
Every assumption below is classified and sourced in `docs/ASSUMPTIONS.md`
(measured, research-backed, or unvalidated).

- **Routing follows the risk score, never a raw boolean.** Our 37-case
  calibration showed the risk score separates safe from unsafe (safe mean
  1.16, unsafe mean 2.19, zero false-safe), while the raw booleans are
  unusable as gates (`safe_to_automerge` recall 0.00 at threshold 0.5).
  Policy routes are driven by the `risk` score bands; the `verdict`
  choice and the booleans are supporting signals only.
- **Jev probabilities are ranking signals, not calibrated bug confidence.**
  A P0.8 from the judge means "rank this above the P0.4 lead", not "this
  is a bug with 80% probability". The vendor says the same: choose
  thresholds from labeled examples in your own workflow.
- **The review queue is the primary sink.** Jev is conservative and
  escalation-happy (`needs_human` mean 0.66 in calibration), so the
  design treats that as the product's shape: uncertain leads go to a
  human, escalation is a first-class outcome, and auto-prune is the
  hardest route to take (it needs converging evidence: the judge chose
  prune, the risk band is low, and the boolean shows support for false).
- **Only one small labeled eval of Jev bug detection exists so far.**
  `docs/EVAL.md` §8 ran the judge on 12 labeled code nodes (6 seeded
  bugs, 6 benign): perfect risk-band separation and routing. n=12,
  one fixture, bugs chosen to be visible. A start, not proof.
  Whether the separation holds on real code is still unvalidated.
  See `docs/ASSUMPTIONS.md`.
- **Zero data retention is requested and verified on our plan.**
  The judge config asks the gateway for zero data retention, and a
  live call on our plan returned planningReasoning: "ZDR requested:
  all 1 attempts support ZDR" with a 200. One observation, not a
  guarantee: per-request ZDR is a Pro/Enterprise feature per Vercel's
  docs, and routing can differ by plan and model. Verify on yours:
  `./bin/jev-judge.mjs --show-metadata < node.json` and read
  `providerMetadata.gateway.routing.planningReasoning` before you
  send private code.
- **Jev cannot see images.** States carry text evidence only.
- **Cost and latency are measured.** Live judgments cost about $0.00006
  per call (gateway-reported list cost, mean over 493 nodes on a real
  repo, 2026-09-19), inside the $0.00008 per-call headroom budget. A
  500-node crawl measured $0.03 total, 1,432 mean input tokens per node,
  10.2 minutes wall clock at 6-parallel judging, mean latency 2.5 s per
  call. The driver uses the gateway-reported cost when it is present and
  reports the cost for every crawl. Heavy multi-file context can cost
  more; that upper band is still derived, not measured. Budget
  accordingly.
- **Pre-judge redaction.** Credential-shaped values (key-named
  assignments, `Authorization: Bearer` tokens, high-entropy blobs) are
  stripped from excerpts and evidence and replaced with
  `[REDACTED:credential]` before any network call; local stages (seed,
  expand, verify) still work on raw text. Deny-listed secret files
  (`.env`, private keys, `*.pem`) are never read. Full contract:
  `docs/REDACTION.md`.
- **Verification v0 checks grounding, not execution.** The verifier
  confirms the artifact names real code on disk. It does not run the
  reproducer. Measured 2026-09-19 (M20, supersedes M18): on 6
  human-confirmed bugs with the full production chain (driver attaches
  the node's own cited code locations before verification), the
  verifier accepted 6/6 bugs and 0/6 benign cases (precision 1.00,
  recall 1.00). With the judge's natural routing, 2/6 bugs are
  accepted as bugs and 4/6 escalate to a human. Re-measured 2026-09-20
  after the unix-pipe rebuild (`jev-seed | jev-judge | jev-verify`):
  forced path still 6/6 and 0/6, evidence-stripped still 0/12;
  natural routing 3/6 accepted and 3/6 escalated (judge variance of
  one node between runs). See `docs/EVAL.md` §20. Scope: n=12 on a
  synthetic fixture; the check is falsifiability-grounding, not
  independent bug derivation. Findings say "artifact attached,
  reproducer not executed".
- **The question set is proposed and uncalibrated.** All thresholds
  (risk bands at 1 and 2, the prune rule, the diminishing-returns gate)
  are reasoned, not measured. Tune them only after measuring precision
  and recall on your own seeded bugs.

## The question set

`questions/crawl-judge.json` holds the Jev question set for node verdicts. Routing
is driven by the `risk` score bands (low: below 1, moderate: 1 to 2, high:
2 and up), the measured strength from our calibration; no route is decided
by a raw boolean alone. The review queue is the default sink and
auto-prune needs converging evidence (explicit prune choice, low risk
band, and the boolean showing support for false). The set is **proposed
and uncalibrated**: every threshold is reasoned, not measured. One file,
human-reviewable, same format as the jev-decide runner. See
`docs/ASSUMPTIONS.md` for what is measured, what is research-backed, and
what is still unvalidated. Tune the thresholds only after you measure
precision and recall on your own seeded bugs.

## For agents

Repo map:

- `bin/jev-seed.mjs`, `bin/jev-expand.mjs`, `bin/jev-judge.mjs`,
  `bin/jev-verify.mjs`, `bin/jev-report.mjs`: the five stage tools. Thin
  arg-parsing; the real logic lives in `lib/`.
- `bin/crawl`: the orchestrator. Owns budgets, frontier, depth, stop
  rules, run summaries.
- `lib/search.mjs`: seeder mechanics (grep, diff, TODO scan, FP verdict
  matching). `lib/jev.mjs`: Jev client and context packing.
  `lib/evidence.mjs`: verifier grounding. `lib/graph.mjs`: node
  identity. `lib/io.mjs`: NDJSON plumbing.
- `questions/crawl-judge.json`: the Jev question set. Human-reviewable;
  every threshold is proposed, not calibrated.
- `data/fp-verdicts.json`: human false-positive verdicts. Entries
  suppress exact repeats; see below.
- `examples/verifier-eval/`: the 12-node labeled fixture
  (`run-verifier-eval.mjs`, dated results). Re-run it after touching
  seed, judge, or verify semantics.
- `docs/ASSUMPTIONS.md`: every design claim classified as measured,
  research-backed, or unvalidated. Read before changing a threshold.
- `docs/EVAL.md`: what was measured and when. The latest section is
  the current truth; older sections are history.
- `docs/crawlers-spec.pdf`: the full 37-page product spec.

Workflows:

```sh
# Re-check seed/judge/verify semantics (costs a few cents of Jev)
node examples/verifier-eval/run-verifier-eval.mjs

# Run a crawl
./bin/crawl --repo /path/to/repo --seed diff --budget 40 --out report.md
```

Record a false positive: append
`{file, line, pattern, evidence, verdict: "false-positive", reason, date}`
to `data/fp-verdicts.json`. `file` is repo-root-relative; the seeder
matches on trailing segments, so verdicts also apply to runs scoped to
a subdirectory. Suppression needs an exact repeat of file, pattern, and
evidence text; it never weakens patterns.

Add a seed pattern: extend the pattern table in `bin/jev-seed.mjs`.
Keep the noise guards: bare words like `token` or `system` are banned
as patterns because they match prose.

Rules: the repo never holds a key (`AI_GATEWAY_API_KEY` comes from the
environment). Do not invent thresholds; measure first, then write the
result into `docs/EVAL.md` and classify the claim in
`docs/ASSUMPTIONS.md`.

## Docs

- `docs/crawlers-spec.pdf`: the full 37-page product specification.
- `docs/ARCHITECTURE.md`: graph model, data contracts, termination, and cost math.
- `docs/EVAL.md`: what Jev flagged during pre-release polish, and what changed.

## License

MIT. See `LICENSE`.
