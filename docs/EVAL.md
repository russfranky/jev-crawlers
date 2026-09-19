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

## 6. Realignment to Jev's measured strengths (2026-09-19)

The policy was rebuilt around what the 37-case calibration actually
measured, and every assumption is now classified in
`docs/ASSUMPTIONS.md` (measured, research-backed, or unvalidated).

What changed and why:

- **Score-band routing.** Routes were gated on the `verdict` choice
  plus raw boolean thresholds (`bug_likely >= 0.6`,
  `artifact_stated >= 0.5`). The calibration says the risk score is
  the strength (safe mean 1.16, unsafe mean 2.19, zero false-safe) and
  raw booleans are the weakness (recall 0.00 at 0.5). Routing now
  follows the `risk` score bands: 2+ escalates first, 1-2 with an
  explicit report choice goes to verify, below 1 can prune.
- **No boolean decides a route alone.** `artifact_stated >= 0.5` was
  removed from the `file-report` gate; falsifiability is the separate
  verifier's job (it already demotes ungrounded artifacts to
  unverified leads). `bug_likely < 0.3` survives only inside the
  prune conjunction as converging evidence, never alone.
- **Review queue is the default sink.** Auto-prune was the default
  route (the easiest to take); now `review-queue` is the default and
  auto-prune needs the judge's explicit prune choice plus a low risk
  band plus boolean support-for-false. Escalation is first-class and
  first in route order, matching Jev's measured conservatism
  (`needs_human` mean 0.66).
- **Ranking-signal labels everywhere.** CLI output now prints
  `bug_likely P0.xx (ranking signal, not calibrated confidence)` and
  the risk band, per the vendor's own guidance to calibrate
  thresholds against labeled examples.
- **Verifier uses a risk floor**, not a boolean threshold
  (`--risk-floor`, default 1).

Jev polish on the realignment (uncalibrated sets, advisory):

- `set-review` against the new question set: no_boolean_gates P75 on
  the first draft (the `artifact_stated` threshold was the hedge).
  After removing it: no_boolean_gates P94, prune_hardest P98,
  review_default P97, risk_driven P98. One transient
  GatewayInternalServerError on the first attempt; the retry succeeded.
- `readme-audit2` on the rewritten Honest limits: honesty_caveats
  P97, unsupported_claim none at P85, claims_supported P30. The P30
  is the same uncalibrated-boolean noise seen in the first polish
  (P48-50 then); every cited number was checked mechanically against
  the register and matches. Recorded as advisory, not chased.
- Synthetic routing test: 10/10 cases route as designed, including
  prune-denied-by-uncertain-boolean going to the review queue.

Dogfood: `crawl --repo . --seed todo --seed patterns --budget 12`
against this repo itself. 23 seeds, 11 judgments, 5 pruned,
2 expanded, 4 escalated, frontier emptied. Est. cost $0.00088, avg
latency 2.5 s. The 4 escalations were human-reviewed: 3 were keyword
noise from the pattern seeder on docs, config, and a comment
(`auth` matching `API_KEY`, `money` matching the risk rubric quoted
in the docs); the judge was conservative and correctly sent them to
a human, who dismissed them. The 4th was the intentionally seeded
off-by-one in `examples/todo-app/checkout.js`: risk 2.72/3 (mass on
level 3, plausibly "money movement error" for a checkout total),
bug_likely P0.63, routed escalate-owner via the high risk band.
Note the behavior change: the same node routed file-report under the
old set and escalates under the new one. Both surface it to a
human; the new path is more conservative, which is the intended
direction. No code changes resulted; the findings were seeder noise
and the known fixture bug.

Total Jev spend for this realignment: about $0.0015 (11 dogfood
judgments plus 4 polish calls).

## 7. Known limits (not fixed here)

- The question set is proposed and uncalibrated. Thresholds (risk
  bands at 1 and 2, the converging-evidence prune rule, the
  diminishing-returns gate) are reasoned, not measured. Whether the
  risk-score separation transfers from incident narratives to code
  nodes is the first unvalidated assumption (U1). Measure precision
  and recall on seeded bugs before trusting a crawl.
- Jev probabilities are ranking signals, not calibrated bug confidence.
- Verification v0 checks artifact grounding, not execution. Running
  reproducers is roadmap.
- Zero data retention is requested from the gateway, not guaranteed,
  and per-request ZDR needs a Pro or Enterprise plan. Verify
  `planningReasoning` on your plan before sending private code.
- The full assumption register is `docs/ASSUMPTIONS.md`.
