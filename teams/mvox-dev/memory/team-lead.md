# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-07 (session "MVOX-2") — same convention as prior.** Full history in git + prior memory versions.

### [NEXT SESSION] 2026-08-07 — CHECKPOINT: team-config moved; verify wake, then report to Gama

mvox-app main @ `195ba82`. **Slice 3 (#16) is fully landed** — all five tasks (#17/#18/#19/#20/#36) closed, live gate passed (Mihkel both seats, 18:33 comment on #20). #16 epic is with Gama for PO acceptance. **Slice 4 was already done last session.**

**FIRST ACTION:** if wake came up clean (all files read from `~/workspace-app/teams/mvox-dev/`), send Gama a comms message reporting the repo-move: team config now lives in mvox-app (`195ba82`), schema repo updated (`49d4537`), no functional changes to the app. Then proceed to normal work (#38, #9, #35).

**What happened this session (MVOX-2, 2026-08-07 ~13:35–18:35 EEST):**
- Restarted from container restart. Built `/mvox-wake` skill (`~/.claude/skills/mvox-wake/SKILL.md`) + wired `~/.claude/up-wake` per operator request.
- Fixed Pérotin's prompt to point `$REPO` at `~/workspace-app` (the real app repo), not `~/workspace` (schema repo). `603b129`.
- Closed a T3.1 audit-trail gap: Pérotin reconstructed a result artifact for the 128+128+1 live run (no committed ledger existed). Bentham reviewed YELLOW, 4 citation fixes landed. `84af649` + `6aace4c`.
- **#20 live defect surfaced** (Mihkel, ~13:34): roster crash for non-admin reader. Root cause: `member.person` + `member.section` prop-defs had no `_sharing` → private-bucket-only at aggregation time. NOT an entity-tier issue, NOT orphan-related (orphans never reach the throw — filtered by `status.string=active`). Mihkel ruling: crash is ENDORSED ("i like crashes").
- Wording fix merged (`be27762`): "cannot read" replacing "has no person reference". Bentham GREEN.
- Live rights-tier fix (`241ea1a`): 2 prop-def writes + 245-member touch-save sweep, full §8.6 chain (probe → Bentham pre-exec YELLOW→satisfied → authorized → executed → ledger committed). Mihkel confirmed both seats see full roster (18:33).
- Bentham scratchpad pruned 985→375 lines (`d78f5c8`). Pérotin scratchpad pruned 1990→~200 (`96a1851`), then updated with session learnings (`fb69bbc`).
- Filed #38 (YELLOW-20.1: raw thrown message leaks to end users untranslated — Byrd+Comenius).

**Housekeeping DONE (2026-08-07 session 3):** moved `teams/mvox-dev/` from `~/workspace` (schema repo) to `~/workspace-app` (app repo). Updated all path references in prompts, common-prompt, startup, global CLAUDE.md, wake skill, and schema-repo CLAUDE.md. `$REPO` default now `~/workspace-app/`. Launch convention unchanged (still start from `~/workspace`); team config read via absolute paths from `~/workspace-app/teams/mvox-dev/`.

**Open issues (mvox-app):**
- **#38** — roster error message i18n leak (small, Byrd+Comenius, not started)
- **#9** — T4.8 name-prefill follow-up (prefill mandatory name from `EntuUser.name`, small, not started — see #28 comments for the PO ruling)
- **#35** — profile edit v2 (larger feature)
- **#37** — data/config cleanup round (epic)
- **#16** — slice 3 epic (with Gama for acceptance, should close soon)
- **#14** — Playwright RSVP coverage (deferred)

**Repo-identity gotcha (baked into /mvox-wake but worth repeating):** `~/workspace` = schema repo (`mvox_v4e_web`), `~/workspace-app` = live app (`mvox-app`). Issue numbers collide. Always `cd ~/workspace-app` before `gh issue` lookups.

**Process learnings baked in this session:**
- T3.1 lesson operational same-day: committed result ledger as part of every live run, not after the fact.
- Bentham's 3-gate AND for bucket exposure (prop-def sharing, TYPE-level cap, instance sharing) — type-cap guard is mandatory on any future prop-def migration.
- Stale duplicate dry-run artifacts cause real review mix-ups — clean superseded ones as you go.

(*MVOX:Palestrina*)
