# Josquin scratchpad

Only Josquin writes here. History lives in git; this keeps what the #526–#529
page splits need.

## [PATTERN] How #508 split the agenda page (the template for #526–#529)

- Markup components go in `src/lib/components/<area>/`, script-only modules in
  `src/lib/<area>/`. The route file stays the mount point, so specs that render
  `./+page.svelte` change nothing.
- A form that only exists while open (EventCreateForm, SeasonCreateForm): mount
  it only while open; reset fields and prefetch at construction (`untrack`). The
  page keeps `open`, and `submitting`/`status` as `bind:` props.
- A panel whose state must outlive open/close (SeasonManagePanel): always mount
  it where its `{#if}` sat, with the `{#if}` inside. The page calls into it via
  `bind:this` + `export function` (reset/open/close/refresh). The page keeps any
  state its own code still reads.
- Bound props write through to the parent even after the child unmounts (Svelte
  `props.js`: the `bind:` setter has no destroyed check), so `submitting = false`
  in a `finally` still lands.
- A big load orchestrator (agendaLoad.ts): the page holds
  `const ag = $state(createAgendaLoadState())` and reads `ag.x`; non-reactive
  counters (requestId, load ids) sit in a plain `seq` object so reading them in
  an effect tracks nothing; `createAgendaLoader(ag, seq, deps)` returns the
  functions the page destructures. Script the rename; `pnpm check` finds misses.

## [GOTCHA load-bearing] After every await in a moved handler, check "closed meanwhile"

The page used to read state after an `await` that told it the form had closed
(`const origin = eventCreateOrigin`). The slice 2 move lost that read, so a
collective switch mid-create ran the whole success tail from an unmounted form.
The fix was a `mounted` flag cleared by `$effect(() => () => { mounted = false; })`,
read right after the await. For every moved handler: list each post-await
read of page state and keep it, through getters if the state stayed in the page
(`currentRequestId: () => requestId`). Add a spec for any check you restore, run
RED against the pre-fix commit (close the form mid-create by switching collective
while the create promise is held).

## [GOTCHA load-bearing] Write gate: the page owns writes and the offline sentence

`src/write-gate-coverage.spec.ts`: (1) a `.svelte` that value-imports a write
seam (a lib module with a non-GET `method:`) must import `$lib/net/online`;
(2) a gate reader must render `m.write_unavailable_no_signal()`. When the only
offline sentence moves into a child, the page fails (2). What worked: the child
takes `isOffline`, the sentence string, and the seam functions as props (it
imports only their types), so the page stays the one writer and renders the
reason. Never make a `.ts` module value-import write seams to dodge the fence;
pass mixed-module reads in via `deps` as lazy wrappers
(`listX: (...a) => listX(...a)`), because page specs' partial `vi.mock`s throw
on eager access to a missing export.

## [PATTERN] Guard specs to retarget (paths and literals only, no assertion change)

`--changed` never selects readFileSync specs; run them by path every time:
`src/person-name-marker.spec.ts` (FILES + NOT_A_PERSONS_NAME; a file that no
longer imports PersonName leaves FILES but keeps its closed-rule entry),
`src/trashcan-sweep.spec.ts`, `src/routes/page.ux-polish-i18n.spec.ts`
(CHANGED_SURFACES, FOCUS_STRIP_EXCEPTIONS), `src/write-gate-coverage.spec.ts`,
`src/routes/page.write-offline-sweep.spec.ts`, plus every spec that reads the
route source (`grep -rlE "routes/<x>/\+page\.svelte" src --include=*.spec.ts |
xargs grep -l readFileSync`). Negative pins (`not.toContain`) should read route
+ new module together, or a regression in the route goes unseen. Count pins
can pass by coincidence after a move (agendaTypeFilter write count): report it.
Touching a spec makes the #509 comment check apply to the whole file; trim its
comments (≤3 lines, ≤100 chars, <10% share, no review/slice history).
`src/lib/redact/redact.ts` + `redact.spec.ts`: leave untouched (pinned comment
text vs comment rules; logged conflict).

## [STATE] Line cap (#525, merged 950856e) — `src/lib/testing/lineCap.ts`

STEP 1500, NEXT_STEP 1000. EXCEPTIONS (shrink-only; spec pins the original
four): `src/routes/event/[id]/+page.svelte` 3464, `roster` 2911, `library` 2143,
`profile` 1719. REGISTER = every source file over 1000: the four plus
`src/routes/+page.svelte` 1452, `SeasonManagePanel.svelte` 1306,
`src/lib/agenda/agendaLoad.ts` 1036. When a split lands: drop the route from
EXCEPTIONS once it is ≤1500, and fix REGISTER both ways (add new files over
1000, drop files now ≤1000). Every file a branch ADDS must be ≤1000.
`test:changed` already runs the line-cap and comment specs by path.

## [PATTERN] Standing working rules

- PATH: prefix pnpm with `PATH=~/.local/share/pnpm:$PATH`. No prettier/eslint
  binaries; wrap long lines by hand.
- Gates: iterate with `pnpm test:changed`; before reporting run the full
  `pnpm test -- --run` and `pnpm check` once, in the foreground.
- Commit and push in one Bash call behind a branch guard
  (`[ "$(git branch --show-current)" = <branch> ] && git add … && git commit …`).
  Stage explicit paths; never stage `teams/…/bentham.md`, `scratchpad/`, or
  the untracked crede probe.
- RED first: the new spec fails against the defect; no existing case does.
- Comments: why only, ≤3 lines; when in doubt, leave the comment out.
- A brief that conflicts with a pinned assertion: stop and report the conflict
  with a recommendation; don't loosen the assertion. Updating an exact-literal
  pin (e.g. the test:changed script string) is reported as an assertion change.
- Report after every task: SHA, line counts, every spec edit, anything that
  passes for the wrong reason. Stay on the branch until Bentham reports.
- Tests come from the producer's real output; assert full shapes (`toEqual`).

(*MVOX:Josquin*)

## [GOTCHA] Touching a heavily commented spec pulls the whole file under the comment rules

#612: a new runtime dependency fails `workers/entu-rights-mcp/fences.spec.ts` (exact
`dependencies` pin, designed to be refreshed). Editing it meant trimming every comment
block in the file. Budget for that whenever a pin lives in an old spec.

## [PATTERN] Comment-rule trims on touched files (consolidation-700 W1, 2026-10-01)

Bulk trim: drop whole-line comment runs >3 lines or with review history, then drop short
runs until the share is under 10%; keep directives. Check that `git diff -U0` removes only
`//`, `*` or blank lines, then rewrite the top line by hand, because a cut run leaves it mid-sentence.

## [GOTCHA] Spread attributes hide a control's class from unclassed-controls.spec (#633, 2026-10-01)

A snippet-param spread (`{...control}`) on an input/select/textarea fails the guard, which
needs `class=` in the tag. Write `class={control.class}` by name. The guard is in src/*.spec.ts,
which `test:changed` does not run, so run the root specs by path before committing.
