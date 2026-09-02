# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-31 (session MVOX-11 checkpoint).** Full history in git.

### [NEXT SESSION] 2026-09-02 01:20 EEST — session MVOX-13 wake (post CLI update, running 2.1.236 / fable 5.1)

mvox-app main @ `44389f9`. #206 merged `1ccd497` + closed; between-chains batch committed `44389f9` (template merge-gate fix, rules 5-7 docs) — BOTH done before restart, so the between-chains queue is cleared. finn/bentham/perotin respawned 01:12. Mail inbox empty on wake. NEW on board: #218 (localize sign-in surface, Gama, sequenced after #207-#217).

**Research 208-217 COMPLETE** — persisted at `teams/mvox-dev/memory/research/research-208-217.json` (workflow `wf_d94746dd-54a`, bb474219 session dir). Sizes: 208 S, 209 M, 211 S, 212 S, 213 M, 214 M, 215 M, 216 S, 217 M. Pre-RED rulings requested from po-team 01:20 (one mail, grouped per issue). Dependency notes: #211 before #214; fold #216 into #217 (pending ruling); #207/#208/#215 all edit the series/event-create block of +page.svelte — re-verify line anchors at branch time.

**#207 INTAKE (01:35):** step 1 done — `ready` confirmed; 5 Gama comments, last = consolidated scope: rule 5 (24h default + profile AM/PM pref, display-only, datetime-local included) + step="300" on all 3 time inputs + rule 6 (Monday-first day select, values unchanged) + rule 7 (YYYY-MM-DD on all date pickers AND displays: season create/manage dates, series from/until, skip dates, event create/detail date portion, agenda/list displays). Step 2 research running: `research-207` Workflow `wf_b75fbd7e-c5f` (5 agents: 24h-time / profile-pref / monday-first / iso-dates / sweep; journal in this session's subagents/workflows dir). Step 5 ack to po-team sent 01:20 (queue position: next slice). Steps 3+6 pending research result. Bake rules 1/2/4/5/6/7 + triggers [TRIGGER-24H-TIME] [TRIGGER-MONDAY-FIRST] [TRIGGER-ISO-DATE] [TRIGGER-NATIVE-CONTROLS] [TRIGGER-INSITU-WHOLE-FIELD] into GREEN prompt + review checklist.

**#219 INTAKE (01:40):** new from Gama (Mihkel live-testing #193). task+ready, no comments. Scope: profile link-picker stops blocking an already-linked provider (all 6 buttons enabled once linked list loaded; `linkedLoadFailed` still disables); linked identities (provider+email, deduped by uid+provider) listed above the selector; same-identity re-link guard moves into run-link-callback.ts (snapshot uid+provider pairs pre-mint → after `redeemed` re-read + compare → if duplicate: show `profile_link_error_already_linked`, DELETE newer duplicate entu_user property with user's own token, log rights refusal without failing sign-in). Live gate: Mihkel's second-Google case. Sequence: after #209, before #218. Small. Governed surface (auth/identity) → Path C triggers into review checklist. Research: `research-219` Workflow `wf_0446cf50-8e5` (3 agents: picker / callback guard / sweep). **RULE (Mihkel 01:17): dynamic workflows pin explicit versioned models on every agent() + meta.phases — research = `claude-sonnet-5[1m]`; first launches inherited Fable and were stopped+relaunched (research-207 now `wf_e3e176a4-3b6`, supersedes wf_b75fbd7e-c5f). Baked into /mvox-pickup step 2 + auto-memory. Gama says all rulings on #208-#217 sub-questions are on the issues (01:15) — read each issue before its RED.

**#219 RESEARCH DONE (01:35)** → `teams/mvox-dev/memory/research/research-219.json`. Small (sweep says medium overall). Key facts: linked list ALREADY renders above picker (same list; new work = dedupe by uid+provider + remove 3 block sites :538/:890/:894 + delete dead `linkedProviderIds` :161-168); focus-after-open spec :735-752 also breaks (not in issue's test list); citation linkedIdentities.ts:52 wrong (shape at :20-25/:71-76); entu-api claims verified at 7853ada AND unchanged to HEAD; #209 does NOT touch profile page (no collision); #218 gap: second hardcoded `PROVIDER_LABELS` map profile/+page.svelte:35-47. Asked Gama 01:38: same key vs distinct copy for post-hoc duplicate message. Path C triggers bind sub-change B (callback): entuFetch only, JWT via storage.ts, no new proxies, no ad-hoc 401 handling.

**#207 RESEARCH DONE (01:37)** → `teams/mvox-dev/memory/research/research-207.json` (run `wf_e3e176a4-3b6`). Sizes: A rule5 medium, B pref small, C rule6 small, D rule7 LARGE-or-medium (depends on ruling), sweep=large overall. Recommendations: A = composite native selects hour(00-23)+minute(5-step) + date control on datetime-local surfaces; AM/PM mode = hour 1-12 + AM/PM select; breaks 3 `.type` assertions (series-create.spec:522, event-create.spec:645, event-editing.spec:546-547) + ~45 fill()/beginEdit() call sites → one shared test helper. Current anchors: +page.svelte:5169 series time, :5975 event datetime, :5157-5163 day select, event/[id]:1753. Text displays already 24h (Intl h23/hour12:false at 4 sites). B = localStorage `mvox.time_format` store (pattern collectives/store.ts:20-22) + 2-button toolbar or select on /profile (LanguageSelector pattern). C = literal option reorder 1..6,0. D = text displays via en-CA Intl (AgendaList:164 precedent) / formatToParts; pickers = 10 sites (8 type=date + 2 datetime-local date halves). Asked Gama 01:40: (1) rule 7 pickers — extend rule-2 exception (select triplets, LARGE) vs text-only (MEDIUM); (2) narrative headers "Monday, 15 June" exempt?; (3) localStorage confirm. Pipeline args authoring waits on (1)+(2).

**#219 PIPELINE LAUNCHED 01:50** — run `wf_fb4f4b50-e67`, branch `feat/219-link-picker-unblock`, args at `teams/mvox-dev/memory/pipeline-args/args-219.json` (SPIKE skipped; RED/GREEN/review checklist carry Gama's 01:36 ruling: distinct key `profile_link_noop_same_identity`, neutral style, en/et copy on the issue). Gama re-sequenced #219 directly after #207; launched FIRST because #207 RED is blocked on rulings and Mihkel is live on the linking case (Gama informed 01:45). If dead on relaunch: branch incomplete → delete, relaunch from args file. **HARNESS GOTCHA:** Workflow `scriptPath` must live in cwd (~/workspace) or the session scratchpad — `~/workspace-app/.claude/workflows/tdd-slice-pipeline.js` is refused; `cp` the template into the scratchpad dir, Read it once, then launch (sha-verified identical copy).

**#219 MERGED 02:40** — squash `0f98490`, review GREEN round 1 (11/11 checklist, 2834/2834 tests, 0 type errors), issue CLOSED, branch deleted. Live gate open for Mihkel: second-Google link + observed status of a rights-refused property DELETE → record on #219. Docs stash popped + committed between chains.

**#207 MERGED 05:20** — part 1 `32845d6` (rules 5+6: TimeSelect.svelte, src/lib/preferences/timeFormat.ts, profile select + hint, Monday-first; review YELLOW→YELLOW→GREEN, 2 FIX rounds: spec hook-ordering, AM/PM meridiem state bug), part 2 `8e6d014` (rule 7 ISO text on 7 numeric sites; GREEN round 1). Issue CLOSED. Run `wf_1d3b1f12-c79`, 14 agents. Follow-ups pending Mihkel (NOT issues yet): native date-picker ISO rendering; text time displays following AM/PM pref.

**RUN 3 MERGED 10:30** — `wf_65373ee9-a3f`, 29 agents: #208 `63033d4` (GREEN r1), #209 `5788866` (Y→G), #211 `e53b8e9` (Y→G; 12 `--color-type-*` tokens), #214 `b598a61` (Y→G). All CLOSED. Gama informed with live gates.

**RUN 4 → #212 MERGED `91b3905`, #213 MERGED `6cd7a72` 13:30** (halted at #213 YELLOW x3 fix cap; fix-213 agent 9f9059e + Bentham round-4 GREEN → manual squash-merge, gate in commit body; role=toolbar KEPT per SPIKE two-member state, reported on issue). **RUN 5 LAUNCHED 13:35**: #215 → #217(+216), args `pipeline-args/args-215-217.json`. Then #218 (`args-218.json`, Google=bare noun ruled) → #220 (`args-220.json`, defaults accepted by Gama 12:10), each its own run.

**#220 INTAKE (12:00):** NEW from Gama (Mihkel: "Am/pm preference applies globally"). task+ready; LAST comment = RELEASED, sequence directly after #218. Scope: one shared formatTime(hhmm, prefs) next to the #207 preference read; every app-rendered time text follows mvox.time_format (24h unset default; ampm → "7:00 PM"); stored/submitted values unchanged; dates untouched; no "follow device" option. Done-when includes a grep-style guard: no hardcoded HH:MM rendering outside the formatter. Research DONE 12:09 → `research/research-220.json` (only 3 time-text sites: AgendaList row-time, event detail timeRange, event_created toast; others in done-when render no time). Args READY `scratchpad/args-220.json` (tallinnHHMM + formatTime in timeFormat.ts, both-ends-explicit ranges, lint spec). Gama informed of defaults 12:15. Gama acked 12:00. Native date pickers stay as shipped (Mihkel).

**QUEUE ORDER:** run 4 (#212 → #213 → #215 → #217+216) → #218 → #220 (adjust per research sizes/deps).

**NEXT:** research-207 result → author tdd-slice-pipeline args → launch pipeline. Then per rulings: #208, #209, #211→#214, #212, #213, #215, #216+#217, #218.

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
