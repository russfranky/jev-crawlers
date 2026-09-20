# Telemetry

Opt-in run telemetry for `bin/crawl`, per spec section 19 (Safety and
Privacy): **telemetry is off by default for local runs; opt-in
telemetry contains counts and timings, not source or paths.**

It exists so the delivery plan's kill criteria stay measurable:
whether recursion beats the flat baseline, where time and cost go per
run, and how termination reasons distribute — without ever retaining
what was crawled.

## Enabling

```sh
bin/crawl --repo PATH --telemetry
```

Without `--telemetry`, no telemetry file is created, touched, or read.
The crawl behaves exactly as before.

## Record

One NDJSON record is appended per run to `data/telemetry.jsonl` (the
crawler's own data directory — never the crawled repository). The file
is gitignored and never committed.

Schema (v1):

```json
{
  "ts": "2026-09-20T16:00:00.000Z",
  "schema": 1,
  "counts": {
    "seeds": 3, "nodesVisited": 8, "judgments": 8,
    "pruned": 8, "expanded": 0, "depthCapped": 0, "candidates": 0,
    "bugs": 0, "unverifiedLeads": 0, "escalated": 0
  },
  "timingsMs": {
    "seed": 120, "judge": 4500, "expand": 30,
    "verify": 0, "report": 5, "total": 4700
  },
  "estCostUsd": 0.00064,
  "termination": "diminishing-returns",
  "dryRun": false
}
```

- `timingsMs` are driver-measured wall times per pipeline stage.
- `estCostUsd` is the same estimate the driver already reports.
- `termination` is one of `frontier-empty`, `budget-exhausted`,
  `diminishing-returns`.

## Privacy boundary

A telemetry record contains **only** aggregate counts, stage timings,
estimated cost, the termination reason, and the run timestamp. It
**never** contains:

- file paths (including `--repo` and `--only` values),
- source code, excerpts, or symbol names,
- finding details, judgment contents, or evidence,
- credentials or keys.

The record is built exclusively from the driver's counters and
timers; node records are never serialized into it.
