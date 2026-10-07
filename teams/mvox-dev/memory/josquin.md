# Josquin scratchpad

Only Josquin writes here. History lives in git; this keeps what the next issue needs.

## [PATTERN] Standing working rules

- PATH: prefix pnpm with `PATH=~/.local/share/pnpm:$PATH`. No prettier/eslint
  binaries; wrap long lines by hand.
- Gates: iterate with `pnpm test:changed`; before reporting run `pnpm check` and the full suite
  once, in the foreground. The full suite exceeds 600 s: split src/routes, src/lib, the rest.
  Run with `ulimit -c 0` (crashed workers dumped 2.4GB cores into the repo root).
- Commit and push in one Bash call behind a branch guard. Stage explicit paths; never stage
  `teams/…/bentham.md`, `scratchpad/`, or the untracked crede probe. `git add -N .` catches
  them too: name the new files.
- RED first: the new spec fails against the defect; no existing case does.
- Commit GREEN before named breaks; restore with `git checkout -- src/`, never `HEAD -- file`.
  A break that stops compilation reads as zero failures: grep "Failed Suites" too.
- A brief that conflicts with a pinned assertion: stop and report with a recommendation; don't
  loosen it. Updating an exact-literal pin is reported as an assertion change.
- Report: SHA, line counts, every spec edit, anything that passes for the wrong reason.
- Tests come from the producer's real output; assert full shapes (`toEqual`).

## [GOTCHA load-bearing] Comment rules follow every touched file

Touching any old file puts all of it under comment-rules.spec; count its comments first.
Fastest trim: strip whole-line comments by script, check `git diff -U0` removes only comments,
hand-add a top line and a few one-line whys. A shrink below 400 lines leaves LINE_CAP_REGISTER
(`src/lib/testing/lineCap.ts`). Leave `src/lib/redact/redact.ts` + spec alone (pinned comment text).

## [GOTCHA load-bearing] After every await in a moved handler, check "closed meanwhile"

List each post-await read of page state and keep it. A `mounted` flag cleared by
`$effect(() => () => { mounted = false; })` fixed a lost write.

## [GOTCHA load-bearing] Write gate: the page owns writes and the offline sentence

`src/write-gate-coverage.spec.ts` (traced by `src/lib/testing/writeReach.ts`): a `.svelte` that
value-imports a write seam must import `$lib/net/online` and render
`m.write_unavailable_no_signal()`. A child takes `isOffline`, the sentence and the seams as
props (types only). Never value-import write seams into a `.ts` to dodge the fence; pass mixed
reads via `deps` as lazy wrappers, because partial `vi.mock`s throw on eager access.
Page action objects that value-import seams join `WRITE_RELAYS`.

## [GOTCHA load-bearing] bind:this ref read inside an effect re-runs it

`roles?.reset()` inside an effect-run load tracked the ref: endless loop. Wrap in `untrack`.

## [PATTERN] Guard specs and pins

`--changed` never selects readFileSync specs; run them by path (`grep -rl <file> src
--include=*.spec.ts`), and the root `src/*.spec.ts` (e.g. unclassed-controls) by path too.
Grep every spec for a file's path before moving code: allowlists (soleCreatePath EXEMPT) pin
code to a file. When code moves to a sibling, repeat negative pins on the sibling.

## [GOTCHA] Mocks and props

- Bundled prop objects (`seams={{ a, b }}`) read mocked exports eagerly; single props are lazy.
- A full page mock of a module hides new exports: put page helpers in their own module.
- Swapping a seed for signIn can replace a beforeEach `setToken` silently; pass `token:` through.
- A spread on a control hides its class from unclassed-controls.spec: write `class={x.class}`.
- reportProblem cannot import collectives/store ($env/dynamic/public throws in happy-dom).
- Multi-page contract specs: mock reads over the real module (`importOriginal`), keep writes
  real, assert page lists against `pagesReaching()`; reset preference stores in afterEach.

## [GOTCHA] Cloudflare Pages: missing-file 404 and its headers (#832, 2026-10-07)

A nested `static/_app/404.html` gives a real 404 under `/_app/*` while the site SPA fallback
stays. A `_headers` rule on `/_app/404.html` reaches the 404 answer for any missing `/_app/*`
path (checked on the branch preview), and real chunks keep their defaults. The page's own path
answers 308, so it is excluded from the worker manifest. Branch previews:
`https://<branch-with-dashes>.multivox.pages.dev`, built on push without a PR.

## Scripts

Mutation runners and split tools: ~/workspace/scratchpad/{611,615,616,684,711,716,723}/.

(*MVOX:Josquin*)
