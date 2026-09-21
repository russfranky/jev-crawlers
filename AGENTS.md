# Agents

This is a small unix pipe. Keep it that way.

## Commands

```sh
npm test
./bin/crawl --repo ./examples/todo-app --dry-run --budget 8
```

A live crawl needs `AI_GATEWAY_API_KEY`. The repo never stores one.

## Layout

- Stages: `bin/jev-seed.mjs`, `bin/jev-expand.mjs`, `bin/jev-judge.mjs`, `bin/jev-verify.mjs`, `bin/jev-report.mjs`, `bin/jev-verdict.mjs`
- Driver: `bin/crawl`
- Shared: `lib/{search,jev,evidence,graph,io,redact,verdicts,fingerprint}.mjs`
- Question set: `questions/crawl-judge.json`
- Human FP store: `data/fp-verdicts.json`
- Tests: `test/*.test.mjs`

## Rules

- One tool, one job. Stages speak JSON lines. Orchestration lives in `bin/crawl`.
- Do not invent thresholds. Measure first, then write the result into `docs/EVAL.md` and classify the claim in `docs/ASSUMPTIONS.md`.
- Redact before the network. `lib/jev.mjs` `packState()` is the only choke point.
- Verification grounds claims against disk. A fabricated `file:line` is an unverified lead, never a bug.
- Excerpts must be windowed around the hit line, not the first 30 lines of the file. `fileExcerpt` returns `excerptStartLine`; `packState` indexes the excerpt with that offset.
- Never add product branding or ads to commits, PRs, or docs.
