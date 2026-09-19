# jev-crawlers

Recursive bug-discovery crawlers powered by Jev.

AI writes code faster than humans can review it. Linters match patterns. One-shot AI reviewers read a diff once and stop. Few tools follow the lead: they never ask "who else calls this?", "what config changes it?", "where does this input become trusted?" jev-crawlers does, and keeps going until the lead dries up.

The trick is cheap judgment. [Jev](https://vercel.com/docs/ai-gateway) (typesafe-ai/jev, via the Vercel AI Gateway) returns typed verdicts, choice, boolean, and score, for about $0.00008 per normal node in our calibration runs. When each judgment costs a fraction of a cent, you can judge every node instead of every scan.

## What is a crawler

A crawler chains small Unix-style commands. JSON goes in, JSON comes out. The commands pipe:

```
crawl-seed | crawl-expand | crawl-judge | crawl-verify | crawl-report
```

- **crawl-seed**: emits starting leads. Sources: the current diff, TODO and FIXME comments, and risky patterns (auth, money movement, eval, shell).
- **crawl-expand**: follows context cues from one lead. It finds symbol references (callers), files that change together in git history, and config files that name the symbol. It is mechanical. No model calls.
- **crawl-judge**: one Jev call per node. Typed answers: a `verdict` suggestion
  (expand, report, prune, escalate), a `bug_likely` ranking signal, a `risk`
  score from 0 to 3, and whether a falsifiable artifact is stated. Routing
  follows the risk bands; no route is gated on a raw boolean.
- **crawl-verify**: a separate verifier. It builds a falsifiable artifact for each report candidate (reproducer sketch) and checks that the artifact is grounded in real code. Anything that fails is an **unverified lead**, never a bug.
- **crawl-report**: renders the findings with full evidence chains.

**crawl** is the stateful driver. It owns recursion: canonical node identity (file, symbol, scope), a visited set, a priority frontier, and four stop rules (budget spent, depth cap, empty frontier, diminishing returns). The limits live outside the crawl primitives as flags and policy: `--budget` caps Jev spend, `--depth` caps recursion, the diminishing-returns gate stops dead crawls, and the question set routes low-confidence or high-blast-radius findings to a human. The crawler explores; the gates decide what it may cost and what reaches a human.

## Quickstart

You need Node 20 or newer and a Vercel AI Gateway key. The repo never stores your key.

```sh
npm install
export AI_GATEWAY_API_KEY="your-key-here"
./bin/crawl.mjs --repo /path/to/your/repo --seed diff --budget 40 --out report.md
```

Run one primitive on its own:

```sh
./bin/crawl-seed.mjs --repo /path/to/repo --todo \
  | ./bin/crawl-expand.mjs --repo /path/to/repo \
  | ./bin/crawl-judge.mjs \
  | ./bin/crawl-verify.mjs \
  | ./bin/crawl-report.mjs --out report.md
```

Copy `.crawlersignore` into the target repo to skip generated and vendored code. It never reads `.env` files.

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
  `./bin/crawl-judge.mjs --show-metadata < node.json` and read
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
- **No secret redaction.** Excerpts go to the gateway as-is. Only `.env`
  files are excluded from reading. Scan for secret-shaped values before
  crawling private code, and verify ZDR routing on your plan (see above).
- **Verification v0 checks grounding, not execution.** The verifier
  confirms the artifact names real code on disk. It does not run the
  reproducer. Measured 2026-09-19 (M20, supersedes M18): on 6
  human-confirmed bugs with the full production chain (driver attaches
  the node's own cited code locations before verification), the
  verifier accepted 6/6 bugs and 0/6 benign cases (precision 1.00,
  recall 1.00). With the judge's natural routing, 2/6 bugs are
  accepted as bugs and 4/6 escalate to a human. Scope: n=12 on a
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

## Docs

- `docs/crawlers-spec.pdf`: the full 37-page product specification.
- `docs/ARCHITECTURE.md`: graph model, data contracts, termination, and cost math.
- `docs/EVAL.md`: what Jev flagged during pre-release polish, and what changed.

## License

MIT. See `LICENSE`.
