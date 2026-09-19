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
- **Zero data retention is requested, not promised.** The judge config
  asks the gateway for zero data retention. Per-request ZDR is available
  only to Pro and Enterprise customers, and a request fails if no
  ZDR-compliant provider serves the model. Verify routing in
  `planningReasoning` before you send private code.
- **Jev cannot see images.** States carry text evidence only.
- **Cost and latency are real.** In our Jev calibration runs we measured
  about $0.00008 per normal node (headroom above the measured $0.000042
  on ~1.1k-token states), $0.04 to $0.05 for a 500-node crawl near the
  state cap, and up to $0.17 to $0.34 with heavy multi-file context. The
  bands are derived from measured per-call cost and gateway pricing,
  not measured end to end. Serial calls run about 1 second each, so a
  500-node crawl takes minutes. The driver reports estimated Jev cost
  for every crawl. Budget accordingly.
- **Verification v0 checks grounding, not execution.** The verifier
  confirms the artifact names real code and states an input, a wrong
  behavior, and a reproduction path. It does not run the reproducer.
  Findings say "artifact attached, reproducer not executed".
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
