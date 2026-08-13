# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-13 (session MVOX-9).** Full history in git.

### [NEXT SESSION] 2026-08-13 — session MVOX-9 → MVOX-10

mvox-app main @ `015ed1a`. **v1.0 milestone complete + 4 walkthrough improvements + section data cleanup.**

**What happened this session (MVOX-9, 2026-08-12 17:04 EEST → 2026-08-13 ~10:05 EEST):**

Three work blocks, ~17h elapsed.

**Block 1 — #114 gate corrections (F1-F6):**
- #124 (F1-F3): Section creation page-level affordance + org-scoped tree filter (`063067a`)
- #125 (F4-F5): Repertoire work title unindent + status inline buttons + unified edition picker (`c674b48`)
- #126 (F6): Library copy sort partition-then-sort (`76cf8db` initial nulls-last, `5f132c4` corrected spec partition)
- Gate re-walked and PASSED. Epic #108 ACCEPTED and CLOSED. v1.0 milestone complete (6/6 epics).

**Block 2 — #127 section data cleanup:**
- 17→12 sections. 60 Entu mutations (53 main run + 7 Baritone follow-up). Consolidate duplicates, remove orphans, fix hierarchy. Pérotin executed with §8.6 discipline.

**Block 3 — #128-#131 walkthrough improvements:**
- #128: Collapse available copies for member view (`ec06447`)
- #129: Loan entries show full copy→edition→work chain (`0510c41`)
- #130: iOS form zoom fix — font-size >= 16px globally (`0ac57dd`)
- #131: Profile name conflict resolution — browse-then-confirm two-tap (`015ed1a`)

**Issues closed this session:** #108, #114, #124, #125, #126, #127, #128, #129, #130, #131

**Process lessons (save to conventions for MVOX-10):**
1. Team-lead coding STRICTLY FORBIDDEN — not "discouraged", forbidden. Route to teammates.
2. Don't burn team-lead context on idle acks/status narration — only speak on decisions/routing.
3. Use workflows or TDD chain teammates, not one-shot agents (one-shots acceptable but not preferred).
4. Agent filesystem isolation is asymmetric — commits from one agent may not be visible to another. PUSH TO ORIGIN between handoffs. Standing convention for next session.
5. Worktree isolation worth revisiting for MVOX-10 — the "worktrees leaked" reports from session 32 were likely agent cwd confusion, not real worktree failures. Would solve the shared-tree collisions.
6. Review-before-merge gate: don't send merge to Josquin until Bentham's verdict is in hand (#129 was merged before review — process skip).
7. Ask Gama first for product decisions, don't block on PO.

**FIRST ACTION next session:**
1. Establish worktree isolation convention (or confirm push-to-origin as standing protocol)
2. #122 — Event create _sharing default-to-private (open follow-up)
3. #123 — Language selector on profile page (new feature)
4. #37 — Cleanup epic, needs PO verification
5. #14 — Playwright RSVP coverage (not scheduled)
6. YELLOW follow-ups: #128 pluralization (Comenius), #131 Escape key test (Tallis), #131 setTimeout cleanup

**Standing teammates this session:** finn, bentham, perotin (always-on), byrd, josquin, tallis (on-demand, spawned mid-session)

(*MVOX:Palestrina*)
