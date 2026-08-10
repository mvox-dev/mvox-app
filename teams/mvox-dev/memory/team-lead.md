# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-10 (session MVOX-6).** Full history in git.

### [NEXT SESSION] 2026-08-10 — session MVOX-6 → MVOX-7

mvox-app main @ `ee7ea5e`.

**What happened this session (MVOX-6, 2026-08-10 ~02:25 EEST → ongoing):**

Major workflow session — Lending 1.0 epic delivered, TDD pipeline template created and evolved.

**Completed:**
- #72 TL.1 — Librarian seat wiring (manual TDD chain, `33189f2`)
- #73 TL.2 — Single checkout + return + my-loans (workflow, `3a93761`)
- #74 TL.3 — Bulk checkout + return (workflow, `8dec64b`)
- #75 TL.4 — i18n + a11y pass (workflow, `c657081`)
- #76 TL.5 — Live gate PASSED, #71 Lending 1.0 CLOSED
- Nine gate corrections on #76 (bulk shape, refinements, consolidated, inline checkout, bulk return removal, date localization)
- CF Pages cache purge — production domain restored (token widened with Cache Purge permission)

**Workflow template evolution (6 commits):**
- Created `~/workspace-app/.claude/workflows/tdd-slice-pipeline.js`
- 8-phase chain: SPIKE → SEED → RED → GREEN → REVIEW → FIX → MERGE → PROBE
- Model pins: opus-5 (SPIKE/REVIEW), opus-4-6 (SEED/FIX), fable (RED), sonnet (GREEN/MERGE/PROBE)
- All model IDs fully qualified with [1m] context — no shorthands, no caller-dependent resolution
- Template `scriptPath` invocation has args-parsing bug (tasks array arrives as undefined) — needs investigation; ad-hoc scripts work as workaround

**Key learnings saved to memory this session:**
- `feedback_single_workflow_slices.md` — pack whole slices into single workflow
- `feedback_use_template_not_adhoc.md` — always use template, never ad-hoc scripts (model pins drift)

**FIRST ACTION next session:**
1. Investigate template `scriptPath` args-parsing bug (tasks array undefined)
2. #77 Attendance 1.0 — pipeline-ready, #82–#87 on the board, dispatch when PO ready
3. 4 settle-at-grooming questions on #77 need answers before dispatch
4. #37 cleanup epic — still open, needs PO verification
5. Production domain: CF cache purge now works via API (token widened)

**Standing teammates this session:** finn, bentham, perotin (always-on), tallis, josquin, byrd (spawned for TDD chain, stayed alive)

(*MVOX:Palestrina*)
