# Pickup record — 2026-09-10 wake (session MVOX-19)

## Live runs
- **#305 pipeline**: run `wf_d7f0f306-d97` (task whqroavmv), single-slice, branch feat/305-roadmap-board, args = committed args-305.json. Entry notice sent (msg bb60f13779875e53). Label `in process`.
- **research-290-277-289**: run `wf_4a2e0419-fe0` (task wd6cyojzb), 6 agents sonnet-5[1m], read-only. Covers #290 site verify, #277 mechanics + guard idiom + axes, #289 auto-save inventory, #256 UI pre-scan.

## Queue (proposed order, Gama may re-order)
1. #305 — IN PIPELINE now
2. #301+#302 — args committed (args-301-302.json), #301 first
3. #304 — research committed (research-304.json), args to author
4. #303 — research waits for #302 landing (same file)
5. #233 — A.4 migration BEFORE formula; my explicit live-auth step stands
6. #290 — one-site typeface fix (AttendanceSurface member name → body face + why-comment; groups 2/3 untouched). Tiny; candidate to pack into next run once research lands.
7. #277 — per-season management entry (per-season affordance, NOT picker; panel names its season; season switch = context switch, REUSE generation-guard idiom; rights re-derived per season; no new control when only one manageable)
8. #256 — TWO parts: (a) Pérotin seeds `link` type both dbs (shape fully settled in final Gama comment 2026-09-09; app extension, no entu/research PR; commits land at a main gap only; live run behind my explicit auth per standing gate); (b) UI slice after type exists (admin add/edit/reorder/remove, members read, stable order, no URL validation beyond non-empty, no empty description line)
9. #289 — EPIC: inventory doc committed first (research produces content; commit at main gap), then I cut sub-issues (RSVP four-states, Attendance four-states, + whatever inventory surfaces). #267 = the reference pattern, no second pattern.

## Key rulings pinned (from issue comments, all Mihkel 2026-09-09)
- #290: "group 1 only"; Caveat stays; rule = identity-yes/information-no; comment at site mandatory.
- #277: "season surface is now satisfactory" — no respec coming; build on current surface.
- #256: "link entity is app extension. we are free from v4E." Gama defaults stand: admins-only write, display_order, name/url/description only.
- #289: released from deferred as epic; inventory gates sub-issue cutting; remote team-lead cuts issues.

## Standing-rule bake list for args (step 3 of pickup)
- native <select>/native inputs; in-situ whole-field + tab activation; polyphony.uk as story source (UI slices)
- #277 touches season/collective switch state — pull the generation-guard/lifecycle triggers from architecture-decisions.md into review checklist
- #256 seed: §8.6 discipline, dry-run first, ledger artifacts, explicit-auth gate before live

## Gama relay 00:55 (verified on repo)
- #305 body corrected MID-SLICE: two stale acceptance lines rewritten (the dangerous one asked for an authenticated viewer-side read; now: no credential reaches browser, reads in Action only; second: absent-build guard — page keeps generated-at stamp). RED may have read pre-correction → AT MERGE: grep the RED suite for any authenticated-read/shared-cache pin; REVIEW letter-first vs corrected body is the net.
- Queue order = mine (Mihkel ruling); my proposed order stands unchanged.
- #289: cut tasks as NATIVE sub-issues (GraphQL sub-issue links), NOT a markdown checklist — #305 board indents from native links only.
- #233: not queue-gated; A.4 migration needs Mihkel's authorization AT THE TIME, and must run BEFORE the formula goes live (else existing event names destroyed on next save).

## Research wf_4a2e0419-fe0 LANDED (persisted: memory/research/research-290-277-289.json, UNCOMMITTED — commit at main gap)
- **#290 PREMISE REFUTED**: line 203 = EVENT name in panel header; member name (line 240) never had font-display. Routed to Gama (issue comment 5609488735): (a) swap anyway / (b) close no-change. HELD out of queue. If (a): fix = DROP font-display (no font-sans utility exists; unstyled = Inter), zero test fallout, house comment idiom = `#<issue> — <what>: <classes>, <contrast>` above element.
- **#277**: single flat manageableSeasonId/Rights $state (+page.svelte:347-348); manageableSeason() pure pick at conductorLogic.ts:104-116 (own doc names #277's gap); NO season card list — ONE card, per-season affordance = iterate manageable subset. HAZARDS: seasonManageFieldsLoaded not season-keyed (reopen shows stale fields); in-flight writes (confirmSeasonFieldEdit 3193, conductor add/remove 3270/3287) capture seasonId but resolve into shared state UNGUARDED; rights derivation lives inline in load .then(), not callable per-season; TWO guard implementations exist (routeLoad.ts machine vs seasonManageDeleteGeneration local) — args must pick reuse target. requestId bumps on collective switch only, NOT season switch.
- **#289**: inventory 14 findings; ZERO <form>/onsubmit in app — every write is auto-save-shaped; full detail in research JSON. Sub-issues = NATIVE sub-issue links (Gama).
- **#256**: UI pre-scan done (closest pattern = repertoire/section child-list idiom); Pérotin's seed prep dry-run clean both dbs, holding.
- Baseline: 4241/4242 tests green; the 1 fail = scripts/roadmap/cli.spec.ts (=#305 RED in flight, expected).

## #290 RULED (a) narrow — back in queue (comment 5609522341, verified)
Scope: remove font-display from AttendanceSurface.svelte:203 ONLY (other 41 uses untouched). Comment at site with the SURVIVING reason (smallest + only truncated user-text in display face; face = identity not information) — must NOT repeat the refuted person's-name claim. No rule/enforcement. Mihkel gets it as a correction; could still overrule to no-change. Fix shape from research: DROP the class (no font-sans), zero test fallout.
Gama diagnostic ask: next TWO messages to po-team, mid-session spaced, include raw `date` beside my stamp. (1/2 goes with next report.)

## SEAM 06:20 — #301 a467f8e + #302 295cfd9 MERGED (run wf_8a0dbe9b-de3, 14 agents, 0 errors), issues closed, labels cleared, branches deleted, landing notice sent.

## #307 PICKED UP (Gama dispatch 06:18; body = contract, 0 comments)
One slice, roadmap-board follow-up: (1) label chips carry the label's own colour, text colour per-chip from relative luminance, hairline border (worst cases: wontfix #ffffff on white page, blocked #b60205); label with no colour → today's neutral chip; (2) closed_at fetched + closed group sorts most-recently-finished first, missing closed_at sorts last; (3) open group by number ASCENDING (Gama's reading, one word to overturn); (4) explicit divider + Estonian headings Pooleli/Tehtud (Gama's inference — flag if wrong); (5) sub-issues inherit ordering + chips identically; NOT in scope: label filtering. Facts verified at d1b9adb but 05554ff+b79954c landed after → research re-verifies at HEAD: run wf_8b07dd17-07e (2 agents). Args next.

## #308 PICKED UP (Gama dispatch 06:44; body = contract, 0 comments; sequencing mine)
Generated-at → Europe/Tallinn local display. DECISION: after #307 (same file, mid-pipeline; no fold into live run). Key pins: ONE instant two renders — stamp.txt + datetime attr + REFRESH_SCRIPT CURRENT stay ISO UTC, only visible text localised, formatted FROM generatedAt (no second clock call); IANA Europe/Tallinn via Intl, NEVER +03:00; test pins BOTH DST sides (EEST instant + EET instant); format Estonian to the minute e.g. `10.09.2026 06:33` + zone marker; "Generated at" stays English. Research question: Node 22 full-ICU on the runner — if false, say so, don't reach for offset. Research runs POST-#307-merge (file shapes must be post-#307).

## STATE 08:15
- #305 d1b9adb, #301 a467f8e, #302 295cfd9, #307 17e7851, #308 1bd3b5a — all merged+closed this session.
- #256 SEED LIVE both dbs (ae4568b pushed): polyphony type-def 6aa2398620ebf490c690ab23, crede 6aa239d620ebf490c690ab64. UI slice unblocked, queues after #304+#290 and #303.
- RUNNING: #304+#290 pipeline wf_46617aa3-eec (SPIKE probes unassign owner-gate live; Gama has amend-before-GREEN window); research-303 wf_01ee3aca-d9b (rename commit-on-blur at post-#302 HEAD; sharp edge = double-commit call count).
- REMAINING queue: #303 → #256-UI → #277 → #289 (inventory doc + native sub-issues) → #233 (Mihkel at-the-time auth, A.4 first).

## #309 PICKED UP (Gama dispatch 08:10; body = contract, 0 comments)
Roadmap: (1) card links — <a> wraps number+title ONLY (nested-anchor validity; epics no special case), html_url from API carried verbatim (NO string-building), accessible name = content (never templated aria-label per #262), visibly-a-link at rest, same tab (one word to flip); (2) `lead` frontmatter key FIXED — additional line under title above labels, absent → nothing (no placeholder/height change), not truncated, escaped, unknown keys still ignored, public-audience constraint applies (the #306 lesson named explicitly); (3) backfill = GAMA'S content work, NOT a slice — board must keep rendering undecorated issues. PLAN: pack [303, 309] into next run after #304+#290 lands. research-309 wf_<launched> running.

## #310 PICKED UP (Gama dispatch 08:14; body = contract, 0 comments) — FOLDS into next run: pack [303, 309, 310]
boardOrder open group: primary key = activity tier (in process → in research → rest), number ASC within each tier (#307 rule per-tier); both-labels sorts as in-process (deterministic comparator); CLOSED group NEVER reshuffles (stale label must not move finished work — closedAt only); sub-issues inherit via the shared boardOrder (a second code path = the finding); TEST PINS the exact label strings "in process"/"in research" (silent-rename trap — no wrong output to notice); NO new heading/divider (chips carry state; Pooleli collision); thin wordless rule only if Mihkel asks. Two tiers not one bucket (one word collapses). RESEARCH PROVENANCE: boardOrder + module shapes verified at HEAD today by research-307 + research-309 (same function, same day); label strings verified live in research-307's palette pull — no separate run needed, noted per pickup step 2.

## #310 AMENDED (comment 5613562845, verified): pin-the-strings test DROPPED — a fixture test can't see a GitHub-side rename (suite green through the exact failure). REPLACED WITH: behaviour test (in-process > in-research > neither, number asc per tier — catches wrong/unstable comparator) + plain-words comment AT THE SORT SITE naming the coupling (rename silently disables the float). No API-call guard — trade ruled not worth it. Everything else stands. Args must carry the amended criteria, not the body's original.

## #311 PICKED UP (Gama dispatch 08:23; body = contract, 0 comments) — research wf_7f4178f0-ead running (reads from main via git show; tree on feat/304)
Add Work picker hides ONLY on confirmed-empty-after-successful-load. THE TRAP: length===0 has 3 causes — (1) confirmed empty (hide), (2) not-loaded-yet (lists blank SYNCHRONOUSLY on every reload; naive gate flickers — #288 sibling case, doc in-file on pickableEditionsVisible), (3) load-failed (deliberately visible-but-empty; naive gate silently inverts that choice — no picker, no error, nothing). SHAPE: `pickableWorksVisible?: boolean` exact sibling of pickableEditionsVisible — default length>0 for resolved-list callers, page-level caller overrides stickily (keyed off load-completed; sticky because component remounts on agenda-skeleton flip). Programme surface (#288's pickableEditions*) untouched. First-run empty-library hint = recommended-NOT-bundled (kept out of done-when deliberately). Queue: after [303,309,310] pack.

## #312 PICKED UP (Gama dispatch 08:26; body = contract, 0 comments) — research wf_7b4687d0-790 running
Agenda list/month → ONE segmented pill (container carries border+rounding, flush segments, selected filled). A11y CONTRACT CHANGE stated on purpose: two aria-pressed toggle chips → radiogroup/radio/aria-checked with roving tabindex + arrow keys; ADOPT roster-view-modes pattern, REUSE its keydown (no second hand-rolled WAI-ARIA impl). Testids agenda-view-list/agenda-view-month keep names; day-list default + agendaView store persistence unchanged; behaviour assertions untouched; aria-pressed→aria-checked = the STATED exception to the assertions-never-change rule. Out of scope: converging roster's three chips. Separate slice from #311 (no shared region). Queue: after #311 (or pack [311,312] one run — different files, my call at args time).

## research-312 LANDED (persisted, uncommitted): keydown NOT importable — deliberate design (roving.ts header): only rovingNextIndex is shared, every site writes a local wrapper → #312 imports rovingNextIndex + new local handleAgendaViewKeydown (roster's shape). FOUR specs reach the testids, not three (agenda-month-view = only contract one; schedule/trip-service/event-create-collapse = behaviour-only, no edits). NEW-HAZARD: viewToggle() helper (agenda-month-view.spec:223-225) hardcodes role="group" selector used by EVERY test in two describe blocks — silently null under radiogroup; RED must update the helper too. Flush-pill idiom exists in-app (LanguageSelector:96, RsvpControl:102, AttendanceSurface:260 — inline-flex overflow-hidden rounded-md border + segment border-r last:border-r-0) but only on role=toolbar; #312 = first radiogroup+flush-segment meeting (borrow visual cross-role). Pattern pin spec = page.roster-arrange.spec.ts:565-650 (radiogroup roles, one tabstop, arrow wrap both ways, Tab/Enter/Space un-prevented).

## #311 RULED B (comment 5613696176): default RENDERS; hiding = explicit opt-in by load-completed-proving caller; my follow-up = move the #288 SIBLING to the safe default (not this one to unsafe); site comment on asymmetry meanwhile. HELD on Mihkel: which surface is "the repertoire page" — if season-manage panel, its missing loading flag enters the issue. NO ARGS until that lands.
## PACK RESHAPED: args-303-309-310-312.json (four tasks; #312 folded in since #311 blocks). Labels flip to in-process at launch, not before.

## #313 PICKED UP (Gama dispatch 09:01; body = contract, 0 comments) — RESEARCH DEFERRED until #304 merges (event page series region mid-rewrite in the live pipeline; convert control lands adjacent to #304's picker)
Season editor drops its event list; CONVERT moves to event page FIRST (never a window where neither has it). Pins: convert renders ONLY for standalone events; fails closed absent-not-disabled on unresolved rights/season (event page must resolve its own season + manage rights — submitEventConvert's manageableSeasonId dependency rebuilt event-side); event_create_series_hint REWRITTEN all 4 locales (currently points at the panel being removed); delete on event page untouched; panel list + both controls + their-only state/handlers removed. Research sweep: specs/text reaching season-manage-event-convert-*/delete-* — a test driving through the deleted control = the likely failure. Queue: research at #304 landing → args → run after [303,309,310,312] pack.

## research-313 LANDED (persisted; args-313.json authored, both uncommitted — commit at next gap)
Key: convert = editor-gated (series CREATE + _parent APPEND + ordinary name-value delete; NO _parent value delete → #304's owner gate is unassign-specific, convert reuses isEditor NOT isOwnerTier, with a gate-site comment explaining the split). Standalone detection = detail.seriesId === null. Spec disposition mapped per-file: event-convert.spec relocates wholesale (entry only); season-manage-delete.spec mixed (3 die, 2 modify, series-only survive); season-repertoire.spec's reload-trigger test RE-POINTED at series delete (only coverage of panel-open-across-reload). Hint strings quoted all 4 locales. No E2E/Playwright exists → one squash closes the window atomically. #313 runs single-slice after the pack.

## PROCESS FIX 14:18 — per-merge landing notices inside packed runs
Missed #303 (2303c18, 12:13) + #309 (1d8d64c, 13:24) — notices went only at run boundaries. Overdue lines sent, labels cleared. STANDING FIX: persistent Monitor bfvrvwcyf watches origin/main, emits per-merge-commit events → I send the one-liner at landing time. This is the re-arm the checkpoint's "Monitor bqt2mnib2 = landing notices, re-arm at next pipeline launch" called for and I skipped. Re-arm at every future session/pipeline start.

## LABEL CONTRACT AMENDED (Mihkel, 2026-09-10 15:04): new `researched` state between research-landed and pipeline entry.
Lifecycle now: `in research` (research dispatched) → `researched` (research artifact landed; args authored or authorable; amendments still cheap) → `in process` (pipeline entry) → cleared after landing notice. Reverts researched→in research only on a re-research dispatch. Label created (#c5def5). Applied: #313, #256 (UI half), #277, #289.
## AMENDMENT: label renamed `researched` → `prepped` (Mihkel 15:05). Same lifecycle slot.

## #315 PICKED UP + PREPPED (Gama dispatch 15:09; body = contract, verified by direct probe at origin/main — ACTIVE_TIER_LABELS render.ts:181, findIndex :190, closed-immunity :194-199)
One element: ['in process','prepped','in research']. Pins: placement-between (fails on reorder), multi-label vs both neighbours, closed stale-prepped immunity, sub-issue inherit. Site comment names all 3 strings + records the researched→prepped 2-minute rename as the warning's proof. args-315.json authored (uncommitted). Sequencing after the pause = Mihkel's word.
(*MVOX:Palestrina*)
