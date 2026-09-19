# EVAL.md — pre-release Jev polish

Date: 2026-09-19. All judgments below used proposed, uncalibrated question
sets. Results are advisory, not proof. Total Jev spend for this polish:
under $0.001 (10 calls: 4 README audits, 1 claim diagnostic, 3 judge
smoke tests, 2 live crawl judgments).

## 1. README claims audit

A `readme-audit` set (boolean: claims_supported, honesty_caveats;
choice: unsupported_claim; score: fix_priority) ran against the README
four times via the jev-decide runner. Stable signals:

- honesty_caveats: P97. The limits are present and plain.
- unsupported_claim: "none" at P92-94. No false claim found.
- claims_supported: about P48-50 on all runs.

The boolean is uncalibrated, so P50 alone was not actionable. A
`weakest-claim` diagnostic pointed at concrete fixes, all applied:

1. **Absolute claim removed.** "Nobody follows the lead" became "Few
   tools follow the lead". The adversarial review had already rejected
   the absolute version: Greptile does autonomous multi-hop
   investigation.
2. **Gates made concrete.** "Gates live outside the crawl, same as the
   ralph-jev pattern" was the weakest claim (P53): ralph-jev is not in
   this repo and the sentence named no shipped gate. It now names the
   real gates: --budget, --depth, the diminishing-returns gate, the
   question-set escalation policy, and .crawlersignore.
3. **Cost numbers attributed.** The per-node and per-crawl bands now say
   they come from our Jev calibration runs, and that the driver reports
   estimated cost per crawl. Planning numbers, not promises.
4. **Real code gap fixed.** The README said "It never reads .env
   files", but the default ignore list did not exclude them. Added
   `.env` and `.env.*` (except `.env.example`, which stays scannable)
   to the default ignores. Verified: `.env` and `.env.local` ignored,
   `.env.example` still read, a TODO in `.env` not surfaced.

The residual P48-50 on the uncalibrated boolean did not move after the
fixes and no unsupported claim was ever found, so it is recorded as
advisory noise rather than chased further.

## 2. Judge question-set live test

The shipped `questions/crawl-judge.json` ran against three sample nodes
from the `examples/todo-app` fixture:

| Node | Verdict | bug_likely | artifact | Routing |
|---|---|---|---|---|
| Seeded off-by-one in `total()` | report (P100) | P97 | P98 | file-report |
| Benign `VERSION` constant | prune (P97) | P5 | P2 | auto-prune |
| TODO about rounding cents | expand (P60) | P66 | P5 | expand-node |

All three routed as designed. Note: the gateway rejected score
questions without ordered level criteria, so `severity` carries an
ordered criteria list and returns the matched level index (0-4).

## 3. Full pipeline live run

`crawl --repo examples/todo-app --budget 8` with a real key: 2 seeds, 2
Jev judgments, both routed expand, frontier emptied, no findings.
Estimated cost $0.00016, average judgment latency 1.25s. The
seed-judge-expand-verify-report path ran clean.

## 4. Verify and report paths

- A `file-report` judgment on the seeded bug produced a "bug (artifact
  attached, reproducer not executed)" finding with a grounded
  reproducer sketch (file, line, seed, evidence, code under test, how
  to falsify it).
- Demotion paths confirmed: bug_likely below threshold becomes an
  unverified lead; a report with no grounded artifact becomes an
  unverified lead; a `needs-artifact` routing escalates to a human.
  Nothing unverified is ever called a bug.

## 5. Known limits (not fixed here)

- The question set is proposed and uncalibrated. Thresholds
  (bug_likely 0.6, artifact 0.5, diminishing-returns gate) are reasoned,
  not measured. Measure precision and recall on seeded bugs before
  trusting a crawl.
- Jev probabilities are ranking signals, not calibrated bug confidence.
- Verification v0 checks artifact grounding, not execution. Running
  reproducers is roadmap.
- Zero data retention is requested from the gateway, not guaranteed.
  Verify it on your Vercel plan before sending private code.
