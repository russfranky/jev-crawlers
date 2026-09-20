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

**M10. Per-crawl cost bands were derived, then measured (see M19).**
$0.00008 per normal node was headroom above the measured $0.000042 on
~1.1k-token states, for code-heavy states; $0.04 to $0.05 per 500
nodes near the state cap; up to $0.17 to $0.34 with heavy multi-file
context. Derivation: M2 pricing times measured token counts.
Superseded for the base case by M19 (measured 2026-09-19: $0.02965
for 493 nodes, mean $0.00006/node). The heavy-context upper band
remains derived.

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

**M16. Verdict choice per-class behavior, n=12 (2026-09-19).** On the
labeled set the choice never crossed classes: bugs 4 report / 2
escalate / 0 prune / 0 expand; benign 6 prune. Partially covers U4;
the choice is a supporting signal, risk bands drive routing.

**M17. State-cap ablation, small states (2026-09-19).** Routing
agreed 6/6 across 2k/6k/12k caps on 2 nodes; risk stable; no
truncation fired. Partially covers U3; large states untested.

**M18. The verifier demotes all true bugs on real pipeline evidence
(n=12, 2026-09-19).** `examples/verifier-eval/`: 6 human-confirmed bugs
+ 6 benign nodes from the labeled fixture; evidence strings byte-identical
to real `crawl-seed` output (only 1 of 12 nodes had any seeder evidence;
seeds carry `evidence: []` as shipped). Judge run for real (bugs 4
escalate / 2 file-report, benign 6 auto-prune); routing forced to
file-report to isolate the verifier, judge's real answers kept. Verifier:
accepted **0/6 bugs, 0/6 benign** — recall 0.00, precision undefined (no
accepts at all). All 6 bugs demoted on grounding gaps: 5 on "no input or
trigger" + "no wrong behavior", 1 (applyDiscount, the eval injection, the
only node with real seeder evidence) on "no input or trigger" alone. Root
causes: (1) the grounding regexes demand judge-like vocabulary
("input/trigger/call", "wrong/bug/fail") but real seeder evidence is raw
code lines; (2) `groundedGaps` scans `node.evidence` only and ignores
`node.seed`; (3) the verifier never consults the judge's own stated
artifact (the 'report' verdict choice, `artifact_stated`). Control: the
same bug node with vocabulary-carrying evidence is accepted as 'bug' —
the gate is satisfiable, the pipeline just never feeds it. Source:
`examples/verifier-eval/results-2026-09-19.json`. Design consequence: as
shipped, the verifier's grounding decision carries no signal on real
pipeline output — every file-report becomes an unverified lead and stays
with a human, which is safe but means the "verified bug" status is
currently unreachable. U7's positive claim is NOT validated.

**M20. Verifier grounding tracks bug validity on labeled cases
(n=12, 2026-09-19).** Supersedes M18. The fix: the driver now
attaches the node's own cited code locations into the judgment
record before verification runs (`lib/evidence.mjs`,
`bin/crawl.mjs`); `crawl-verify` unions them with the node's
evidence for on-disk grounding, and a fabricated citation still
demotes by itself (fail-closed). Re-ran
`examples/verifier-eval/` with the full production chain (real
seeder evidence on the node, driver attach step on the judgment,
judge run for real with labels withheld: bugs 4 escalate /
2 file-report, benign 6 auto-prune). Routing forced to file-report
with the judge's real answers kept: the verifier accepted **6/6
bugs, 0/6 benign** — precision 1.00, recall 1.00. With the judge's
natural routing, 2/6 bugs reach file-report and are accepted as
bugs; the other 4/6 escalate to a human (recall 0.333 on "bug"
status, nothing lost — escalation is the primary sink by design,
so in production terms all 6 bugs reach a human). Control
(evidence stripped): 0/12 accepted — the mechanism still requires
real evidence. Benign demotions rest on the judge's own answers
(verdict=prune, risk below floor), not on grounding gaps: the
vocabulary mismatch is closed. Honest scope: n=12 on a synthetic
fixture; the verifier checks falsifiability-grounding (the claim
cites real on-disk code, the judge stated a bug claim, risk at or
above floor), not independent bug derivation; v0 does not execute
reproducers. Source:
`examples/verifier-eval/results-2026-09-19.json`. U7's positive
claim is VALIDATED within this scope.

**M21. Seeder pattern noise cut, measured before/after on mobhunter
(2026-09-19).** The probation bug hunt (128 judgments, 28
candidates, 27 false positives) traced its two biggest noise
classes to the seeder's `patterns` table in `bin/crawl-seed.mjs`,
not the judge: `shell` matched Luau's `task.spawn` (a coroutine
scheduler, 166 hits) and bare `spawn (`/`system (` matched English
prose ('respawn (pool', 'the weather system (rain'), while `auth`
fired on the bare word 'token' (item display names, parser tokens,
XML serialization). Fix, in the existing table: `shell` now only
fires on real OS-invocation forms (`exec(`/`execSync(`/`os.execute`/
`io.popen`/`child_process.spawn`); `token` moved out of `auth` into
a new `auth-token` entry that requires an auth qualifier
(session/access/refresh/bearer/csrf/id/api/auth/secret/sign),
a secret-ish suffix, a context word on the same line, or a
secret-shaped value nearby — never a bare word match. Measured
with `node bin/crawl-seed.mjs --repo <subtree> --patterns` before
and after on the same mobhunter subtrees the hunt used: game
1362 -> 937 seeds (-425, -31%), with `pattern:shell` 233 -> 0
(all 233 were noise) and `pattern:auth` 401 -> 180 plus 29
`pattern:auth-token` (all 29 genuinely auth-adjacent, e.g.
ProfileStore session tokens; zero display-name junk); web 48 ->
46. The original SESSION_SECRET finding still fires (via `auth`
on the public fallback constant), confirmed by re-seeding the
website subtree. Patterns keep their intent — sanity checks
confirm `exec('ls')`, `os.execute(cmd)`, `io.popen`, and
`child_process.spawn` still fire — they just no longer match
prose. Zero Jev calls; this was mechanical.

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

**M19. End-to-end crawl cost, measured on 493 nodes (2026-09-19).**
`examples/cost-eval/`: real `crawl-seed --patterns --todo` on the
owner's mobhunter repo (1,781 seeds), top 500 by priority, excerpts
attached exactly as the driver does (30-line window). Every excerpt
was secret-scanned before sending: 0/500 dropped, no secret-shaped
values found. Note: the tooling has NO secret redaction (verified by
code inspection 2026-09-19) — only `.env` files are excluded from
reading; excerpts go to the gateway as-is. 493/500 nodes judged via
the real `crawl-judge` in parallel batches of 6; 7 failed (2
transient `GatewayInternalServerError` after 3 retries, 5 on
pathological 300KB+ single-line JSON research files whose judge
output was unparseable). Measured: 705,863 input tokens (mean
1,432/node), 49,081 output tokens, **$0.02965 total spend**
(gateway `marketCost` present on all 493; mean **$0.00006/node**),
10.2 min wall clock, mean latency 2.5 s/call under parallel-6,
4 nodes truncated. Routing mix on real code: 254 expand, 113
auto-prune, 89 escalate-owner, 29 review-queue, 7 file-report,
1 needs-artifact. Source:
`examples/cost-eval/results-2026-09-19.json`. Scope: seed nodes
only, no expansion judgments; a real crawl's expansion adds more
judgments at the same per-node rate. ZDR requested on every call
(`zeroDataRetention: true` in the question config); per M12/R4 each
operator still verifies routing on their own plan.

**M22. Dogfood self-crawl: clean bill of health (measured
2026-09-19).** `node bin/crawl.mjs --repo <the repo itself> --budget
50` ran the real pipeline on its own 34-file codebase: 76 seeds, 21
judgments, termination frontier-empty (budget not reached), 13 pruned,
1 expanded, 7 candidates — all escalated (6 escalate-owner, 1
review-queue), 0 file-reports, 0 bugs. Driver-estimated cost
$0.00121; wall 26.1 s; avg judgment latency 866 ms. Every candidate
was triaged by reading the cited file:line and all 7 are false
positives: 4 eval fixtures (the intentional `eval` in labeled-eval's
bugs.js, fixture results/labels JSON, a fixture TODO), 1 prose hit in
docs, 1 self-referential hit (the `auth` pattern firing on the judge
config's own "auth weakness"/"auth bypass" instructions), and 1
secret-scan log message. An independent end-to-end read of the
pipeline code (bin/ + lib/, ~1300 lines) found no real bug either, so
nothing was changed — the clean bill of health is the result.
Recorded in docs/EVAL.md §17. Honest limit: 21 judgments on a small
target cannot prove the absence of bugs; 0 file-reports matches the
judge's measured conservative behavior on real code (M20 natural
routing).

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

**U3. The 6,000-char state cap suffices (partially measured).**
M17: routing agreed 6/6 across 2k/6k/12k caps on 2 nodes (1 bug, 1
benign), risk stable, no truncation triggered at any cap. The cap
does not bind on small states. Untested: large multi-file states
where truncation actually fires. Validate further: ablation on
nodes whose states exceed 6k chars.

**U4. The verdict choice behaves on code nodes (partially measured).**
M16: on the 12 labeled nodes the choice never crossed classes: bugs
4 report / 2 escalate / 0 prune / 0 expand; benign 6 prune / 0
elsewhere. report precision 4/4, prune precision 6/6 on this set.
The choice is a supporting signal (risk bands drive routing), and
n=12 is thin. Validate further: per-class precision/recall on a
larger labeled set.

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

**U7. Verifier grounding approximates bug validity (validated
within scope, 2026-09-19).** M18 measured the failure: the old
grounding regexes expected judge-like vocabulary that seeder
evidence never contains, so the verifier demoted 0/6 true bugs.
The fix (M20): the driver attaches the node's own cited code
locations into the judgment record before verification
(`lib/evidence.mjs`); the verifier unions them with node evidence
for on-disk grounding. Re-run on the same 12 labeled cases:
verifier accepted **6/6 bugs, 0/6 benign** (precision 1.00,
recall 1.00); control (evidence stripped) accepted 0/12; with
natural routing 2/6 bugs are accepted as bugs and 4/6 escalate to
a human (nothing lost). Honest scope: n=12, synthetic fixture;
the verifier checks falsifiability-grounding, not independent bug
derivation; v0 does not execute reproducers. Validate further:
re-run on a larger labeled set with real-world bugs, and add a
fabricated-citation case to the control.

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

**U10. End-to-end crawl cost (measured 2026-09-19, see M19).** The
derived bands are now anchored: 493 judged nodes on a real repo cost
$0.02965 total at $0.00006/node mean, 1,432 mean input tokens, 10.2 min
wall at parallel-6. Still unmeasured: expansion-heavy crawls (cost
scales with judgments at the measured per-node rate) and the heavy
multi-file context upper band ($0.17-$0.34, still derived).

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

**M23. FP verdicts feed back into the machine (measured
2026-09-19).** `data/fp-verdicts.json` holds human false-positive
verdicts; the seeder suppresses exact (file, pattern, matched-text)
repeats (logged to stderr) and the judge gets the 10 most recent as
negative examples. Dogfood re-run: 7 -> 0 FP candidates; the fixed
SESSION_SECRET finding still seeds. Limit: repeats are killed, novel
FPs are not — new noise classes still surface as candidates, which is
the loop's input.

**M24. Metaye hunt: pipeline found 0, human found 1 (measured
2026-09-19).** 40 seeds -> 8 judgments -> 0 candidates ($0.00063);
the PWA manifest icon 404s were found by human triage, fixed, and pushed
(metaye `2bd5174f`). New noise class recorded: bare `exec(` in the shell
pattern matches `RegExp.prototype.exec` — 5 FP verdicts added, seeder
suppresses them (40 -> 35 seeds). /chat-stream has no rate limiting
(unauthenticated by design); reported as a hardening gap, not fixed —
needs owner product decisions.
