# CHORE-72 — landing page redesign — resumption state

**Last updated:** 2026-05-31 07:45 by team-lead, mid-CHORE-72 pause for team-recreate cleanup.

## Where we are in the plan

Plan: `docs/superpowers/plans/2026-05-31-landing-page-plan.md` (committed at `c97341a`).

| Task | Owner | Status | SHA |
|---|---|---|---|
| 1. Create `chore/landing-redesign` branch | team-lead | ✅ done | (branch create, no commit on chore branch yet at that point) |
| 2. Comenius — i18n keys (41 new × 4 locales; -7 deprecated) | comenius (any incarnation) | ✅ done | `0e1a4bf` on `chore/landing-redesign` |
| 3. Tallis RED + Byrd GREEN — LandingPillarCard | tallis / byrd | ⏳ next dispatch | — |
| 4-13. components leaf-up | tallis / byrd | pending | — |
| 14. /+page.svelte orchestrator rewrite | tallis / byrd | pending | — |
| 15. Bentham branch review | bentham | pending | — |
| 16. Josquin merge + deploy | josquin | pending | — |

## Branch state

- **`chore/landing-redesign`**: tip `0e1a4bf` (Comenius's Task 2 commit). Pushed to origin. Don't delete during the team recreate — disk branch persists; only `~/.claude/teams/mvox-dev/` runtime is wiped.
- **`main`**: will have the resumption-state commit + inbox-snapshot commit landing as part of the team-recreate cleanup. Chore branch will need a quick `git merge main` (or rebase) before Task 16's squash, but no urgency.

## Pause context

PO paused after Comenius-2's Task 2 report. PO then directed: "recreate the team now while the branch is clean; nothing in flight". This file captures resumption so the post-recreate dispatch can pick up cleanly.

## Notable Task-2 handling notes (preserved here in case the i18n-conventions diff is hard to find later)

- `landing_invites_body_1_html` — `<strong>` preserved across all 4 locales. Project's first `_html`-suffix convention; documented in `i18n-conventions.md` `_html` section.
- `landing_dashboard_library_meta_ready` — static plural suffixes per the no-ICU-plural rule; uk uses invariant `прострочено` short-passive.
- Old `+page.svelte` scaffold used all 7 removed keys. Comenius applied surgical inline-literal replacement (5 edits, no restructuring) so `pnpm check` stays green until Byrd rewrites the page in Task 14. **Important for Byrd at Task 14:** the page currently has 5 inline string literals where landing_* m.calls used to be — Byrd's full rewrite will replace them naturally; no separate cleanup required.
- "Back office" brand phrase localized idiomatically: et `tagakontor`, lv `aizmugures birojs`, uk `офіс`. Not word-for-word.

## What to do on resume

1. PO sends a "resume" signal (or equivalent).
2. Team-lead checkouts `chore/landing-redesign` (verify with `git branch --show-current`).
3. Re-create task #7 (supervising task for the chain) and task #8 (post-CHORE-72 cleanup — only if not yet executed by then).
4. Spawn `tallis` (no suffix — fresh team after recreate) with Task 3 dispatch.
5. Continue the chain strictly sequentially per the plan's SEQUENCING DISCIPLINE block.

## What does NOT need re-doing on resume

- i18n keys are committed; no Comenius dispatch needed unless Bentham YELLOWs a translation during Task 15 review.
- The `chore/landing-redesign` branch is on origin; no re-create.
- Task 2 state is in git history; no scratchpad re-write needed.

(*MVOX:Palestrina*)
