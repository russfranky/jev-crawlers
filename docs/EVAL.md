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
  diminishing-returns gate) are reasoned, with one small labeled run
  behind the band-1 boundary (§8, n=12). Treat them as starting
  points until a larger labeled set confirms them.
- Jev probabilities are ranking signals, not calibrated bug confidence.
- Verification v0 checks artifact grounding, not execution. Running
  reproducers is roadmap.
- Zero data retention is requested from the gateway, not guaranteed,
  and per-request ZDR needs a Pro or Enterprise plan. Verify
  `planningReasoning` on your plan before sending private code.
- The full assumption register is `docs/ASSUMPTIONS.md`.

## 8. Labeled eval: first measurement of the judge on code (2026-09-19)

`examples/labeled-eval/` holds 12 labeled nodes, ground truth by
construction: 6 seeded bugs (off-by-one, nil deref, eval injection,
hardcoded secret, parseInt radix, float money) and 6 benign nodes
(pure functions, guarded accessors, a fixed loop, a constant). Labels
never enter the node state; `run-labeled-eval.mjs` judges, then scores
against the withheld labels. Raw rows in
`examples/labeled-eval/results-2026-09-19.json`.

| Class | risk high (>=2) | risk mid (1-2) | risk low (<1) |
|---|---|---|---|
| bug (6) | 4 | 2 | 0 |
| benign (6) | 0 | 0 | 6 |

- Mean risk: bugs 2.26, benign 0.13. The risk=1 band boundary
  separates all 12.
- `bug_likely` pairwise concordance: 1.00. Every bug outranked every
  benign (bugs P0.76-0.93, benign P0.08-0.11). As a ranker it works
  on this set; as a calibrated probability it remains unproven.
- Routing: all 6 bugs reached a human (4 escalate-owner, 2
  file-report); all 6 benign auto-pruned (explicit prune choice +
  low band + support-for-false, the full conjunction).
- Mean latency 1.4 s per judgment. Cost per node unrecorded by the
  runner; about $0.00008 by the M2 band.

Honest scope: n=12, one author, one fixture, bugs chosen to be
visible. This is a start, not proof. It partially covers U1 (risk
transfer), U2 (the band-1 boundary), and U5 (ranking). The README
limits and the register say so.

## 9. ZDR live check, confidence surfacing, real cost (2026-09-19)

One live call with `zeroDataRetention: true` (the shipped default):
200, planningReasoning "System credentials planned for: typesafe-ai.
ZDR requested: all 1 attempts support ZDR." U8 is partially measured
(one key, one plan); the README now says "verified on our plan,
verify on yours" and names the `--show-metadata` command that shows
the routing.

The same call exposed two live fields the judge was dropping:

- `providerMetadata.typesafe.confidence`: per-question Jev
  confidence (risk 0.98, verdict 0.94 on the probe), exactly where R2
  said it lives. The judge now attaches it to answers as
  `confidence`; reports print it labeled "vendor-reported,
  uncalibrated", never as calibration.
- `providerMetadata.gateway.marketCost`: $0.000035 for the call,
  inside the measured $0.000042 band. The judge returns it as
  `marketCostUsd`; the driver prefers it over the $0.00008 estimate.

`crawl-judge --show-metadata` now exists so operators can read both
on their own plan; metadata is stripped from default output. Cost of
this iteration's probes: 2 live calls, about $0.00007.

## 10. Parallel judging and expansion hit rate (2026-09-19)

Two more unvalidated assumptions converted to small measurements:

- **U9, parallel judging.** 6 parallel `crawl-judge` calls: 4.9 s
  wall (about 8.6 s serial), 6/6 succeeded, zero 429s. Per-call
  latency degraded to 4.1-4.8 s from about 1.4 s serial, so
  parallelism trades per-call latency for wall clock. The driver
  stays serial; parallel judging is viable when a latency budget
  demands it. Recorded as M14.
- **U6, expansion hit rate.** From the seeded off-by-one in
  `cart.js::total`, mechanical expansion reached the true context
  (`checkout.js`, the caller) at depth 1 via symbol refs; the
  frontier emptied by depth 3. Depth-1 noise exists (README.md
  matched the symbol by text search). One case, one repo. Recorded
  as M15; a real hit-rate number needs many seeded bugs.

Probe cost: 7 live calls, about $0.00025.

## 11. Verdict-choice behavior and README cost audit (2026-09-19)

- **U4, from existing data (zero new calls).** The 12 labeled
  judgments give per-class verdict behavior: bugs 4 report / 2
  escalate / 0 prune / 0 expand; benign 6 prune. The choice never
  crossed classes (report precision 4/4, prune precision 6/6 on
  this set). Recorded as M16; U4 partially measured. Thin (n=12)
  but free.
- **README audit (2 calls).** `readme-audit` rerun on the updated
  README: honesty_caveats P0.39, down from P97. The README gained
  caveats since that P97, so the swing marks the uncalibrated
  boolean as noise, not a real regression; recorded as advisory.
  The unsupported_claim choice pointed at "cost" (P0.93,
  fix_priority 1.86, confidence 0.26), and a diagnostic named the
  $0.00008 per-node figure: the bullet cited three overlapping
  per-call numbers ($0.000035 observed, $0.000042 band, $0.00008
  estimate), which reads as confusion even though each is
  attributed. Fixed by rewriting the bullet around one observed
  number and one headroom figure. No claim was weakened; the
  numbers and attributions are unchanged.

Audit cost: 2 calls, about $0.00007.

## 12. U3 ablation, U7 attempts, final dogfood: diminishing returns (2026-09-19)

- **U3, state-cap ablation (6 calls).** 2 nodes (1 bug, 1 benign)
  judged at 2k/6k/12k caps: routing agreed 6/6, risk stable
  (1.66-1.70 bug, 0.05-0.09 benign), no truncation fired. The cap
  does not bind on small states; large states remain untested.
  Recorded as M17; U3 partially measured.
- **U7, two attempts, both inconclusive.** Synthetic probe: 2
  file-report judgments on true bugs were demoted to unverified
  leads, but the probe nodes had empty evidence, so the demotion
  was correct behavior on bad input, not a measurement. Real
  pipeline on the labeled fixture: all 3 pattern seeds escalated,
  so the verifier never saw a true bug. U7 stays unvalidated; the
  register records what a valid test needs.
- **Final dogfood** (`--seed todo --seed patterns --budget 14` on
  this repo): 15 nodes, 14 judgments, 0 bugs, 0 unverified leads,
  5 escalated, ~$0.00076. Human review of all 5: 1 true fixture
  bug correctly escalated (applyDiscount, risk 2.97); 4 seeder
  keyword noise on docs/config (the known dismissed class). Zero
  new actionable findings.

Probe cost for this round: about $0.0004 (15 calls).

**Loop exit: diminishing returns.** Iteration 6 produced zero
actionable findings; iteration 5 produced only a thin single-case
ablation and two inconclusive attempts. The register now holds 17
measured entries (M1-M17); U1-U6, U8, U9 are partially measured;
U7 and U10 remain fully unvalidated with named experiments.

## 13. U7 verifier experiment: the verifier demotes every true bug (2026-09-19)

Ran the named experiment for real (`examples/verifier-eval/`,
12 calls, about $0.0004). 6 human-confirmed bugs + 6 benign nodes
from the labeled fixture, evidence strings byte-identical to real
`crawl-seed` output, judge run for real with labels withheld
(bugs: 4 escalate / 2 file-report; benign: 6 auto-prune). To isolate
the verifier, routing was forced to file-report on all 12 while
keeping the judge's real answers; the verifier itself is
deterministic, so all variants were free.

Result: the verifier accepted **0/6 bugs and 0/6 benign** —
recall 0.00, precision undefined (no accepts). All 6 bugs demoted
to unverified leads on grounding gaps. Only 1 of 12 nodes carried
any real seeder evidence at all (applyDiscount, the eval
injection); even it was demoted ("no input or trigger"). The
grounding regexes demand judge-like vocabulary that raw seeder
lines never contain; `groundedGaps` ignores `node.seed`; the
verifier never consults the judge's 'report' verdict. Control:
the same bug with vocabulary-carrying evidence is accepted as
'bug', so the gate is satisfiable — the pipeline just never
feeds it.

Recorded as M18; U7's positive claim is NOT validated. As shipped,
the verifier is safe (nothing false gets called a bug) but its
"verified bug" status is unreachable on real pipeline output.
Re-test after the pipeline emits evidence in the grounding
vocabulary, or the verifier reads the judge's stated artifact.

Superseded: §15 re-tests after the driver attach fix; U7 is now
validated within scope (M20).

## 14. U10 cost experiment: 493 nodes judged on a real repo (2026-09-19)

Ran the named experiment for real (`examples/cost-eval/`,
493 successful judgments, $0.02965 total — inside the $0.10 cap).
Real `crawl-seed --patterns --todo` on the owner's mobhunter repo
(1,781 seeds in 6.7 s); top 500 by priority; excerpts attached
exactly as the driver does (30-line window); real `crawl-judge`
in parallel batches of 6 (the M14 setup).

Measured: **705,863 input tokens** (mean 1,432/node), 49,081
output tokens, **$0.02965 spend** (gateway `marketCost` present on
all 493 calls; mean **$0.00006/node**), **10.2 min wall clock**,
mean latency 2.5 s/call under parallel-6, 4 nodes truncated.
Routing mix on real code: 254 expand, 113 auto-prune, 89
escalate-owner, 29 review-queue, 7 file-report, 1 needs-artifact.
7/500 nodes failed: 2 transient `GatewayInternalServerError`
(after 3 retries — a new failure mode beside M8's 429s) and 5 on
pathological 300KB+ single-line JSON research files whose judge
output was unparseable.

Safety: every excerpt was secret-scanned before sending —
0/500 dropped, no secret-shaped values found. Verified by code
inspection the same day: the tooling has NO secret redaction;
only `.env` files are excluded from reading. Excerpts go to the
gateway as-is, so private-code crawls need the pre-send scan
(this experiment's script does it) and ZDR verification per
M12/R4.

Recorded as M19; M10's derived $0.04-$0.05 band for 500 nodes is
superseded (measured $0.03). Scope: seed nodes only — a real
crawl's expansion adds judgments at the same per-node rate.

## 15. U7 re-test after the driver attach fix (2026-09-19)

The §13 failure was a vocabulary mismatch: the verifier's
grounding check demanded judge-like vocabulary that raw seeder
lines never contain, so all 6 true bugs demoted. The fix closes
the gap in the driver, not the verifier: `bin/crawl.mjs` now
attaches the node's own cited code locations into the judgment
record before `crawl-verify` runs (shared helper
`lib/evidence.mjs`, used by the driver and mirrored by the eval
runner); `crawl-verify` unions them with node evidence for
on-disk grounding. Fabricated citations still fail-closed.

Re-ran `examples/verifier-eval/` (12 calls, about $0.0007) with
the full production chain. Judge run for real, labels withheld:
bugs 4 escalate-owner / 2 file-report, benign 6 auto-prune.

- Primary (routing forced to file-report, judge's real answers
  kept): **6/6 bugs accepted, 0/6 benign** — precision 1.00,
  recall 1.00. Benign demotions rest on the judge's own answers
  (verdict=prune, risk below floor), not on grounding gaps.
- Natural routing (production): 2/6 bugs accepted as bugs, 4/6
  escalated to a human, 0/6 benign accepted. Recall 0.333 on
  "bug" status, nothing lost — escalation is the primary sink.
- Control (evidence stripped): 0/12 accepted. The mechanism still
  requires real evidence.

Recorded as M20 (supersedes M18); U7's positive claim is
VALIDATED within scope: n=12 on a synthetic fixture, and the
verifier checks falsifiability-grounding (claim cites real
on-disk code, judge stated a bug claim, risk at or above floor),
not independent bug derivation. Next: re-run on a larger labeled
set with real-world bugs, and add a fabricated-citation case to
the control.

## 16. Seeder pattern-noise fix: before/after on mobhunter (2026-09-19)

The probation bug hunt (128 judgments on the owner's mobhunter
repo: 28 candidates, 27 false positives, 1 confirmed real bug —
the SESSION_SECRET fallback) traced its two biggest noise classes
to the seeder's `patterns` table in `bin/crawl-seed.mjs`, not the
judge. `shell` matched Luau's `task.spawn` (166 hits; a coroutine
scheduler, not shell execution) and bare `spawn (` / `system (`
matched English prose ('respawn (pool', 'the weather system
(rain'). `auth` fired on the bare word 'token' (item display
names like "Revival Token", parser tokens, XML `<token>`
serialization, timer tokens).

Fix, in the existing pattern table (no new mechanism):
- `shell` now only fires on real OS-invocation forms:
  `exec(`/`execSync(`/`os.execute(`/`io.popen`/`
  `child_process.spawn`/`cp.spawn`. Bare `spawn (` and
  `system (` no longer match anything.
- `token` moved out of `auth` into a new `auth-token` entry that
  requires an auth qualifier (session/access/refresh/bearer/
  csrf/id/api/auth/secret/sign), a secret-ish suffix, a context
  word on the same line, or a secret-shaped value (known secret
  prefix) nearby. A bare word match never fires.

Measured with `node bin/crawl-seed.mjs --repo <subtree>
--patterns` before and after, on the same mobhunter subtrees the
hunt used (zero Jev calls):

- game subtree: 1362 -> 937 seeds (-425, -31%).
  `pattern:shell` 233 -> 0 (every one of the 233 was noise:
  task.spawn or prose). `pattern:auth` 401 -> 180, plus 29 new
  `pattern:auth-token` — all 29 genuinely auth-adjacent
  (ProfileStore session tokens, AntiCheatService, API/SEC
  reference files), zero display-name junk. Other patterns
  unchanged.
- web subtree: 48 -> 46 seeds. `pattern:auth` 40 -> 38.

The patterns keep their intent: sanity checks confirm
`exec('ls')`, `execSync("id")`, `os.execute(cmd)`,
`io.popen("ls")`, and `child_process.spawn("ls")` still fire,
while `task.spawn(fn)`, `respawn (pool)`, and prose no longer do.
The original SESSION_SECRET finding still fires (via `auth` on
the public `dev-secret-change-me` fallback constant) — confirmed
by re-seeding the website subtree after the fix.

Recorded as M21. Honest limit: zero shell hits on mobhunter is
correct for this codebase (Roblox Luau has no shell access), not
proof the pattern catches real shell injection in the wild; that
needs a labeled positive case.

## 17. Dogfood run: the crawler on its own codebase (2026-09-19)

The system was turned on itself to answer the owner's question of
whether it can improve itself. Command:

```
node bin/crawl.mjs --repo ~/workspace/jev-crawlers --budget 50 \
  --json report.json --stats-json
```

Measured (real Jev calls, real pipeline):

- seeds: 76; judgments: 21 (budget 50 not reached);
  termination: frontier-empty
- pruned: 13, expanded: 1, depth-capped: 0
- candidates: 7 — all escalated (6 escalate-owner, 1 review-queue);
  0 file-reports, 0 verified bugs, 0 unverified leads
- driver-estimated cost: $0.00121; wall time: 26.1 s;
  avg judgment latency: 866 ms

Triaged every candidate by reading the cited file:line. All 7 are
false positives, not real bugs in the crawler's code:

1. `examples/labeled-eval/bugs.js:21` (`return eval(userExpr)`) —
   intentional seeded bug in the labeled-eval fixture, not product code.
2. `questions/crawl-judge.json:1` — the `auth` pattern fired on the
   judge config's own instructions prose ("auth weakness",
   "auth bypass"); self-referential noise.
3. `docs/ASSUMPTIONS.md:37` — `money` pattern fired on the English
   word "Transfer" in prose; documentation, not code.
4. `examples/cost-eval/run-cost-eval.mjs:84` — a secret-scan log
   message ("secret-shaped values"), not a secret.
5. `examples/labeled-eval/results-2026-09-19.json:75` —
   `"bugType": "hardcoded-secret"` in a fixture results file.
6. `examples/labeled-eval/run-labeled-eval.mjs:20` — the fixture's
   label map mentioning `STRIPE_KEY`.
7. `examples/todo-app/checkout.js:8` — a TODO comment in a fixture
   ("round to cents before charging").

Independent check: the full pipeline code (bin/ + lib/, ~1300 lines)
was read end to end during this run. No real bug found there either.
Nothing was fixed because there was nothing to fix — a clean bill of
health is the result. Recorded as M22. Honest limit: a 34-file,
21-judgment crawl is a small target; absence of findings here does
not prove the absence of bugs, and the judge's 0 file-reports on this
run match its measured conservative behavior on real code (M20's
natural-routing variant).

## 18. False-positive feedback loop: dogfood before/after (2026-09-19)

The owner's ruling: recurring false positives are themselves the
problem — triage verdicts died in prose docs and never fed back into
the machine. Built the loop the repo promised ("recursive"):

- `data/fp-verdicts.json`: machine-readable verdict store —
  `{file, line, pattern, evidence, verdict, reason, date}`. Seeded
  with the 7 dogfood FPs from §17 (exact matched evidence text) and
  4 mobhunter probation-run FP classes (evidence: null; per-candidate
  evidence was not retained, so these feed the judge only).
- `bin/crawl-seed.mjs`: suppresses a seed only when its (file,
  pattern, matched evidence text) exactly repeats a
  `verdict: "false-positive"` entry — never bare file:line, since
  lines shift. Suppressions log to stderr. Patterns are untouched.
- `lib/jev.mjs` (`packState`): appends the 10 most recent FP verdicts
  to the judge state as "previously ruled not-a-bug" negative
  examples (capped at 2000 chars).

Measured, same command as §17
(`node bin/crawl.mjs --repo ~/workspace/jev-crawlers --budget 50`,
real Jev calls):

- before: 21 judgments, 7 candidates (all escalated), $0.00121
- after, first pass: 13 judgments, 2 candidates — both novel, not
  repeats. One was the loop eating its own tail (patterns firing on
  evidence text quoted inside `data/fp-verdicts.json` itself);
  fixed by excluding the store from pattern seeding. The other was
  a second fixture-comment line in `bugs.js`; added as a verdict.
- after, final: **8 judgments, 0 candidates**, $0.00064, wall 9.0 s.

So 7 -> 0 FP candidates on the repeat run; the loop demonstrably
kills repeats and the two novel FPs it surfaced were absorbed in the
same session. Total Jev spend for this work: $0.00168.

Mobhunter spot check: the fixed `auth.server.ts` still seeds
(`pattern:auth` on the fallback-constant line — the real-finding
signal is intact), game subtree still 937 seeds with
`pattern:shell` at 0, and all other patterns still fire.

Recorded as M23. Honest limit: this kills *repeat* FPs, not novel
ones. The judge's negative examples bias it against known classes,
but a new noise class will still surface as a candidate — which is
the loop's input, not its failure.

## 19. Metaye hunt: real bug found and fixed (2026-09-19)

Full mission on `russfranky/metaye` (Vite/React/TS/Convex/Privy/Three.js
talking-head app), owner-authorized. Local mirror was stale (136 files vs
281 on remote main); synced to remote head `16980bb2` before crawling —
the first crawl ran against the stale tree with no gateway key and judged
nothing, both fixed before the real run.

Real run (`node bin/crawl.mjs --repo ~/workspace/metaye --budget 100`,
real Jev calls):

- 40 seeds -> 8 judgments -> 8 pruned -> **0 candidates**,
  termination: diminishing-returns, $0.00063, wall 9.1 s.
- Seed mix was almost entirely noise: `bun.lock` / `tsconfig.tsbuildinfo`
  / minified build chunks firing on package names, README prose, and two
  `RegExp.prototype.exec` hits (`re.exec(`, `SENTENCE_RE.exec(`) on the
  `pattern:shell` bare `exec(` — a new noise class from the M21 pattern
  (recorded as FP verdicts; seeder now suppresses all 5: 40 -> 35 seeds).
- Auth code triaged by hand (convex/chat.ts, convex/auth.config.ts,
  convex/http.ts, usePrivy.ts): correctly implemented Privy JWKS
  verification, issuer-pinned, per-app JWKS URL. No bug. Notable hardening
  gap, reported not fixed: POST /chat-stream is unauthenticated by design
  (anon fallback) with no rate limiting — each call burns OpenAI tokens.
  Fix needs owner product decisions (limits, identity, UX); no rate-limit
  utility exists in the repo and handrolling one was out of scope.

**Real bug found outside the pipeline** (no pattern covers it) and fixed:

- `assets/manifest--peWSb41.json` referenced `favicon.ico`,
  `logo192.png`, `logo512.png`, but the build emits hashed names
  (`favicon-E1VHpXCm.ico`, `logo192-cx3brImN.png`) and no logo512 —
  all three PWA icons 404'd. Fixed: manifest points at the real files,
  added the missing `assets/logo512.png`, updated the root
  `manifest.json` template for the next manual deploy. Pushed to metaye
  main as `2bd5174f` (1 added, 2 modified, 0 deletions; all blob SHAs
  verified). The Convex standalone-mode fix and hashed-asset index.html
  from the earlier session were confirmed already on main — not re-fixed.

Recorded as M24. Honest limit: the pipeline's 0 candidates came from
8 judgments on 40 mostly-noise seeds; the real bug was found by human
triage of the known-broken PWA surface, not by the crawler. The crawler
is a triage assistant, not an autonomous finder — this run is more
evidence for that.

## 20. Unix rebuild: pipe re-measurement (2026-09-20)

The monolith split into unix tools: `bin/crawl-seed.mjs` ->
`bin/jev-seed.mjs`, `crawl-judge` -> `jev-judge`, `crawl-verify` ->
`jev-verify`, `crawl-expand` -> `jev-expand`, `crawl-report` ->
`jev-report`, and the driver `bin/crawl.mjs` -> `bin/crawl` (thin
orchestrator over a real NDJSON pipe; stages are dumb filters, all
recursion/budget/termination logic lives in `crawl`). No pattern,
verdict-store, or verifier-semantics changes — only names and framing.
The three eval harnesses were rewired to the new names and NDJSON
parsing.

**Verifier eval re-run** (`examples/verifier-eval`, real Jev calls on
the 12-node fixture, `jev-seed | jev-judge | jev-verify`):

- V-attached x R-forced (primary): accepted bugs **6/6**, accepted
  benign **0/6**, precision 1, recall 1. Reproduces M20 exactly.
- V-attached x R-natural (production routing): accepted bugs **3/6**,
  escalated 3/6, accepted benign 0/6, precision 1, recall 0.5. M20
  measured 2/6 + 4/6 escalated — the one-node difference is judge
  routing variance between runs, not verifier drift (the verifier
  accepted every file-report it was given in both runs).
- V-stripped x R-forced (control): accepted **0/12**, all demoted.
  Reproduces M20 exactly — the verifier still fails closed without
  evidence.

**Labeled eval re-run** (`examples/labeled-eval`, real Jev calls, 12
nodes): bugs 3 high / 3 mid risk bands, benign 6/6 low; mean risk bug
2.18 vs benign 0.09; bug_likely concordance 1.0; routing bugs 3
file-report + 3 escalate-owner, benign 6/6 auto-prune; $0.00085 total,
348 ms mean latency. The FP negative examples (which include fixture
entries) did not break the fixture judgments.

Recorded as M25. Honest limit: the rebuild is proven not to have
changed verifier semantics on the fixture (n=12); the natural-routing
variant's run-to-run wobble of one node is judge variance, and it is
why the verifier's numbers are reported on the forced path.
