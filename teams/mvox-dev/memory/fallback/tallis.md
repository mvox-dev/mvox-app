# Tallis — Test Engineer Scratchpad

Pruned 2026-08-07 (was 840 lines, historical per-chore logs from the old `mvox_v4e_web` app removed — all shipped/superseded). Full history recoverable via `git log --all -- teams/mvox-dev/memory/tallis.md` if ever needed. Below: standing patterns worth keeping across any future RED phase, plus recent-session detail.

## Standing patterns/gotchas (apply regardless of chore)

[WARNING] VACUOUS-GUARD AUDIT — always check before committing a RED: (1) no `else { expect(true).toBe(true) }`; (2) async DOM assertions must `waitFor()` the state transition, not query synchronously after an async effect; (3) `expect(mock).toBeDefined()` is vacuous — assert what it was called with; (4) `for (const x of possiblyEmptyList)` needs a length guard first or the loop body may never run; (5) every test must be able to fail, or it's dead code, not a test.

[PATTERN] YELLOW-78.1 stub rule: land a minimal stub (`throw new Error('not implemented')` for fns; empty div for `.svelte`) alongside a new-export RED spec so `pnpm check` stays 0 and failures are assertion failures, not module-resolution errors.

[PATTERN] "Not my job now" (established via #34 email-removal, reaffirmed #36 memberName): when a type-level field is being retired, don't force a new `@ts-expect-error` proving its removal if doing so breaks `pnpm check` — GREEN drops it from the type as mechanical fallout. DO fix genuine contradictions (a stale fixture that pins the OLD required-ness and would hard-conflict with the new design) — that's happened twice now (#34's `_omitsEmail`, would-be #36 case) and Josquin/team-lead catch it fast if missed.

[PATTERN] Positive-proof assertions: when a field must NEVER appear (email→entu_user trigger constant #34, `name`/`_viewer` off member #36), assert absence explicitly (`JSON.stringify(body).not.toContain(...)` or `.some(p => p.type==='x')).toBe(false)`) in addition to the shape diff — un-foolable even if the shape check has a gap.

[PATTERN] Runtime-guard RED against a `throw new Error('not implemented')` stub: assert on the REJECTION MESSAGE content, not a bare `.rejects.toThrow()` (vacuous — stub always throws regardless of the real guard).

[GOTCHA] `@ts-expect-error` only suppresses a diagnostic on the literal next line — keep type-check object literals on ONE line so a multi-line literal's property-level error doesn't slip past the directive. Always run `pnpm check` (not just vitest) for any RED with `@ts-expect-error` proofs — esbuild strips types in vitest.

[PATTERN] Responsive Tailwind pairing: a `sm:grid`/`sm:flex` without a base `hidden` renders in block flow below the breakpoint — always assert BOTH classes together for any breakpoint-gated element.

[PATTERN] `$lib` alias unresolved in standalone `vitest.config.ts` (no SvelteKit plugin) in the OLD app; the NEW app (`mvox-app`) DOES resolve `$lib` — check which repo before assuming.

[PATTERN/mvox-app] Mock convention: inject `fetchImpl: typeof fetch = fetch` as an explicit param + real `new Response(JSON.stringify(body), {status})` via a local `json()` helper — not `vi.stubGlobal('fetch', ...)` (old app's style).

[DECISION/Entu wire facts, source-cited] `entu_user` string is a mint-TRIGGER only, deleted at create regardless of value (`entu-api utils/entity.js:462-467`) — any truthy string works, so a fixed constant replaces the invitee's real email (#34). Entu ALWAYS adds the authenticated caller as `_owner` on create independent of `_inheritrights` (`entity.js:404-410`) — self-creates need no `ownerIds` grant; admin-as-db-root creates do. Person `_parent` = the database entity's own `_id` at bootstrap (`entu-api setupDatabase.js:183-191`) — NOT `add_user` (deleted by #22); never read add_user again, even if a stale value reappears (#29).

[WARNING] SHARED SINGLE WORKING DIRECTORY — `~/workspace-app` is one filesystem checkout shared by ALL teammates (Josquin/Byrd/Tallis/etc.), not per-agent worktrees. A concurrent `git checkout` by another agent between your `checkout -b` and your `commit` WILL land your commit on whatever branch they left checked out (hit this 2026-08-07 on #36 — RED landed on `main`). Mitigation: immediately after any commit, verify `git log --oneline -1 <branch>` actually contains it before reporting done. If a commit lands on the wrong branch: preserve it via `git branch -f <correct-branch> <sha>` (safe, no checkout) FIRST, then STOP and ask team-lead before any `reset --hard` or other destructive correction — even when confident it's safe, route the destructive step through them (process correction from team-lead, 2026-08-07). Structural fix (worktrees/serialization) escalated to PO, not mine to solve.

[GOTCHA] `vi.useFakeTimers()` + `@testing-library/svelte`'s `waitFor()` DON'T MIX — `waitFor`'s internal polling uses real `setTimeout`, which fake timers freeze, so any assertion needing both a controlled "now" AND an async `waitFor` transition hangs to a 5000ms timeout instead of failing cleanly (hit 2026-08-10, #73 overdue-indicator tests). Fix: don't fake the clock — pick dates safely far in the past/future (e.g. `'2020-01-01'` / `'2099-01-01'`) relative to the real system date instead of pinning "today".

[PATTERN] Env: `pnpm` is not directly on `$PATH` in this session's shell — invoke via `corepack pnpm <cmd>` (confirmed working for `test`/`check`, 2026-08-10).

## Recent session — 2026-08-10, mvox-app (`~/workspace-app`)

RED phases this session, handed to Josquin+Byrd GREEN:
- **#72/TL.1** — librarian seat wiring. `librarianStore.spec.ts`, exact structural mirror of `adminStore.spec.ts` (library vs organization). Clean RED (module-not-found only), no follow-up needed.
- **#73/TL.2** — checkout/return/my-loans. `lendingActions.spec.ts` (new — `createLending`/`returnLending`, wire-shape modeled on `rsvpData.ts`'s `createRsvp`/`updateRsvpStatus`) + 9 new cases added to `page.library.spec.ts` (my-loans section, librarian checkout form, per-copy return button). Flagged 3 implementation-shaping assumptions in the handoff for Josquin/team-lead to confirm: (1) reusing `rsvpData.ts`'s `findMyMemberId` to resolve the viewer's own member for "my loans" rather than a new resolver; (2) return button keyed by `copyId` not `lendingId` (matches existing `library-copy-{id}` convention) — GREEN must look up the active lending internally; (3) checkout copy/member picker data source left open (no `listAllCopies`/`listMembers` exists yet).

(*MVOX:Tallis*)
