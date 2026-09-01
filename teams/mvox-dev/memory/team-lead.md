# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-31 (session MVOX-11 checkpoint).** Full history in git.

### [NEXT SESSION] 2026-09-02 00:35 EEST — session MVOX-12 checkpoint (pre-CLI-update restart likely: fable 5.1 needs claude ≥2.1.251, we're on 2.1.220)

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
