# Josquin scratchpad

Only Josquin writes here. History lives in git; this keeps what the #526–#529
page splits need.

## [GOTCHA load-bearing] After every await in a moved handler, check "closed meanwhile"

List each post-await read of page state and keep it (getters if state stayed in the page).
A `mounted` flag cleared by `$effect(() => () => { mounted = false; })` fixed slice 2's loss.

## [GOTCHA load-bearing] Write gate: the page owns writes and the offline sentence

Per export now (#643): `src/lib/testing/writeReach.ts` traces exports that reach a non-GET.

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

`--changed` never selects readFileSync specs; run them by path: person-name-marker,
trashcan-sweep, page.ux-polish-i18n, write-gate-coverage, page.write-offline-sweep, plus
`grep -rl <file> src --include=*.spec.ts | xargs grep -l readFileSync`. Negative pins read
route + new module together. Count pins can pass by coincidence: report it.
Leave `src/lib/redact/redact.ts` + spec untouched (pinned comment text vs comment rules).

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

## [GOTCHA] Touching a comment-heavy file pulls it under the comment rules (#611, PR #808, 2026-10-05)

Adding one property to mvox-schema-extensions.ts made all of its old ruling comments fail
comment-rules.spec, and the same happened to seed-395 and online.ts. Count the comments in a file
before editing it. A dated seed script that reads the schema of record must pin its own fields.
online.spec fails on the text `navigator.onLine` even inside a comment. Offline queue: record the
created id on the device item, delete it before the retry creates again, and retry on a backoff.
Scripts: ~/workspace/scratchpad/611/mutate.py.

(*MVOX:Josquin*)

## [PATTERN] Comment-rule trims on touched files (cons-700 W1, cons-500 b1)

Touching ANY old file (spec or source) puts all of it under the comment rules; budget for it.
Fastest: script-strip every whole-line comment (keep directives), audit `git diff -U0` removes
only `//`/`*`/blank lines, then hand-add a top line + a few one-line whys and the trailers.
A shrink below 400 lines must leave LINE_CAP_REGISTER in `src/lib/testing/lineCap.ts`.
Full suite split by path: src/lib, src/routes, scripts+workers, src/*.spec.ts (510 files).

## [GOTCHA] Spread attributes hide a control's class from unclassed-controls.spec (#633, 2026-10-01)

A snippet-param spread (`{...control}`) on an input/select/textarea fails the guard, which
needs `class=` in the tag. Write `class={control.class}` by name. The guard is in src/*.spec.ts,
which `test:changed` does not run, so run the root specs by path before committing.

## [PATTERN] Page action wrappers can leave the page as a write relay (#644, 2026-10-02)

The lazy `actions` object moved to `$lib/roster/rosterActions.ts` (value-imports write seams)
and joined `WRITE_RELAYS` in write-gate-coverage.spec, like eventActions. Factory splits
(`createMemberOps`, `createArrangeOps`) compose sub-factories by spread; shared state helpers
go in their own module so sub-factories never value-import the barrel.

## [GOTCHA load-bearing] A bind:this ref read inside an effect-run load re-runs the effect (#643, 2026-10-02)

`roles?.reset()` inside load() (called from the identity `$effect`) tracked the `$state` ref, so
each mount re-ran load: an endless loop that only page.admin-lookup-reduction caught (call count).
Wrap child resets in `untrack`. Run gates with `ulimit -c 0`: crashed vitest workers dumped
2.4GB cores into the repo root and the runs then OOM-killed (#500 b4).

## [PATTERN] Pins whose code moves to a sibling: read the sibling too (#654, 2026-10-02)

Keep `source` on the old file for positive pins; add `const core = readFileSync(sibling)` and
repeat each negative on it, and move a positive whose code moved. A concatenated source is
weaker: either file could satisfy a positive. Barrel + value-importing core is a safe ESM cycle
only while the imported constants are read inside functions.

## [GOTCHA] Path allowlists pin code to a file (#640, 2026-10-02)

soleCreatePath.spec's EXEMPT list names the files allowed the `_inheritrights` literal, and pins
the list exactly. A split must leave the create in the named file (barrel keeps it), not move it.
grep every spec for the file's path, not just `readFileSync` pins, before choosing the cut.

## [GOTCHA] Bundled prop objects read mocked exports eagerly (#637, 2026-10-02)

`seams={{ apiDeleteEventSeries, ... }}` reads every import when the object is built; a partial
vi.mock then throws "No X export". Single props are read lazily. Bundle only local functions.
A child that binds nested fields of a prop object warns on ownership: pass each bound field
as its own `$bindable` prop and bind it from the owner (`bind:x={flow.x}`).

## [GOTCHA] Swapping a seed for signIn can silently replace a beforeEach token (#710 b6, 2026-10-03)

A spec that sets `setToken('jwt-editor')` in a beforeEach and then calls a token-less seed
gets 'jwt-abc' from signIn, and the tests still pass. Before swapping, grep each file for a
setToken outside the seed and pass `token:` through. Also check for a local `function signIn(`.

## [PATTERN] #711 harness batches (b2, PR #774, 2026-10-04)

Scripts: ~/workspace/scratchpad/711/ (detail.py → show6.py → apply.py per module; copymap.py;
mutate.sh; driver b2/muts.py). Page-free harness modules (admin.ts, profile.ts) can be imported
by specs that render other pages; page-importing ones (adminInvite.ts) only by that page's specs.
Moving a shared export: grep multi-line imports too; re-export from the old module to stay ≤40 files.

## [PATTERN] One contract spec over many pages (#716, 2026-10-05)

vi.mock is per file, so a multi-page contract unions the pages' mocks: mock reads over the real
module (`{...await importOriginal(), read: handle}`), never full replacements, and keep writes real so
`nonGetCalls(fetch)` sees them. Each table asserts its page list against `pagesReaching()`
(src/lib/testing/pageReach.ts, follows .svelte/.ts imports). Sweeps that click every control leave
preference stores behind (agenda view, time format): reset them in afterEach. A derived page list
found real gaps (#550 links/roster, series-picker cue): mark them `it.fails`, report, don't fix.
Mutation runner: ~/workspace/scratchpad/716/mutate.py.

## [PATTERN] Spec split by describe, with mock pruning (#723, PRs #804/#805, 2026-10-05)

~/workspace/scratchpad/723/: split.cjs (plan JSON -> per-function files + harness with shared helpers and a
use<Page>() hook function), compare.py (per-title multiset vs a main JSON run), verify.cjs (verbatim units),
prune.py (drops each vi.mock a file passes without; temporarily log in networkGuard to catch silent fetches;
never drop a mock whose handles the file or its imported page helpers read: mockhandles.cjs. Passing alone
left dead `not.toHaveBeenCalled` asserts in #805, fixed in #806).
Moves needing care: vi.hoisted handles and anything a vi.mock factory reads go to mocks/ leaf modules;
harness-exported types need `import type`; `let` state reassigned by tests keeps hooks per file.

## [GOTCHA] Touching a comment-heavy file pulls it under the comment rules (#611, PR #808, 2026-10-05)

Adding one property to mvox-schema-extensions.ts made all of its old ruling comments fail
comment-rules.spec, and the same happened to seed-395 and online.ts. Count the comments in a file
before editing it. A dated seed script that reads the schema of record must pin its own fields.
online.spec fails on the text `navigator.onLine` even inside a comment. Offline queue: record the
created id on the device item, delete it before the retry creates again, and retry on a backoff.
Scripts: ~/workspace/scratchpad/611/mutate.py.

## [GOTCHA] reportProblem cannot import collectives/store (#684, 2026-10-06)

The store pulls discover -> entu-config -> $env/dynamic/public, which throws in every happy-dom spec
that doesn't mock entu-config. The +layout module script registers the owner store (setProblemOwner).
store.ts is comment-heavy: touching it fails comment-rules. Full suite exceeds 600 s: split src/routes,
src/lib, the rest. A `pgrep -f vitest` waiter matches its own command line. Scripts: ~/workspace/scratchpad/684/.

(*MVOX:Josquin*)

## [GOTCHA] Commit GREEN before running named breaks (#617, 2026-10-06)

`git checkout HEAD -- file` to undo a break reverted my uncommitted GREEN edits (HEAD was RED).
Commit GREEN first, then mutate and restore with `git checkout -- src/`. A full page mock of
roleManagement hides any new export from it: helpers pages need go in their own module.

## [GOTCHA] Mutation runs: a compile error reads as zero failures (#615, 2026-10-06)

A mutation that breaks the .svelte syntax fails the suite, not tests: grep "Failed Suites" too.
Corner tap over StrokeSurface: a capture-phase pointerup on a wrapper dispatches pointercancel to
the target, so the surface drops the dot itself. ~/workspace/scratchpad/615/mutate.py.

(*MVOX:Josquin*)
