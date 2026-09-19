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
- **crawl-judge**: one Jev call per node. Typed verdict: expand, report, prune, or escalate, with probabilities and cited evidence.
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

- **Jev probabilities are ranking signals, not calibrated bug confidence.** A P0.8 from the judge means "rank this above the P0.4 lead", not "this is a bug with 80% probability".
- **No precision or recall evaluation of Jev bug detection exists yet.** The calibration data we have covers commit classification and process triage, not code-bug detection. The first release is a precision/recall experiment. See `docs/EVAL.md`.
- **Zero data retention is requested, not promised.** The judge config asks the gateway for zero data retention. Your Vercel plan must support it. Verify routing before you send private code.
- **Jev cannot see images.** States carry text evidence only.
- **Cost and latency are real.** In our Jev calibration runs we measured about $0.00008 per normal node, $0.04 to $0.05 for a 500-node crawl, and up to $0.17 to $0.34 with heavy multi-file context. Serial calls run about 1 second each, so a 500-node crawl takes minutes. The driver reports estimated Jev cost for every crawl. Treat the bands above as planning numbers, not promises. Budget accordingly.
- **Verification v0 checks grounding, not execution.** The verifier confirms the artifact names real code and states an input, a wrong behavior, and a reproduction path. It does not run the reproducer. Findings say "artifact attached, reproducer not executed".

## The question set

`questions/crawl-judge.json` holds the Jev question set for node verdicts. It is **proposed and uncalibrated**: the wording is reasoned, not measured. One file, human-reviewable, same format as the jev-decide runner. Tune the thresholds only after you measure precision and recall on your own seeded bugs.

## Docs

- `docs/crawlers-spec.pdf`: the full 37-page product specification.
- `docs/ARCHITECTURE.md`: graph model, data contracts, termination, and cost math.
- `docs/EVAL.md`: what Jev flagged during pre-release polish, and what changed.

## License

MIT. See `LICENSE`.
