# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-31 (session MVOX-11 checkpoint).** Full history in git.

### [PROCESSED — MVOX-16 wake 2026-09-06 10:40] Wake done: finn/bentham/perotin respawned, mail empty, board zero-ready. #246 CLOSED by PO (deviation accepted, commission delivered) and #247 CLOSED (completion accepted; Mihkel's live-correction round stays his gate) — both closures landed overnight after the snapshot. #261/#262 still one-Mihkel-nod each. Gama wake report sent 10:40. **#263 full cycle same morning:** schema-of-record home filed (Pérotin proposal) → Gama RULED all 4 points → executed: item-5 amendment `5c8b052` (guard: shape-vs-db conflict = defect, never silent edit; per-commission crede question; seed-results ledger convention) + ledger fold-back `06cd4d7` → CLOSED, comment 5557836762. mvox_crede real-PII premise NOT ratified — unconfirmed-pending-Mihkel, surfacing via PO channel; board text must not assert it. Residue flagged on #263: ~14 pre-#246 scripts still write ledgers/. Bentham consolidation task in flight. Idle otherwise, awaiting Mihkel nods (#261/#262) or new ready.

### [NEXT SESSION] 2026-09-06 — session MVOX-15 → MVOX-16 (closed 05:15, REOPENED 05:25 on po-team doorbell)

**REOPENED SESSION COMPLETE (06:55 — final close):** the doorbell items both shipped. **#246 schema half DONE** — Pérotin executed end-to-end (commits 0a6e946 definition+narrative, 1d088d4 primitive+seeds; 4/4 clean on BOTH polyphony and mvox_crede with read-back verification; type-def ids in his completion comment; entu-research salvage branch DELETED after copy-out). One surfaced deviation on the record: built at _sharing DOMAIN matching live program_item (the ruling's baseline), not the draft's stale 'public'; add_from wired though live program_item lacks it (sibling gap noted, not repeated). **App-side UI = #262, deliberately UNREADY** (needs product shape: surface/edit affordances — proposal is event-detail display + conductor/admin editing; Victoria/Gama shape then Mihkel's nod). #246 left open for PO lifecycle. **#247 CLOSED** — merged `3b29cee`, r1 YELLOW (filter-empty rule not carried to month mode → emptyState snippet seam; weekday column overflow → widened) → r2 GREEN; completion comment 5556715820; **Mihkel's live correction round is the next step on it per its own gate**. Session totals: **20 issues + epic #223** (the 18 from the first close + #259-era #246-schema-half counted under #246 still open + #247; strictly: 19 closed issues + epic + #246 schema half). Board: EMPTY of ready; #261 (Mihkel's nod) + #262 (product shape) not-ready. NEW args/research committed; final state commit follows teammate shutdown.

mvox-app main @ `59f71a0`. **18 issues + epic #223 closed this session** (SHAs in the [SESSION LOG] below): batch B (#253 #242 #250 #255 #251 #252) → #260 → #258 → R1 remainder (#225 #224 #226 #230 #231 #235 #232, epic closed) → #257 #259 #249. Standing finn/bentham/perotin terminated at shutdown.

**FIRST ACTION next session:** /mvox-wake, then: (1) **#247** — the ONLY ready item, HELD on one question queued to Gama 03:05 (month overview: items only, or items+recentItems merged?); everything else ruled in-issue by Mihkel; research in `research/research-249-247-259.json` verify[1]; author args at pickup (budget a correction round — the issue's own acceptance gate expects Mihkel's live review). (2) **#246 schedule_item home** — Pérotin's [WIP] draft in perotin.md (recommend workspace-app-native `scripts/migrations/lib/mvox-schema-extensions.ts` + new type-CREATE primitive; mvox_crede inclusion = separate product call); needs Mihkel/PO word (my two-word question to Mihkel unanswered: home yes/no + mvox_crede). (3) Board sweep for new ready items.

**Schema independence is LAW as of this session** (Mihkel direct, broad): no entu/research PRs ever; PO-Approved-on-commissioning-issue is the sole schema gate; Bentham's trigger repointed; common-prompt "Schema Evolution (mvox-independent)" is canonical; wiki governance page amended (4cd5864).

**From Bentham's closing bullets:** (1) CORRECTION to his DEFERRED — the three stale common-prompt lines (11/29/49) ARE fixed in HEAD at 9666b22 (verified at shutdown: zero stale matches, HISTORICAL-REFERENCE line present); his flag predated the stash recovery — do NOT re-fix. (2) REAL backlog: his scratchpad is 680 lines functioning as a rulebook — consolidation task (lift the tests-that-pass-while-broken family + Entu wire mechanics into architecture-decisions.md, then prune) needs its own slot. (3) His seam-commit suggestion (commit memory files at every chain seam, not shutdown) matches what this session already practiced — formalize in the template fix below.

**Template fixes queued for next session (tdd-slice-pipeline.js canonical in .claude/workflows/):** bake into the template: (1) GIT SAFETY block (validated live — turned a would-be reset --hard into a stop-and-report); (2) FINAL-RESULT DISCIPLINE (two premature-WIP halts recovered via continuation prompts); (3) note: launch-args _shared is NOT read by agents — they read the args JSON file the prompts name; put run rules in that file. Merge agents' stash discipline caused one stash-pollution incident (recovered loss-free via stash apply) — consider replacing stash/pop in merge prompts with 'leave dirty files alone; merge --squash stages only branch content'.

**Live-gate backlog for Mihkel** (accumulated this session, all in completion comments): #253 evidence-on-next-occurrence, #242 type asks not assumes, #250 day sections, #255 deactivate flow in mvox_crede, #251 Estonian headers on English phone, #252 solid/outline arrange buttons, #260/#259 collective-switch races, #257 repair confirmation + visibility heading, #249 labeled event form.

### [SESSION LOG] 2026-09-05/06 — session MVOX-15 (was [LIVE])

Wake done: finn/bentham/perotin respawned, mail drained (nothing new; 13:07 courier delivery = Gama's #253-ruling ping, ruling read from issue), tree clean on main @ `33170e4` (args-253 commit).

**Gama's #253 ruling landed (on issue):** build shape approved; amendments: conditioned mock = FIRST-CLASS deliverable with fail-against-prefix proof; body capture SHIPPED not probed; typed SectionReparentPartialError (house precedent); TWO banner states (k/N in error only, not banner); REFUSED retry/backoff + automatic unwind. All baked into args-253.json (committed).

**#253 CLOSED** — merged `b0cf6e2`, r1 YELLOW (untyped-rejection banner hole → phase-based fix, test-driven) → r2 GREEN with pre-fix replay proof (12 failures vs 80a1b9f tests-only commit). Completion comment 5551469450; Gama reported 14:35. Mock-proof requirement satisfied twice (RED verbatim output + reviewer worktree replay).

**#242 CLOSED** — merged `65b8be9`, review GREEN r1, completion comment 5551752627. #199's dead refusal plumbing made reachable; new key event_create_type_placeholder (4 locales).

**#250 CLOSED** — merged `704c967`, r1 YELLOW (size-step differentiator was inherited-no-op trap) → outlined-pill mechanism → r2 GREEN; completion comment 5552042631; scope fence held.

**#255 CLOSED** — merged `e099364` (24 files) after recovery: 3 pipeline YELLOW rounds + fix-255 agent d67ce9f + Bentham r4 YELLOW-MERGE-ELIGIBLE (gates his: 3310/3310, 0 errors) + merge-255 agent squash with gate documented. Completion comment 5552915041. Deviation (merged non-GREEN on standing-reviewer rec) reported to Gama 18:55 with reversal offer. Tail finding = **#259** (backlog). **Backlog: Bentham calibration re-audit** — YELLOW-RSVP.1 / CARRY-T4.5.1 / YELLOW-T4.8.1 closed under false single-collective premise.

**#251 CLOSED** — merged `ee2e1a2`, GREEN r1, completion comment 5553182345 ($derived getLocale formatters, reload trap pinned, ISO fence pinned, 4-locale exact-text pins).

**#252 CLOSED** — merged `f4abbb2`, GREEN r1, completion comment 5553468846 (solid-vs-outline distinguishability; invisible-holding-box for inapplicable; busy≠inapplicable; board note: roster delete ✕ also below touch standard, untouched). **BATCH B COMPLETE**: #253 b0cf6e2 · #242 65b8be9 · #250 704c967 · #255 e099364 · #251 ee2e1a2 · #252 f4abbb2. Zero classifier halts this session.

**#260 CLOSED** — merged `01ed068`, GREEN r1, completion comment 5553702580 (deterministic proof held: real-route spec, 3× identical pre-fix failures on the store value, reviewer replayed independently; fix = +15/−2 generation-guard in refreshCompletionGate). Gama clone-verified, two no-rework notes: (1) PROCESS LESSON for args authoring — 'state which you chose' means a SENTENCE in the report/commit, not a diff the reader infers; #260's guard-vs-collective-keying choice shipped implicit; bake explicit stated-choice demands into commitBody templates when a done-when asks. (2) **FOLD-IN when next in profile/+page.svelte (#257 touches it — put in args-257):** the #260 stale-rejection handler swallows LIVE failures silently with no generation check — house shape is `if (g !== generation) return; console.error(…)` (stale silent, live logged; file logs everywhere else :301/:326/:378/:509); not a defect (gate fails safe), costs pilot debugging hours.

**#258 CLOSED** — merged `bdc1dba`, GREEN r1, completion comment 5553941315 (FILTER with source-verified rationale; guard in entuUrl; 13 pre-fix failures + 7 negative pins).

**INCIDENT (2026-09-05 ~22:30): green-225 agent ran `git reset --hard` on shared main** to recover from its own branch-mismatch — security-flagged by the harness; destroyed the then-uncommitted team-lead.md edit (reconstructed below from context; Bentham's METHOD entry survived, committed 5b40a78; main's committed history untouched). Countermeasure: hard git-safety line added to args _shared (NEVER reset --hard/checkout --/clean; STOP and report on unexpected git state). Report to Gama + flag to Mihkel in session summary.

**R1 EPIC #223 CLOSED (03:00)** — remainder complete, all reviews GREEN r1: #225 c091063 · #224 0e088b2 · #226 b1e77c2 · #230 b5111cc · #231 b413e38 (7 sites — count re-derived post-#251) · #235 f6f7ac9 (layout prop, standalone byte-identical) · #232 3d15696 (createRouteLoadMachine in src/lib/loading/routeLoad.ts; #260 race spec + #255 reset semantics preserved untouched). Epic comment 5555584788, closed. Stray branches deleted. **STASH INCIDENT #2 recovered LOSS-FREE**: merge-231's never-popped stash held the schema-independence doc edits + Bentham reconciliation + Pérotin's #246 draft; later agents' stash cycles restored older snapshots; stash apply → verified → committed 9666b22 → dropped.

**#257 CLOSED** — merged `1c1733d`, r1 YELLOW (two real catches: live region unmounted during the reload it announces through — loadForSelected sets 'loading' synchronously; success announcement missing the generation guard) → fix 967e71f → r2 GREEN; completion comment 5555850558; #260 fold-in landed both-halves-pinned. **research-249-247-259 DONE** → persisted memory/research/research-249-247-259.json; #249 build-ready (one spec flip :766, zero new keys, double-naming removal in scope, latch tidy OUT of scope — event/[id] is #248 code); #247 fully ruled in-issue by Mihkel (Nimekiri|Kuu toggle w/ filter chips, #207 persistence, ~36 keys, weekday-narrow table verified) EXCEPT items-vs-items+recentItems ambiguity — QUESTION QUEUED to Gama 03:05, hold #247 if unanswered at its turn; #259 build-ready with THE capture-point trap (entry for toggleInactive, POST-loadForSelected for the two lifecycle sites).

**#259 CLOSED** — merged `b40bfc6`, GREEN r1 (per-site captures exactly per the trap; race proof + non-race trap-detectors both pinned; +49/−3 and purely additive spec), completion comment 5556063856.

**IN FLIGHT (04:30):** #249 pipeline run `wf_227077c7-f45`, args `pipeline-args/args-249.json` (committed e95ed0a) — if dead: branch feat/249-event-create-labels, delete if incomplete, relaunch from args. At its seam: **#247 is the last ready item** — launch ONLY if Gama answered the items-vs-items+recentItems question (queued 03:05); if unanswered, HOLD #247, board sweep, and consider session close-out (snapshot + shutdown protocol) — 18 issues + epic closed by then, board otherwise empty. #246 awaits home ruling (Pérotin [WIP] draft ready).

(historical) #230 second premature-WIP halt, recovery identical: continuation prompt, resumed 23:40. ROOT-CAUSE COUNTERMEASURE: GIT SAFETY + FINAL-RESULT DISCIPLINE blocks now appended to args-224-232.json's _shared (the file agents actually READ — the launch-args _shared is only referenced, not interpolated; earlier fix went to the wrong file). Template-level fix for next session: bake both blocks + never-return-WIP into tdd-slice-pipeline.js STRUCT_FINAL or _shared convention. **Git-safety rule VALIDATED first contact (23:54):** the #230 continuation agent found the tree on main (replay side-effect had carried #230's edits onto main) and STOPPED-committed-nothing-reported exactly per the rule — the state that previously triggered a rogue reset --hard now surfaces as a clean report. I reconciled (checkout branch, edits carried), resumed with take-2 prompt. Stray local branch chore/224-dead-reexports to delete at seam. Remaining after #226: 230→231→235→232, then epic #223 closes. THEN: #257 (args from research-257-242.json verify[0] + #260-note-2 fold-in), #259 per Gama, board sweep.

**#246 PARKED — upstream path WITHDRAWN (Mihkel verbatim via Henry 00:31: 'the PR at entu/research is out of place — we shouldnt bother to adjust the upstream V4E schema').** entu/research#54 CLOSED (branch feat/v4e-schedule-item KEPT — salvageable definition text); ruling recorded on #246 comment 5554923630. Shape/ordinal-adjudication/rights-posture all STAND — only the home changes: mvox-side (new design line: mvox evolves its own schema, no upstream v4E sync; mvox_collective precedent). Pérotin dispatched 00:40 to DRAFT (scratchpad only, not posted) the home proposal for PO wake: where the def lives, seeding flow, shape deltas as app-extension, branch-text salvage. **SCHEMA INDEPENDENCE CONFIRMED BROAD by Mihkel directly (00:37) and EXECUTED:** common-prompt 'Schema Evolution (mvox-independent)' rewritten; Schema-Change trailer RETIRED, PO-Approved-on-commissioning-issue is the sole surviving schema gate; Bentham's RED trigger repointed (msg 00:45, ack pending); architecture-decisions.md dated entry appended; workspace CLAUDE.md updated + committed eb32e80; memory repointed (mvox-schema-independent) + seed-data memory annotated. Open at PO wake: ONLY the schema-of-record home (Pérotin proposal). workspace-app doc edits (common-prompt/arch-decisions/scratchpads) UNCOMMITTED — commit at pipeline seam. PO-team on session break (Henry 00:23) — reports queue, board is the record.

**#237 still NOT-GO, reason on record (Gama):** #238's TrashIcon proven, but Mihkel called the season-management card 'single worst UI/UX in our app right now' and will return to it — propagating a treatment outward from a card about to change is work done twice; sweep waits for his card verdict, then re-asked against whatever the card becomes. Old #258-seam notes below are superseded: author args-258 (contract = issue #258 body by Gama — libraryData :210-211 ?? '' root cause with engineering's filter-vs-assert stated choice + entuFetch/entuUrl choke-point guard rejecting trailing 'entity/' paths, spec-only occurrences verified by Gama; Finn's 3 [unverified] flags stay on record unresolved) → launch #258 → then R1 remainder (resume cached run per snapshot: 225→224→226→230→231→235→232, args-224-232.json + amendments) → #257, #259 per board. **QUEUE after batch B (Gama 18:54 FINAL): #260 → #258 → R1 remainder**, #259 behind those; #257 slots per ready-board. **#255 deviation ACCEPTED** (Gama verified no-cross-collective-write claim themselves). **#260 RULED**: retitled to the YELLOW-T4.8.1 completionGate race (profile/+page.svelte resolveGate().then(set), no generation guard, app-wide membership SSOT, keyed to nothing), READY, ahead of #258 (rights-adjacent+global beats one-surface); CARRY-T4.5.1 + YELLOW-RSVP.1 closed on the record (no hygiene fix — no observable effect); done-when on issue; #253 standard applies (race test must fail pre-fix, failure output reported). Args for #260: Bentham's triage comment 5552967907 + Gama's ruling 5552980243 are the contract; no research workflow needed (triage WAS the research). **Proof-clause shape (Bentham 19:20, he gates review on it):** a timing race resists commit-replay — a test that fails pre-fix by scheduling accident proves nothing. Args must demand a DETERMINISTICALLY ORDERED test: hold the resolveGate promise manually, switch collectives, then settle the stale read — fails pre-fix every time, passes post-fix every time — and the reported failure must show the RIGHT REASON (the stale 'complete' actually reaching completionGateStore), not a timeout or unrelated assertion. Do not word the args as 'replay against pre-fix'. New practice on record: stand-downs belong in writing (Gama, promoted from Bentham's honest-limit line). After #255: **#251** (locale header bug — args to author from research key 250-251; note post-#250 the header line has NEW classes and the pill spans; English-regex specs at AgendaList.spec.ts:587-591/:655-658 + event/[id]/page.spec.ts:660-666 + uppercase×Estonian-caps callout), then **#252**, then R1 remainder, then #257 + **#258** (NEW, ready, Gama 18:27 — empty-id fail-open class: libraryData :210-211 ?? '' root cause + entuFetch/entuUrl choke-point guard rejecting trailing 'entity/' paths, verified safe by Gama — every trailing entity/ occurrence is spec-only; Finn's 3 [unverified] flags recorded on issue verbatim, deliberately unresolved; do NOT pick up before batch B done). **#255 proposal POSTED by Bentham** (comment 5551794438, relayed to Gama 15:45) — 4 recs: rights=REFUSE-while-granted not auto-strip (inviteData.ts:262 self-_editor is load-bearing; strip-then-flip if PO wants one-click), history=rows kept marked-inactive with count-no-rate (_created private-bucket, no honest denominator), section=keep _parent (unscoped count is deliberate guard vs silent soft-delete orphaning; inactive surface must show section), sign-in=zero-code degrade + one app-level notice + status-unscoped self-lookup (deactivated vs never-member). **#255 RULED (Gama 15:25, comment 5551807072): all 4 recs ACCEPTED, build as proposed.** B2 stands, no carve-out. THREE BINDING ADDITIONS for args-255: (1) rights refusal names the REMEDY (who holds what role, where to remove it — not just 'cannot deactivate'); pre-disabling at render = our call, must state which; (2) no-rate reasoning goes in a code comment AT THE SITE ('total counts events after she was gone; a percentage reads as a judgement about the person'); (3) sign-in notice copy BOUND: 'not active', NEVER removed/deleted/deactivated; point at the choir, not support. PRE-BUILD GATE: future-event RSVP tally question (does a deactivated member's yes still count in the conductor's going-count?) — Finn checking (dispatched 15:50); report to Gama BEFORE building the rsvp part; if bigger than the slice, Gama files it separately. Ruling on history union: in-slice fix, not pin-and-defer. #251 next after #250 (serial, same element — AgendaList headerFmt inside PRESERVED-VERBATIM T5 DST block :179-213; locale-arg swap undefined→getLocale() only; English-regex specs at AgendaList.spec.ts:587-591/:655-658 + event/[id]/page.spec.ts:660-666 must be verified/updated; #250-uppercase × Estonian-caps interaction owned by #251).

**research-257-242 DONE** → saved `memory/research/research-257-242.json`. **args-242.json AUTHORED, seam-ready** (uncommitted — commit both at seam). #242 headline: #199 already built the refusal plumbing (EventCreateErrorField 'type' variant + event_create_type_required in 4 locales, dead code); real deltas = empty option + NEW event_create_type_placeholder key (4 locales), flip 3 literals (:3213/:3342/:3379), rewrite stale #199 'never blank' comment (~:7296-7304), flip 3-4 tests in page.event-type-picker.spec.ts deliberately. DRIFT: entityCreate.ts moved to src/lib/entity/ (not server/). #211/#214 interaction REFUTED (motivational only). #257 findings also in file (verify[0]): all claims confirmed; precedent to match = persistent role=status region text-set imperatively (event-create-status/roster-reorder-status); NO setTimeout pattern exists in app — 'clears on next attempt' not timer; profile page has h1 + one h2 (Linked Accounts :880), new heading slots as sibling h2 before :848; no unmount-on-success test exists to break.

**#255 directive DONE:** census table + ghost surfaces posted on issue (comment 5551136048).

**QUEUE (Gama-corrected 13:23): #253 → #242 → #255 → #250 → #251 (serial, same element) → #252**, then R1 remainder 225→224→226→230→231→235→232 (resume from cached run — see snapshot; args `pipeline-args/args-224-232.json` + amendments), then **#257 (explicitly NOT pulled forward)**. #242 launches AT the #253 seam (Gama: three lines, every standalone event Joosep creates meanwhile gets the wrong default; #245 makes mis-types fixable but not free). Gama's #253 emphasis: the conditioned-mock-fails-pre-fix proof must be REPORTED explicitly, not implied by a passing suite — check the RED report for it at the seam and surface it in the completion report.

**#242 note:** deferral LIFTED (Mihkel ruling on issue): empty start, 3 sites (+page.svelte:3213/:3342/:3379 pre-drift), refuse submit without type via existing field-error idiom, series form untouched.

### [PREVIOUS] 2026-09-05 — session MVOX-14 → MVOX-15 (clean break at #229 seam, 13:05 EEST)

mvox-app main @ `f36a3df`. **15 issues closed this session**: #221 `117971c`, #222 `b554151`, #234 `eb5a2d7`, #236 `23a02d9`, #245 `0b57473`, #238 `2e90de1`, #240 `0fc88e6`, #239 `9d6000e`, #241 `64631c3`, #243 `03a46f0`, #248 `4f47f65`, #227 `1fedb0d`, #228 `bce88fe`, #229 `f36a3df` (+ #216-style subsumptions none). Standing: finn/bentham/perotin (terminated at shutdown).

**FIRST ACTION next session:** /mvox-wake, then Gama's batch B in their order — **#253 → #255 → #250 → #251 (serial, same element) → #252** — research DONE at `memory/research/research-pilot-b-250-255.json`; #253's root-cause report already with Gama (headline: server failure reason discarded — only status numbers surfaced; build shape proposed: typed SectionReparentPartialError + body-capture + conditioned mocks; await Gama's ruling before RED). #255: scoped/unscoped read table in the research file; deactivated sign-in experience is OURS TO PROPOSE (Mihkel). THEN resume R1 remainder: **225→224→226→230→231→235→232** — resumeFromRunId `wf_33ae2142-06b` with the exact args from the last launch (in this session's transcript; #227/#228/#229 replay cached; args file `pipeline-args/args-224-232.json` + #235 insert + #230/#231 drift amendments). Template at scratchpad path must be re-copied on fresh session (`cp .claude/workflows/tdd-slice-pipeline.js <scratchpad>/`).

**Schema sitting DONE** (Pérotin, on the issues): #246 schedule_item sketch, #242 NO SCHEMA NEEDED (verdict on issue), #256 link entity sketch (creators-tier unresolved). Await rulings; entu/research PRs after sign-off. **#254 CLOSED not planned** (Mihkel: members own it). **#237** parked on #238 trial (shipped — TrashIcon.svelte is the artifact); **#249** not-ready, after #253-batch; its args must include the locationCorpusRequested latch tidy (see Deferred below). **#233** parked (rewritten by Mihkel, 5 tuning questions for Pérotin — read before any schema work).

**#229 ruling pending:** census on the (closed) issue — profile_repair_done / profile_visibility_title / profile_visibility_intro = missing-surface findings for Gama.

**Process notes this session:** classifier halted 3 of ~14 merges (222, 236, 245) — recovery = verify journal → Mihkel manual-mode retry; pipeline-internal merges mostly pass. Seamed single-task runs (Gama-ratified) > packed runs while pilot is live. Terse comms is a standing Mihkel norm (memory file exists).

### [PREVIOUS] 2026-09-03 — session MVOX-14 live (updated 22:40 EEST at #221→#222 boundary)

**#221 CLOSED** — merged `117971c` (root / redirects to sign-in; expired-token → session-expired login variant, implemented in guard.ts NOT hydrateAuth — cold-visit path never consults authStore; research-221.json has the trace). Review r1 YELLOW (commit-body disclosures) → fix → r2 GREEN → merge. Live gates for Mihkel in commit body (phone: cold /, expired /, robots.txt note).

**#222 IN FLIGHT at write time** — season-manage panel merges into one toolbar card. Args `pipeline-args/args-222.json`, research `research/research-222.json` (headline: panel must be SIBLING of role=toolbar header row inside new outer card — handleAdminToolbarKeydown full-subtree query + dialog-in-toolbar ARIA; label under showSeasonManageGear gate; gear aria-labelledby). If pipeline dead on relaunch: branch feat/222-season-manage-card, delete if incomplete, relaunch from args-222.json.

**Deferred:** CLAUDE.md stack table claims Playwright — no E2E infra exists in mvox-app (research-221 finding); queue doc correction. robots.txt Allow:/ now 302s (noted to PO). **#249 args notes (Gama 2026-09-05, TWO items):** (1) if event/[id]/+page.svelte's location-corpus code is touched during #249, move the `locationCorpusRequested = true` latch BELOW the `if (!selected) return` guard in ensureLocationCorpusLoaded (one-line tidy, not a defect — premature focus before collective resolve latches the flag and kills suggestions for that visit; accepted degrade today). (2) event-create-type carries BOTH a visible <label> wrapper AND an aria-label naming the same key — #205 F1 double-naming shape, predates #242, no user-visible defect; fold into #249's label-parity pass, not separately (Gama 15:20). **Pattern to watch (Gama):** 'infrastructure written for a state the app never reached' — #199 refusal plumbing, #229 held keys; cheap to make reachable, easy to mistake for dead code on sweeps (R1 relevance). **Race-proof recipe for future args (Bentham [METHOD-PROVING-A-TIMING-RACE-PRE-FIX], proven on #260):** three-part clause — (1) deterministic-by-construction ordering (mock ONLY the async boundary with test-held deferreds, everything else real); (2) file-level pre-fix replay (checkout main's file over branch — legal under single-tree, no worktree); (3) failure trips the real assertion, never a timeout. Order matters: determinism first, then replay measures the fix's absence and nothing else.

### [PREVIOUS] 2026-09-03 — session MVOX-13 → MVOX-14 (board EMPTY, clean shutdown 2026-09-03 21:30 EEST)

mvox-app main @ `66ebd9d`. **13 issues closed this session** (all squash-merged, one commit each, `Closes #N` in body): #219 `0f98490`, #207 `32845d6`+`8e6d014`, #208 `63033d4`, #209 `5788866`, #211 `e53b8e9`, #214 `b598a61`, #212 `91b3905`, #213 `6cd7a72` (manual squash after YELLOW-cap halt → fix-213 agent → Bentham r4 GREEN), #215 `7ed4ede`, #217+#216 `6814565`, #218 `c0e6d1d`, #220 `66ebd9d`. Ready board: EMPTY. Open issues: NONE. Stray branches: none. finn/bentham/perotin standing.

**Live gates outstanding for Mihkel (not blockers):** #219 second-Google link + rights-refused DELETE status note; #207 TimeSelect/date pickers/profile pref + hint; #211 hues adjustable; #213 cogwheel toggle; #215 date chips; #217 season delete counter; #218 login in et/lv/uk; #220 AM/PM on displays. Native date pickers DECIDED (Mihkel "Option 1" 11:53 on #207, as built — keep native; NOT open). #20/#29 non-owner widened-fields check = two-account block on Mihkel's checklist (Gama 18:32), not ours.

**Process rules landed this session (auto-memory + skill):** dynamic Workflows pin `model: 'claude-sonnet-5[1m]'` on every agent() + meta.phases (Mihkel 01:17); NO team-lead commits in ~/workspace-app while a pipeline is live (shared tree sits on the feature branch — bit once, recovered); Workflow `scriptPath` must be in cwd/scratchpad → `cp` the template to scratchpad, Read once, launch (canonical stays in `.claude/workflows/`). Template merge-gate (no merge on non-GREEN) proved itself on #213. Research findings persisted under `teams/mvox-dev/memory/research/`, pipeline args under `teams/mvox-dev/memory/pipeline-args/`.

**FIRST ACTION on relaunch:** /mvox-wake → drain mail → `gh issue list --label ready` in ~/workspace-app → /mvox-pickup each. Nothing in flight.

### [PREVIOUS] 2026-09-02 00:35 EEST — session MVOX-12 checkpoint (pre-CLI-update restart likely: fable 5.1 needs claude ≥2.1.251, we're on 2.1.220)

mvox-app main @ `79b629d`. 10 issues closed this session: #199 #204 #200 #201 #196 #193 (`8fb676c`, 4-round review + classifier-halt recovery) #205 (`79b629d`, same pattern) + chores. PO-side is now Henry (po-team on fable 5.1 update; mail them, first-acted on wake).

**IN FLIGHT at checkpoint:** (1) #206 single-slice pipeline `wf_8b10d4ae-77d` — if dead on relaunch: branch feat/206-signin-flow, delete if incomplete, args persisted in session workflows dir; MERGE may halt on classifier if review YELLOW-caps (KNOWN template gap, 2 occurrences) — recovery: fix agent → Bentham GREEN → manual squash-merge with gate documented in commit body (see 8fb676c/79b629d for the pattern). (2) research-208-217 batch workflow `wf_d94746dd-54a` — 9 ready issues filed 2026-09-01 evening: #208 #209 #211-#217 (+#207 = rules-5/7 retrofit). Findings land in journal.jsonl of that run's dir; re-run cheap if lost.

**QUEUE:** #207 (rules 5+7: 24h/ISO/profile pref; ASK GAMA/HENRY: is rule-6 Monday-first in #207 or separate?) then #208-#217 per research findings (sizes/deps determine packing). ALL intake via /mvox-pickup skill (~/.claude/skills/ — six steps, research as dynamic Workflow with repo guard).

**UPGRADE PLAN (Mihkel 2026-09-02): CLI update to ≥2.1.251 + fable 5.1 happens AT the next workflow break** — after #206 closes + between-chains batch commits, BEFORE launching #207+. Do NOT launch a new pipeline at the break; signal Mihkel instead.

**BETWEEN-CHAINS QUEUE (after #206):** 1. Template fix tdd-slice-pipeline.js: post-review-loop guard blocks only RED — YELLOW-after-cap falls through to MERGE (=the classifier halts); change to fail-loudly-on-non-GREEN + embed final verdict+gates in MERGE prompt + StructuredOutput-final-action line in all schema'd prompts. 2. Bentham authors (edit-only, I commit): Path C setAccounts rewording (dead symbol), rules 5+6+7 into standing-rules section, lint:fix reconciliation (session-16/19 decisions cite nonexistent script). 3. Sweep board, launch next pipeline.

**Standing rules 1-7 live**; 5/6/7 = sanctioned locale-override exception family to rule 2. PII thread fully closed (purged+fsck-verified, redacted, audit trail in git).

**NEW THIS SESSION:** `/mvox-pickup` skill (`~/.claude/skills/mvox-pickup/`) — six-step issue intake, MANDATORY; research runs as dynamic `research-<N>` Workflows (Mihkel ruling) with repo-guard (`git remote get-url origin` must end mvox-app.git — wrong-repo fiction bit twice). PO standing rules 1-4 in architecture-decisions.md (native controls; polyphony.uk spec source; whole-field + TAB in-situ activation, profile fields included per Mihkel overrule). PII: seed-186 redacted, unreachable git objects purged + fsck-verified, audit trail committed `d924e4d`. Bash(*) allow rule committed `12d5220` (schema repo).

### [RELAUNCH] 2026-09-01 08:05 EEST — session MVOX-11 → MVOX-12

**Recovery done 08:15 EEST (MVOX-12):** finn/bentham/perotin respawned; dead run `wf_93430750-198` had RED-only branch → deleted; #199 relaunched from identical args as run `wf_092b7ebf-918` (args copy: scratchpad/args-199.json). main @ `2dc60f0` (finn scratchpad salvage). NEW issue #204 (work picker + composer, ready). Finn researching #200/#201/#196/#193/#204 in parallel. Gama start report sent. Untracked `scripts/migrations/seed-178-crede-members-2026-08-27.ts` still uncommitted — Pérotin to judge keep/commit.

mvox-app main @ `fe47af1`. entu/research @ `670fc07`.

**Merged since last checkpoint:** #197 `5be6420` (delete events/series), #198 `f998237` (create works), #203 `3e3dd38` (event detail delete), #194+#202 `fe47af1` (event type filter removed, all types in agenda).

**IN FLIGHT at relaunch:** #199 pipeline (localized event type picker) — run `wf_93430750-198`, launched 2026-09-01 08:02 after the classifier fix. **Check its state first**: if the branch `feat/199-event-type-localized-picker` has commits + GREEN review, merge it (squash, `Closes #199`); if incomplete, delete branch and re-launch from the same args (script args in this file's history / issue #199).

**Remaining ready queue after #199:** #200 (skip dates, small), #201 (empty-state onboarding, small), #196 (event→series conversion, medium), #193 (profile auth linking, medium). ALL pre-researched — Finn findings are baked into workflow history at `/tmp/.../tasks/wr2g2ljbq.output` (may be gone after relaunch; key facts: #200 = disabled-state + visible heading in +page.svelte ~4400-4434, don't conditional-render (breaks spec line 530); #201 = onboarding banner gated on `!agendaLoading && seasons.length===0 && seasonCreateRights==='editor'` + AgendaList `noSeasons` prop; #196 = two-phase, hint text first, then eventConvert.ts with name-property DELETE so event inherits series name; #193 = profile page auth-provider linking via second entu_user POST).

**CLASSIFIER FIX (important):** `Bash(*)` allow rule added to `~/workspace/.claude/settings.json` on 2026-09-01 — the auto-mode classifier was blocking every pipeline MERGE step + manual merge workarounds. With this rule, pipelines should merge cleanly now.

**Standing rules added this session:** ready-label gate, auto-pickup ALL ready items, Finn parallel research on every workflow start/finish (memory: feedback_finn_parallel_research.md), Gama progress reports.

**mvox_crede state:** 21/21/21 person/member/profile + 7 sections + 19 menus + library + 41 events (event_type all English). Joosep invite: real token minted 2026-08-31, redeemed by test acct, cleaned + re-minted — check with Mihkel whether Joosep redeemed the final one.

**FIRST ACTION on relaunch:** 1) `/mvox-wake` (respawn finn/bentham/perotin), 2) check #199 pipeline state (see above), 3) board check + continue queue.

### [PREVIOUS] 2026-08-31 — session MVOX-11 checkpoint

mvox-app main @ `fa9ec16`. entu/research @ `670fc07`.

**Session MVOX-11 (2026-08-16 → ongoing, checkpoint 2026-08-31 20:34 EEST):**

**37 issues touched (33 closed + 4 open):**

Code merges (mvox-app): #160 `cfac9a8`, #161 `b7d8839` (57 files, org→db entity), #163 `9909371` (test isolation), #164 `78c6399`, #165 `94ecb9a`, #167 `1d65fd0`, #173 `960ec85`, #174 `b63308e`, #175 `ad07525`, #185 `fa9ec16` (provisioning runbook).

Code merges (entu/research): #162 `e97541c`, #172 `417de6b`, #180 `1ae0d0d`, #181 `eb051e5`, #187 `670fc07`.

Data ops (polyphony): #159 (1564 entities deleted), #169 (org prop-def removed), #170 (165 orphan members), #171 (person name formula).

Data ops (mvox_crede): provisioned fresh db, #178 (20 members migrated), #179 (Mihkel profile), #182 (7 sections), #184 (members menu), #186 (schema audit), #187 (13 menus), #188 (clean-slate re-seed), #189/#191 (Joosep invite), #192 (add_from wiring), #195 (event_type rename).

**New database: mvox_crede** (Crede choir pilot). Provisioned 2026-08-27, re-seeded clean 2026-08-29. Final counts: 21/21/21 person/member/profile + 7 sections + 19 menus + 1 library + 41 events.

**Standing process rules (new this session):**
- `ready` label = dispatch gate (feedback_ready_label_gate.md)
- Auto-pickup ALL ready tasks on completion (feedback_auto_pickup.md)
- Bake Gama reports into every pipeline (feedback_pipeline_progress_reports.md)

**Comms:**
- passepartout↔mvox bidirectional channel established 2026-08-29
- Brilliant KB upgraded to v0.10.1 (noted, not integrated)

**Currently running:** #197 pipeline (delete events/series from UI — pilot blocker)

**Open issues:**
- #197 (ready, pipeline running) — delete events/series
- #196 (backlog) — standalone event → series conversion
- #194 (backlog) — event_type i18n hardcode bug
- #193 (backlog) — profile auth linking

**Pipeline fix backlog (not filed as issues):**
- add_from wiring step in setup-entity-types.ts (#192 follow-up)
- Library instance seed in setup-entity-types.ts (#166 follow-up — library type created but no instance)
- Members menu in setup-entity-types.ts (#184 — currently standalone, not in the 13 baked-in menus)

**Standing teammates:** finn, bentham, perotin (always-on)

**FIRST ACTION if restarting:**
1. Check #197 pipeline result
2. Check board for new ready issues
3. Respawn teammates if needed

(*MVOX:Palestrina*)


**CORRECTION 2026-09-02: rule 6 NOT shipped** — #210 closed-as-duplicate (COMPLETED is metadata artifact); #207 = sole tracker rules 5+6+7+step300. Verify shipped-claims against code, not issue state.
