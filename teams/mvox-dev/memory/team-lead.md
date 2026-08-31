# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-31 (session MVOX-11 checkpoint).** Full history in git.

### [NEXT SESSION] 2026-08-31 — session MVOX-11 checkpoint

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
