# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-09 (session MVOX-5).** Full history in git.

### [NEXT SESSION] 2026-08-09 — session MVOX-5 → MVOX-6

mvox-app main @ `c94192b`.

**What happened this session (MVOX-5, 2026-08-09 ~00:25 EEST → ongoing):**

Data/platform session — 10 commits, 480+ Entu writes, two major investigations.

**Completed:**
- #70 — Configuration menu admin-only (3 `_sharing` DELETEs, Bentham GREEN)
- #48 — Meta polish descriptions (160×2 EN+ET = 320 writes, trust alternative)
- T6.4 — Library i18n/a11y verified absorbed by T6.3 (#63), posted on #54
- T6.5 — Already done per Gama (Mihkel walked live gate, PASS on #54)
- #68 — db-root _owner backfill — closed with MAJOR CORRECTION (see below)

**#68 key findings (platform knowledge):**
1. "Cohort 3" (3 ownerless profiles) was a phantom — entities DO have owners, invisible to db-root due to Entu bucket system
2. Entu bucket system verified from source: rights properties (`_owner`/`_editor`/`_viewer`) live in private bucket ONLY; non-granted callers read domain/public bucket without rights
3. `_inheritrights: false` blocks the inheritance path into the access array, but the filtering is the bucket selection
4. Any grant (even bare `_viewer`) gives full rights visibility — all-or-nothing at private level
5. `systemUser` is hardcoded internal-only (6 backend routes), no obtainable "service key"
6. Cohorts 1+2 (69 entities) resolved via `_inheritrights: true` cascade — Mihkel added db-root as `_owner` on the database entity manually

**Platform fixes:**
- Person type-def: added `name` + `email` prop-defs with `search:true` (fixes Entu UI picker). Existing entities need touch-save to re-index (only db-root done)
- db-root person: `_sharing: private` → `domain`, renamed to "db-root (mvox dev admin)" (`69bcfd8e9c031ab8e6ce8079`)

**Research: owner-discoverability gap:**
- Entu has NO mechanism for non-owners to discover or contact entity owners (verified from API source, webapp source, docs)
- Mihkel interested — relates to prior Argo discussion
- Three directions identified: Entu feature request / BFF solution / schema workaround
- No ruling yet

**FIRST ACTION next session:**
1. Check if #37 and #54 epics are closeable (all sub-tasks done)
2. Owner-discoverability thread — awaiting Mihkel's direction
3. #14 Playwright — deferred
4. #71 Lending — BACKLOG, not ready (PO ruling)

**Key learnings saved to memory this session:**
- `feedback_entity_id_readability.md` — always include human-readable names alongside entity IDs
- `project_entu_inheritrights_hides_rights.md` — Entu bucket system: rights in private bucket only (verified from source)

(*MVOX:Palestrina*)
