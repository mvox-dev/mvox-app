# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-08 (session MVOX-4).** Full history in git.

### [NEXT SESSION] 2026-08-08 — session MVOX-4 → MVOX-5

mvox-app main @ `840175d` (or later if #66/#67 workflow lands before session ends).

**What happened this session (MVOX-4, 2026-08-08 ~22:52 EEST → ongoing):**

Largest session to date. 11+ merges, ~1800 Entu writes, two new slices progressed.

**Build lane — 11 features merged:**
- #38 roster error i18n, #39 name prefill, #40 sibling page error i18n
- #35 profile edit v2 (major — autosave, unified draft, visibility picker as save surface)
- #42 admin/invite error i18n
- #52 nav shell (3-breakpoint: bottom tabs, spine rail, top bar)
- #58/#61/#62 gate fixes (public name, notch, idle 2s)
- #63 library browse (works/editions/copies with availability)
- #59/#60 sign-out + identity display
- #65 rail side-switching fix (window.orientation)

**Data lane — #37 Phase 3 complete + #54 T6.1/T6.2/T6.2b:**
- #43 credential pre-check, #44 18-prop-def narrow + 132-person re-agg (149/150)
- #45 retire apply-to-join + probe cleanup, #46/#53 orphan disposition (7 deleted, 108 hidden)
- #47 menu shells privatized, #48 member display-config fix (descriptions parked)
- #55/#56/#57 library visibility (12 prop-defs + 586 instances × 2)

**In flight at session end:**
- **#66/#67 workflow running** — sign-out with identity + invite picker databases. Check if merged.

**FIRST ACTION next session:**
1. Check if #66/#67 landed — if not, investigate/resume
2. Check #49 — T5.5 gate CLOSED this session (Gama confirmed)
3. T6.4/T6.5 — library i18n pass (may be absorbed) + live gate
4. #48 descriptions — parked, needs Mihkel's authored content
5. #14 Playwright — deferred

**Key learnings saved to memory this session:**
- `feedback_ultracode_team_roles.md` — TDD chain roles → workflow phases
- `feedback_gama_green_sufficient.md` — Gama GREEN = go, don't loop to PO
- `feedback_no_signature_in_conversation.md` — signatures for files/comms, not chat
- `feedback_no_parallel_dispatch.md` — no parallel lane dispatch until worktrees
- `reference_gama_comms_routing.md` — gama@po-team, not gama

**Retro posted on #9** — 8 subjects covering slices 4–5 + #37 cleanup. PO response pending.

(*MVOX:Palestrina*)
