# Contributing

This repo is a small unix pipe. Keep it that way.

## Setup

```sh
npm install
npm test
./bin/crawl --repo ./examples/todo-app --dry-run --budget 8
```

A live crawl needs `AI_GATEWAY_API_KEY`. The repo never stores one.

## Rules

- One tool, one job. Stages speak JSON lines. Orchestration lives in `bin/crawl`.
- Do not invent thresholds. Measure first, then write the result into `docs/EVAL.md` and classify the claim in `docs/ASSUMPTIONS.md`.
- Redact before the network. `lib/jev.mjs` `packState()` is the only choke point. Add detectors in `lib/redact.mjs` and a test in `test/redact.test.mjs`.
- Verification grounds claims against disk. A fabricated `file:line` is an unverified lead, never a bug.
- Excerpts must be windowed around the hit line, not the first 30 lines of the file.

## Useful paths

- Stages: `bin/jev-seed.mjs`, `bin/jev-expand.mjs`, `bin/jev-judge.mjs`, `bin/jev-verify.mjs`, `bin/jev-report.mjs`, `bin/jev-verdict.mjs`
- Shared: `lib/{search,jev,evidence,graph,io,redact,verdicts,fingerprint}.mjs`
- Question set: `questions/crawl-judge.json`
- Human FP store: `data/fp-verdicts.json` (`./bin/jev-verdict.mjs --help`)
- Tests: `test/*.test.mjs` (`npm test`)
