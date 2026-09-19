# ASSUMPTIONS.md — every claim this repo makes about Jev

Date: 2026-09-19. Three classes:

- **MEASURED**: our own calibration data (`~/workspace/jev-experiment/REPORT.md`,
  n=37, 2026-09-17; plus this repo's `docs/EVAL.md` polish runs). Numbers are
  exact quotes from those runs.
- **RESEARCH-BACKED**: an external source actually read on 2026-09-19. The URL
  is given with what it does and does not say.
- **UNVALIDATED**: no measurement and no source. Each names the experiment
  that would validate it. Nothing here may be cited as evidence until then.

The design follows one rule from this register: route on the measured
strength (the risk score), never on the measured weakness (raw booleans),
and treat every probability as a ranking signal until a calibration run
says otherwise.

## Measured

**M1. Typed I/O works.** 37/37 Jev calls returned structured choice,
boolean, and score answers through AI SDK 7 `experimental_evaluate`.
Source: `~/workspace/jev-experiment/REPORT.md` §7.

**M2. Pricing: $0.042 per 1M input tokens, output free.** Measured
$0.00156 for the full 37-case run, about $0.000042 per call. Live crawl
in `docs/EVAL.md`: 2 judgments, $0.00016. Source: REPORT.md §1, §7.

**M3. Latency: p50 656 ms, p95 1.6 s** (n=37). Live crawl average
1.25 s per judgment. Serial calls, so a 500-node crawl takes minutes.
Source: REPORT.md §7, `docs/EVAL.md` §3.

**M4. The risk score separates safe from unsafe.** Mean risk: safe
changes 1.16, unsafe changes 2.19. All 7 known-unsafe incidents scored
risk >= 1.46 (five >= 2.4) with P(safe) <= 0.13. Zero false "safe"
calls across the whole set. Source: REPORT.md §7. Domain limit: the
cases were incident narratives and commit classification, not code-bug
detection. Transfer to per-node code risk is UNVALIDATED (U1).

**M5. Raw booleans are unreliable as gates.** `safe_to_automerge` at
threshold 0.5: tp=0, fp=0, tn=9, fn=28 (recall 0.00). At 0.3: precision
1.00, recall 0.07. P(safe) systematically underconfident: in the
[0.0, 0.2) bin the mean prediction was 0.12 while the actual safe rate
was 0.69. Source: REPORT.md §7. Design consequence: no policy route may
be gated on a raw boolean. The boolean may only appear inside a
conjunction of converging evidence, never alone.

**M6. Jev is conservative and escalation-happy.** `needs_human`: mean
0.66, 34/37 at or above 0.5. Source: REPORT.md §7. Design consequence:
the human review queue is the primary sink; escalation is a first-class
outcome, not a failure mode; auto-prune must be the hardest route.

**M7. Score questions need ordered level criteria.** The gateway
rejected score questions without them. Source: `docs/EVAL.md` §2.

**M8. Free-tier 429 throttling exists.** Intermittent
`GatewayRateLimitError` ("Free tier requests on this model are
rate-limited") on the free tier; paid credits resolved it. 429 is a
hard stop for that run. Source: REPORT.md §3.

**M9. Choice works for classification-like triage.** Category accuracy
31/37 (0.84); the fix/feature distinction that matters for triage was
clean. Source: REPORT.md §7. This is the closest measured analog to
the `verdict` choice, but code-node verdicts are still UNVALIDATED (U4).

**M10. Per-crawl cost bands are derived, not measured end to end.**
$0.00008 per normal node (headroom above the measured $0.000042 on
~1.1k-token states, for code-heavy states); $0.04 to $0.05 per 500
nodes near the state cap; up to $0.17 to $0.34 with heavy multi-file
context. Derivation: M2 pricing times measured token counts. A 500-node
live crawl has not been run (U10).

**M11. Small labeled eval of the judge on code (n=12, 2026-09-19).**
6 seeded bugs and 6 benign nodes from `examples/labeled-eval/`
(labels withheld from the judge). Risk bands: bugs 4 high / 2 mid /
0 low; benign 0 high / 0 mid / 6 low; mean risk 2.26 vs 0.13, the
risk=1 boundary separating all 12. `bug_likely` pairwise concordance
1.00 (bugs P0.76-0.93, benign P0.08-0.11). Routing: all 6 bugs to a
human (4 escalate, 2 file-report); all 6 benign auto-pruned. Source:
`docs/EVAL.md` §8 and `examples/labeled-eval/results-2026-09-19.json`.
Scope: one author, one fixture, visible bugs. Partially covers U1,
U2, U5; does not replace them.

**M12. ZDR planning confirmed live on our plan (2026-09-19).** One
call with `zeroDataRetention: true` returned 200 with
planningReasoning: "System credentials planned for: typesafe-ai. ZDR
requested: all 1 attempts support ZDR." Partially covers U8: one
observation on one key/plan, not a guarantee; Vercel docs still
describe per-request ZDR as a Pro/Enterprise feature. Operators
verify on their own plan with `crawl-judge --show-metadata`.

**M13. Jev per-question confidence and real list cost are live fields
(2026-09-19).** `providerMetadata.typesafe.confidence` returned
per-question values (e.g. risk 0.98, verdict 0.94); the judge now
attaches them to answers as `confidence`, labeled vendor-reported and
uncalibrated per R2. `providerMetadata.gateway.marketCost` returned
$0.000035 for the call; the judge returns it as `marketCostUsd` and
the driver prefers it over the M2 estimate.

**M14. Parallel judging is viable (2026-09-19).** 6 parallel
`crawl-judge` calls: 4.9 s wall vs about 8.6 s serial, 6/6
succeeded, zero 429s. Per-call latency rose to 4.1-4.8 s (from about
1.4 s serial). Partially covers U9.

**M15. Expansion reaches true context at depth 1, one case
(2026-09-19).** From the seeded off-by-one in `cart.js::total`,
mechanical expansion reached `checkout.js` (the caller) at depth 1
via symbol refs; frontier emptied by depth 3. One case. Partially
covers U6.

## Research-backed

**R1. Jev's I/O contract.** "Jev is a probabilistic decision model for
software: state goes in, typed Choice, Score, and Boolean answers come
out." Example uses include "Scoring urgency or risk before an action"
and "automate clear cases while routing uncertain ones to review".
Called with model `typesafe-ai/jev` via AI SDK 7 `experimental_evaluate`.
Source: https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
(Vercel, read 2026-09-19). What it does not say: anything about
calibration for code-bug detection.

**R2. Probabilities must be calibrated against labeled examples.**
"Calibrate probabilities and confidence against labeled examples from
your workflow." "Use Jev's probability distributions to estimate
outcomes, then choose decision thresholds using labeled examples from
your application. Keep probability separate from confidence and rubric
scores. The threshold belongs to your policy: test how often it permits
a wrong action and how much work it sends for review." Source: the
Vercel changelog above and
https://vercel.com/i/jev-probabilities-and-thresholds (read 2026-09-19).
This is the vendor's own guidance behind our "ranking signals, not
calibrated confidence" rule and the evaluation gate in the README.

**R3. What each signal means.** Choice probability: probability assigned
to one of the declared options. Boolean probability: probability the
statement is true; values near zero indicate support for false, values
near 0.5 indicate uncertainty. Score: "a probability-weighted position
on the ordered levels you supplied" — "Is a normalized Jev Score a
success probability? No." Separate Choice/Score confidence lives in
`result.providerMetadata.typesafe.confidence` (Jev-specific; do not
treat as shared across models). Source:
https://vercel.com/i/jev-probabilities-and-thresholds. Design
consequence: boolean P near 0 is evidence for prune (support for false);
P near 0.5 is evidence for review (uncertainty); score bands are rubric
positions, never success probabilities. This repo does not yet read the
providerMetadata confidence field (possible upgrade, not implemented).

**R4. Zero data retention is requested, not promised.** Per-request ZDR
sets `zeroDataRetention: true` in `providerOptions.gateway`. It is
available only to Pro and Enterprise customers; per-request has no
additional cost; team-wide costs $0.10 per 1,000 requests. If no
ZDR-compliant provider is available for the model, the request fails
with a 400 `no_providers_available` error. Verify actual routing by
inspecting `planningReasoning` in the response metadata. BYOK keys are
skipped by default when ZDR is enabled. Source:
https://vercel.com/docs/ai-gateway/capabilities/zdr (updated
2026-09-10, read 2026-09-19). What it does not say: any per-request
guarantee; ZDR is enforced by routing, and routing must be checked.

**R5. Jev is text-only at launch.** No image or audio input. Sources:
launch coverage, consistent across outlets (for example
https://jev-agent.com/, read 2026-09-19; fan site, weak but consistent
with the vendor's state-in/typed-answers-out contract in R1). Our
design sends text states only, so nothing depends on more.

**R6. Vendor speed and cost claims are vendor-reported.** TypeSafe
reports 70-500 ms end-to-end and large speedups over LLMs "on its
workflow evaluations"; the changelog repeats TypeSafe's figures with
attribution. Source: the Vercel changelog and
https://letsdatascience.com/news/typesafe-ai-launches-jev-decision-model-889a38c0
(read 2026-09-19). Not independently standardized. Our latency and cost
numbers (M2, M3, M10) are our own measurements and supersede these for
this repo.

**R7. Absence of evidence.** A search on 2026-09-19 found no published
independent evaluation of Jev bug-detection precision or recall, and no
Jev model card with calibration data for code tasks. This absence is
why U1, U2, U4, and U5 are unvalidated rather than merely unmeasured.

## Unvalidated

Each names the experiment that would validate it. Do not cite any of
these as evidence.

**U1. Risk-score separation transfers to code nodes (partially
measured).** M4 was measured on incident narratives and commit diffs.
M11 (n=12 labeled code nodes) shows the bands separating bugs from
benign code on one fixture. Full transfer to real-world code is still
unvalidated. Validate further: a larger labeled set from real repos;
measure precision and recall per risk band.

**U2. The thresholds are reasoned, lightly probed (partially
measured).** Risk bands at 1 and 2, `artifact_stated` at 0.5, the converging-evidence prune rule, and
the diminishing-returns gate were chosen by reasoning. M11 (n=12)
shows the band-1 boundary separating bugs from benign on one fixture.
Validate further: sweep
thresholds on a larger labeled set; measure mistakes against review
volume per the vendor's method (R2): "choose a cutoff by measuring
mistakes and review volume on representative labeled cases."

**U3. The 6,000-char state cap suffices.** Calibration states averaged
about 1,600 chars; code excerpts near the cap are untested. Validate:
ablation on the same nodes at 2k, 6k, and 12k chars; measure routing
agreement and cost per node.

**U4. The verdict choice behaves on code nodes like it did in triage.**
M9 covers commit classification. Whether expand/report/prune/escalate
distributes usefully on code leads is unknown. Validate: labeled node
set; measure per-class precision and recall of the choice.

**U5. `bug_likely` ranks code bugs (partially measured).** M11 (n=12)
shows pairwise concordance 1.00 on one fixture, but concordance is a
ranking property, not calibration. Validate further: larger labeled
set; report ranking metrics and keep the "ranking signal, not
calibrated confidence" label until a calibration run says otherwise.

**U6. Mechanical expansion reaches real bug context (partially
measured).** M15: from the seeded off-by-one in `cart.js::total`
(`examples/todo-app`), expansion reached the true context
(`checkout.js`, the caller) at depth 1 via symbol refs; frontier
emptied by depth 3. One case, one repo. Validate further: hit rate
over many seeded bugs with known true context, and whether depth-1
noise (README.md matched the symbol by text search) drowns the
signal at scale.

**U7. Verifier grounding approximates bug validity.** v0 checks that
the artifact names real locations and states an input, a wrong
behavior, and a reproduction path; it does not execute anything.
Validate: compare the grounding pass rate against human-confirmed true
bugs on the labeled set.

**U8. ZDR actually routes for `typesafe-ai/jev` on your plan
(partially measured).** Requested via `zeroDataRetention: true`;
M12 verified planning live on our plan ("all 1 attempts support
ZDR", 200). One key, one observation: routing can differ by plan,
so the README still tells every operator to verify with
`crawl-judge --show-metadata`.

**U9. Parallel judging throughput (partially measured).** M14: 6
parallel `crawl-judge` calls finished in 4.9 s wall (about 8.6 s
serial), 6/6 succeeded, zero 429s. Per-call latency degraded to
4.1-4.8 s (from about 1.4 s serial), so parallelism buys wall clock
at higher per-call cost. The driver stays serial for now; parallel
judging is viable when latency budgets demand it.

**U10. End-to-end crawl cost.** M10 is derived. Validate: run a
500-node crawl and measure actual input tokens and spend.

## What changed in the 2026-09-19 realignment

Before: policy routes were gated on the `verdict` choice plus raw
boolean thresholds (`bug_likely >= 0.6`, `artifact_stated >= 0.5`), and
auto-prune was the default route (the easiest to take). That design
trusted exactly the signals M5 says are unreliable, and it made the
cheapest route the one M6 says Jev is worst at.

After: routing is driven by the `risk` score bands (the measured
strength, M4). No route is decided by a raw boolean alone (M5):
`file-report` is risk band plus the explicit report choice, with the
separate verifier owning falsifiability; `artifact_stated` is recorded
for the reviewer but gates nothing. The review queue is the default
sink; escalation is first (M6, R1: "automate clear cases while routing
uncertain ones to review"). Auto-prune requires converging evidence:
the judge chose prune, the risk band is low, and the boolean shows
support for false (R3: near zero means support for false). Probabilities
are labeled ranking signals in every CLI output (R2).
