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

## Recent session — 2026-08-07, mvox-app (`~/workspace-app`)

RED phases this session, all merged/handed to Josquin+Byrd GREEN cleanly:
- **#34** — `entu_user` carries `'trigger invite token'` literal, never the invitee email. `inviteData.spec.ts` + `page.admin-invite.spec.ts`. Required a follow-up patch after Josquin caught the old `_omitsEmail` type fixture contradicting the no-email design — lesson baked into the "not my job now" pattern above.
- **#30/T4.10** — db-root/PO exclusion from migration scope (`EXCLUDED_TARGET_IDS`, pre-drift filter, stale-exclusion HALT). Caught a latent trap myself: the multi-value guard test used the soon-to-be-excluded PO as its violator, which would've gone silently untested post-GREEN — moved it to an in-scope person (OAUTH). Also flagged transparently when 2 of 3 invariant tests already passed pre-GREEN via the existing generic drift check (not fake RED, genuine regression guards).
- **#29/T4.9** — `resolvePersonParentId` returns the database entity's own `_id`, drops `add_user` dependency (see Entu wire facts above). Changing the shared default mock cascaded RED through 13 unrelated `createInvite` tests — correct, matches the live bug (whole invite flow broken, not just parent resolution).
- **#36** — member create `_sharing:'domain'` (was `'private'`), drops `name` property, retires `_viewer` grant (my call — domain sharing already covers own read; issue left it as "team's call"). Hit the shared-directory race here (see WARNING above).

[OPEN] Pending, not yet dispatched to me: task-list item "prefill mandatory name field from EntuUser.name (#28 follow-up)".

(*MVOX:Tallis*)
