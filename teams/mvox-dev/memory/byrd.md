# Byrd scratchpad

## [CHECKPOINT] 2026-05-20 — CHORE-2 GREEN complete

[LEARNED] Tailwind v4 uses OKLCH color space for its palette. Chromium reports colors as `oklch(...)` not `rgb(...)`. Tallis's original test had `rgb(59, 130, 246)` for `text-blue-500` — he corrected it to `oklch(0.623 0.214 259.815)` at commit `2674068`. Future color assertions in Playwright must use OKLCH values.

[LEARNED] Playwright config uses `pnpm preview` (not dev server). Tests run against a built artifact. Must run `pnpm build` before `pnpm exec playwright test` when changes are unstaged/uncommitted, otherwise stale build is served.

[LEARNED] Tailwind v4 CSS-first setup: `@import "tailwindcss"` in `src/app.css`, `@tailwindcss/vite` in `vite.config.ts` plugins — no `tailwind.config.js`. Plugin order: tailwindcss before sveltekit.

[DEFERRED] CHORE-2 is pending Bentham review (GREEN handed off, branch `feat/chore-2-tailwind-v4` HEAD `ff37268`). After Bentham GREEN, Josquin merges.

## [CHECKPOINT] 2026-05-21 — CHORE-3 GREEN complete (session 11)

[LEARNED] `@inlang/paraglide-sveltekit@0.16.1` is deprecated (use paraglide-js v2 directly) but the team is using it per the AC spec. Vite plugin import: `@inlang/paraglide-sveltekit/vite`, call: `paraglide({ project: './project.inlang', outdir: './src/lib/paraglide' })`. Plugin added between tailwindcss() and sveltekit() in vite.config.ts.

[LEARNED] `project.inlang/settings.json` needs: `$schema`, `sourceLanguageTag`, `languageTags`, `modules` (CDN URLs for message-format + m-function-matcher plugins), and `"plugin.inlang.messageFormat": { "pathPattern": "./messages/{languageTag}.json" }`. Build also auto-generates `project.inlang/project_id` and `project.inlang/.gitignore` (ignores `cache/`) — both should be committed.

[LEARNED] Paraglide only compiles when locale files have actual keys. Empty `{}` files → "No messages found - Skipping compilation" → `src/lib/paraglide/` not generated. Expected — Comenius adds keys in i18n phase.

[LEARNED] vitest.config.ts merge pattern: bare `vitest/config` has no Svelte transform. When a spec does `import('@inlang/paraglide-sveltekit')` it pulls in `ParaglideJS.svelte` and throws `Unknown file extension ".svelte"`. Fix: `mergeConfig(viteConfig, defineConfig({test:{...}}))` from `vitest/config` — picks up `sveltekit()` and all Vite plugins. This is the standard SvelteKit+Vitest pattern.

[DEFERRED] CHORE-3 handed off to Comenius for i18n phase (add starter message keys). Branch `feat/chore-3-paraglide` HEAD `df4b9b2`. Bentham review pending after Comenius completes.

## [CHECKPOINT] 2026-05-22 — CHORE-35 GREEN complete (session 13)

[LEARNED] Playwright `page.route()` intercepts BROWSER-level fetches only. SvelteKit's `event.fetch` in `+page.server.ts` goes through SvelteKit's internal router (not a real HTTP call), so `page.route()` cannot intercept it. Client-side `$effect` + `fetch()` in `+page.svelte` IS interceptable. This is a fundamental mismatch between Tallis's SSR-presence test design and the server-side fetch architecture.

[LEARNED] `+page.server.ts` client-side orgs were NOT rendered in the template; instead `+page.svelte` uses `$effect` to do its own browser-side fetch of `/api/organizations`. Server load handles session; template handles orgs client-side. Vitest tests pin server load behavior (all pass); Playwright intercepted the browser fetch (17/18 pass).

[DEFERRED] SSR test ("page data is SSR-present in initial HTML") remains RED — needs architectural decision: (a) Tallis adjusts the test, or (b) test env gets a mock Entu surface. If (b) lands, refactor `+page.svelte` to seed `orgs`/`loadError`/`loaded` from `data.*` and drop mount flicker; `$effect` browser fetch stays only for retry. Branch HEAD `461ff4d`. Comenius up next for i18n (all 10 keys have en stubs in messages/*.json).

[GOTCHA] Paraglide does NOT regenerate `src/lib/paraglide/messages.js` during `pnpm check` (only svelte-kit sync runs). Must run `pnpm build` (or `pnpm dev`) to trigger Paraglide compilation after adding new message keys. Empty message files → "No messages found — Skipping compilation" → type errors in svelte files.

## [CHECKPOINT] 2026-05-23 — CHORE-A session 16 + chain-discipline coaching

[LEARNED] **Chain discipline — spec authorship is Tallis's, always.** Even when a plan ships inline test code, I must wait for Tallis's RED commit SHA before starting GREEN. Writing the spec myself (as I did for wrapper.spec.ts and client.spec.ts in the first pass) breaks attribution and sets a bad precedent for CHORE-B. In CHORE-B wait for the brief that includes a commit SHA before touching any implementation file.

[LEARNED] **PR creation is Josquin's authority.** When my GREEN work is the final code change on a branch, I report completion to Palestrina and stop. Palestrina dispatches Josquin for the PR. I do not run `gh pr create` regardless of how complete the work is.

[LEARNED] **Scope discipline — one brief, one task.** If a brief assigns A3 GREEN, do only A3 GREEN. Do not proactively reach into A4 or A5 even if the plan is in front of me and the impl is obvious.

[LEARNED] `$lib` alias does NOT resolve in the vitest runner (uses `vitest/config`, not SvelteKit's vite config). Route files must use relative imports (`'../../../lib/entu/client.ts'`) not `$lib/entu/client`. The `$env/dynamic/private` alias works only because it's globally mocked in `src/tests/setup.ts`.

[LEARNED] Vitest `environmentMatchGlobs` is deprecated in v3. Use `@vitest-environment happy-dom` inline comment at the top of the spec file instead — Tallis already does this.

[LEARNED] `new Response(JSON.stringify(...), { status: 200 })` in happy-dom does NOT auto-set `content-type: application/json`. Tallis's revised spec (dcc5971) fixed this by explicitly passing `headers: { 'content-type': 'application/json' }` in the mock Response constructor, so the plan's verbatim implementation (content-type check) works correctly with his spec.

## [CHECKPOINT] 2026-05-24 — CHORE-66 Task 4 complete (session 22, Byrd-2)

[LEARNED] `@testing-library/svelte` auto-cleanup relies on globally-scoped `beforeEach`/`afterEach`. With Vitest `globals: false` (our config), the auto-cleanup block in `@testing-library/svelte/src/index.js` silently skips registration. Components from prior tests stay mounted; `findByRole` finds stale elements. Fix: add explicit `afterEach(() => cleanup())` to `src/tests/setup.ts`.

[LEARNED] Symptom "Found multiple elements with role 'menu'" in a single-render test = prior renders never cleaned up (not that the component rendered twice).

[GOTCHA] In Svelte 5, `$storeName` auto-subscribe works in template. In `<script>`, avoid `$derived($storeName)` for Svelte stores — use `$storeName` directly in the template instead, or `get()` for one-shot reads in event handlers.

## [CHECKPOINT] 2026-05-24 — CHORE-66 Tasks 4-6 + RED-1 + YELLOW-66.1 (session 22, Byrd-2)

[LEARNED] **$app/state vs $app/stores**: SvelteKit 2 + Runes convention is `import { page } from '$app/state'` — exports a reactive object, access as `page.url.pathname` (no `$`). Legacy `$app/stores` export was a Svelte store requiring `$page` sigil. Bentham will YELLOW any new write using `$app/stores`.

[LEARNED] **Branch hook gap pattern**: When a chore branch was cut before hook commits landed on main, `git diff --name-only main..HEAD` reveals the missing files. Fix: `git merge main --no-ff`. Verify clean with the same diff after merge.

[LEARNED] **MvoxNav props that are optional**: When adding a new prop to an existing component, make all props that existing tests don't supply optional with sensible defaults. The new mode tests (Task 5) don't pass `signedIn` or `currentTab` — making them optional with defaults (`false` / `'agenda'`) is the minimal non-breaking change.

## [CHECKPOINT] 2026-05-24 — CHORE-67 Tasks 4-12 (session 24)

[LEARNED] `src/lib/types/library-entu.ts` created with EntuLibrary / EntuWork / EntuEdition. isbn field on EntuEdition sourced from `license_note[0].string` per Pérotin probe 6a248b9 — no `isbn` key in v4E schema.

[CLOSED] YELLOW-66.2: ENTU_DB hardcode resolved via CHORE-67 squash `2012a84` + CHORE-69/#70 env-db cleanup `cd3ce6e` (session 24). Pruned from DEFERRED.

[GOTCHA] **`git pull --rebase` with any unstaged files fails** — "cannot pull with rebase: You have unstaged changes." Always stash ALL working tree files (including unrelated scratchpad edits) before pulling: `git stash push -m "label"` → pull → `git stash pop`. This recurs whenever Tallis pushes a spec fix mid-task.

[GOTCHA] **Biome reformats plan-verbatim code** — Biome rejects aligned comment columns and certain `.map()` callback forms. Always run `pnpm lint:fix` after verbatim plan paste before committing. Treat autofix as part of GREEN, not a separate commit.

[GOTCHA] **Tallis's component specs need `// @vitest-environment happy-dom`** — if missing, all render() calls fail with `document is not defined`. Has occurred twice (Task 11). Surface immediately rather than self-fixing.

[GOTCHA] **ICU plural syntax unsupported by Paraglide's plugin-message-format** — `{n, plural, one {...} other {...}}` renders as garbage (`undefined other undefined works}}`). All i18n keys with numeric params must use simple templates (`"{n} works"`) not ICU plurals. Route to Comenius to fix the key if this surfaces in a component test.

## [CHECKPOINT] 2026-05-31 — CHORE-74 GREEN complete (session 25)

[LEARNED] **Mechanical test updates when removing a helper that tests drove indirectly:** `readOrgParam()` was removed in CHORE-74; existing `selectedOrgStore — fallback chain` tests had been using `window.history.replaceState` to simulate URL params for it. Those 5 tests were updated to drive `urlOrgIdStore` directly — the store that the layout's `$effect` populates in production. Pattern: when refactoring removes an internal helper, update existing tests to drive the new public surface, document the change in the commit message body, and add `beforeEach` store-reset blocks.

[LEARNED] **`vi.mock` runtime writable vs TypeScript Readable type mismatch:** When a vi.mock replaces a `Readable` store with a `writable` (so tests can call `.set()`), `pnpm check` will error on `.set()` calls because TypeScript sees the declared type from the real module. Fix pattern: cast the import as `Writable<T>` in the spec — `import { store as _store } from '...'; const store = _store as unknown as Writable<T>`. Document in commit body.

[LEARNED] **CHORE-74 store architecture:** `selectedOrgIdStore` (Writable, localStorage-initialized) + `urlOrgIdStore` (Writable, null default) + `selectedOrgStore` (derived over all three, URL > pick > first-org). Layout `$effect` wires `page.url` → `urlOrgIdStore`. `selectOrg` writes all three channels. Auth/callback `await hydrateUserStore()` before `goto()` fixes post-login stale state.

## [CHECKPOINT] 2026-05-31 — CHORE-76/77/78 GREEN (session 26)

[LEARNED] **`overflow-x-hidden` on a flex header clips `position:absolute` dropdowns** — CSS spec forces `overflow-y: auto` when `overflow-x` is non-visible, creating a containing block that clips `top-full` panels. The correct pattern for headers with dropdowns: `relative z-30` (stacking context + z-index), NOT any overflow clip. Horizontal overflow control belongs on flex-child wrappers via `flex-shrink-0` + `min-w-0`/`truncate`.

[LEARNED] **Responsive nav pattern (MvoxNav CHORE-76/77):** Desktop tab row: `hidden sm:flex` wrapper. Mobile hamburger: `sm:hidden` button with `aria-label={m.nav_menu_open()}`. Dropdown panel: `position:absolute top-full` inside the `relative` hamburger wrapper. Focus-on-open via `queueMicrotask(() => firstItem?.focus())` in `$effect`. Escape closes + returns focus to trigger. Click-outside via `window.addEventListener('mousedown', ...)` in same `$effect`.

[LEARNED] **Mobile list/detail routing via existing URL param (CHORE-78):** `initialWorkId` prop (already derived from `page.url.searchParams.get('work')` in `+page.svelte`) drives mobile view mode — null = list, non-null = detail. No new prop needed. Mobile rows are `<a href="?work=<id>">` anchors; back affordance is `<a href="?">`. This gives browser back-button support without JS navigation.

[LEARNED] **Scroll-spy IntersectionObserver must be gated to `sm+`** — `isDesktopViewport()` predicate using `window.matchMedia('(min-width: 640px)').matches` ensures the observer is never constructed on mobile. In jsdom, `matchMedia` returns `matches: false`, so tests that replace IntersectionObserver with a throwing spy catch any mobile-path violation cleanly.

[LEARNED] **`hidden sm:grid` not just `sm:grid` for desktop-only grid wrappers** — `sm:grid` alone leaves the element in block flow below sm, causing mobile layout bleed. Must use `hidden sm:grid` so the element is absent on mobile and activates as a grid at sm+. Same principle applies to any element that should be invisible below the breakpoint.

[GOTCHA] **Library component specs are in `src/lib/components/library/` (subfolder)**, not `src/lib/components/`. The brief says "Tallis's paths are authoritative" — always check the actual file locations before reading plan paths.

## [CHECKPOINT] 2026-05-31 — CHORE-79 logout-greet fix + CHORE-72 /about page (session 27)

[LEARNED] **Paraglide `$lib` alias doesn't resolve in `.ts` route files under Vitest** — `perform-logout.ts` uses relative imports (`'../../../lib/auth/storage'`); Tallis's spec does too. Must use relative imports for `userStore` in that file, not `$lib/auth/userStore`. The `$lib` alias works in `.svelte` files and in Vite (prod/dev) but not Vitest's module resolver for plain `.ts` files.

[LEARNED] **Paraglide messages.js not regenerated by `pnpm check`** — adding keys to `en.json` doesn't make them available for type-checking until `pnpm build` (or `pnpm dev`) runs. Always run `pnpm build` first when adding new i18n keys, then `pnpm check`. The scratchpad GOTCHA from session 16 still applies.

[LEARNED] **i18n chicken-and-egg ordering:** When a new page calls `m.new_key()`, `pnpm check` will fail until the key exists in `en.json` AND `pnpm build` has regenerated `messages.js`. The correct chain is: Comenius adds keys → build → then GREEN page can call `m.*()` and pass check. If keys race ahead in a shared commit, reconcile by pulling before running gates.

[LEARNED] **Mechanical spec update during GREEN (authorized pattern):** When a key rename/restructure mechanically breaks a Vitest mock in a spec file, GREEN implementer may update the spec mock + assertions in the same atomic commit — with team-lead authorization logged in the commit rationale. This is the documented CHORE-72 Task-15 rule (Bentham-endorsed).

[GOTCHA] **`git checkout origin/<branch> -- .` overwrites unstaged implementation files** — used to sync to a fast-moving branch tip, but this reverted my written `+page.svelte` back to the stub. Always stage or commit your own files before syncing to origin tip via checkout.

## [CHECKPOINT] 2026-06-01 — Session 29 startup (rehearsal-schedule, Tasks 12/13/15)

[LEARNED] **Data layer fully landed at `6fdef24`** — `src/lib/seasons/` has `types.ts`, `recurrence.ts`, `validation.ts`, `entuSeasons.ts` (Tasks 1–10), `seasonsStore.ts` (stub — `hydrateSeasons` not yet implemented). No `seasonsStore.spec.ts` yet; store wiring (Task 11) is Josquin's.

[LEARNED] **Conductor type has `propertyValueId: string`** (YELLOW-D1 fix). `listConductors` returns `{ personId, name, propertyValueId }`. `ConductorPanel` must pass `propertyValueId` to `onremove` — NOT just `personId`.

[LEARNED] **`seasonsStore.ts` stub** — `hydrateSeasons` throws `not implemented`. Route wiring (Task 15) cannot call it until Task 11 GREEN lands (Josquin's). Route may call `listSeasons` directly if store is still a stub.

[PATTERN] **Component pattern to follow:** `LibraryMaster.svelte` / `LibraryEditionCard.svelte` for spec patterns. Props via `interface Props { ... }` + `$props()`. All i18n via `m.seasons_*()`. `afterEach(() => cleanup())` in every spec.

[PATTERN] **Route pattern to follow:** `/library/+page.svelte` for the hydration-store + `$effect` + `goto` pattern. `let initialWorkId = $derived(page.url.searchParams.get('work'))` → same pattern for `?season=<id>`.

[PATTERN] **Empty state styling:** `LibraryEmptyState.svelte` uses Caveat font for marginalia, centered, muted. Same tone for seasons empty states.

[GOTCHA] **No `seasons/` components dir yet** — will need to create `src/lib/components/seasons/` when writing Task 12 files. Plan path map is correct.

[DEFERRED] Task 12 RED: waiting for Tallis to write `SeasonForm.spec.ts` + `ConductorPanel.spec.ts`.
[DEFERRED] Task 13 RED: waiting for Tallis to write `SeriesForm.spec.ts` + `RehearsalList.spec.ts`.
[DEFERRED] Task 14 i18n: Comenius writes `seasons_*` keys — needed before my components can `pnpm check` clean.
[DEFERRED] Task 15 RED: waiting for Tallis (route spec) + Tasks 12/13 both GREEN.

## [CHECKPOINT] 2026-06-01 — Session 29 Task 15 re-GREEN + re-review (f9aac13)

[LEARNED] **`vi.importActual` module isolation — store writes go to the wrong instance.** `vi.importActual('$lib/seasons/seasonsStore')` returns an isolated module instance whose internal `seasonsStore` writable is separate from the mock factory's store (the one the component subscribes to). Calling `realHydrate(...)` inside the real module writes to the isolated store, not the mock store. Consequence: `runRealHydrate` tests never reach the component. Fix for Tallis: drive store state with `(seasonsStore as Writable).set(...)` directly — same diagnosis as the vi.doMock isolation issue.

[GOTCHA] **i18n key rename in component = spec mock update required.** Swapping `m.seasons_actions_confirm()` → `m.seasons_actions_edit()` on the edit button broke the RehearsalList spec mock (strict vi.mock proxy throws on undefined keys). When renaming any `m.*()` call in a component, update the corresponding spec's `vi.mock('$lib/paraglide/messages.js', ...)` factory. Mechanical fix = Byrd's responsibility.

[PATTERN] **P0.6 retry poll shape for series-create re-hydrate.** `await hydrateSeasons(args)` immediately after success, then `for (i < 3) { if (state.seasons.length > 0) break; await sleep(500); await hydrateSeasons(args); }`. Unit tests only assert hydrateSeasons was called ≥1 time; timing is invisible.

[LEARNED] **Branch is at f9aac13** — all my Tasks 12/13/15 work is GREEN. 701/703 unit tests pass. 2 failing RED-29.1 tests are Tallis's to fix (vi.importActual isolation). Now heading to Bentham review (Task 16).

## [CHECKPOINT] 2026-06-01 — #86 T4+T5 GREEN (8c3ab00)

[GOTCHA] **`data-testid` element's `textContent` is polluted when the element contains child elements beyond text.** Adding a `<button>` inside a `<div data-testid="rehearsal-group-header">` makes `h.textContent` = `'Tuesday EveningDelete'` instead of `'Tuesday Evening'`. Fix: split into a wrapper (flex) + a text-only child that carries the testid. Pattern: always put the `data-testid` on the most granular element that the test will `.textContent`-match.

[PATTERN] **`handleDeleteSeries` shape.** `deleteSeriesCascade(cfg, seriesId)` → `{ deleted, seriesDeleted }`. If `!seriesDeleted`: partial notice. If `DeleteForbiddenError`: forbidden notice (try/catch guard). On any result: re-load `listRehearsals` + `listSeries` via `Promise.resolve().then()` null-guard pattern. No rollback in v1.

[LEARNED] **Branch at 8c3ab00** — T4 (cancel) + T5 (delete-series) both GREEN. 734/734. T6 (edit form) next.

## [CHECKPOINT] 2026-06-01 — #86 T2+T3 GREEN (074d709)

[GOTCHA] **`seasons_actions_confirm` → `seasons_actions_edit` missed in page.spec.ts.** When the edit button label changed (YELLOW-29.2) I updated `RehearsalList.spec.ts` but not `page.spec.ts`. The page spec renders `RehearsalList` and the strict mock threw on the unmocked key, making rehearsal rows null. Always grep for the old key name across ALL spec files when renaming any `m.*()` call.

[PATTERN] **P0.6 retry with `listRehearsals` (updated from old hydrateSeasons poll).** After `createSeriesWithEvents`: (1) call `hydrateSeasons` once (tests assert it was called); (2) poll `listRehearsals` up to 3× at 500ms until `current.length > 0`. Loop shape: `let current = await fetchRehearsals(); for (i<3) { if (current.length>0) break; await sleep(500); current = await fetchRehearsals(); }`.

[LEARNED] **Branch at 074d709** — conductor wiring (T2) + read-path (T3) both GREEN. 725/725 tests. T4 (cancel wiring) next.

## [CHECKPOINT] 2026-06-01 — RED-86.1 GREEN (b4639a6)

[GOTCHA] **`window.confirm` in a component breaks route integration tests** that click through it. The route spec's `beforeEach` for any test that clicks a confirm-gated button must `vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))`. Also: any key called inside the component via `m.*()` must be in the page spec messages mock — the route renders the component, and the strict mock throws on unmocked keys even if the test isn't directly about that key.

[PATTERN] **Confirm gate in `RehearsalList` (per RED-86.1).** `rehearsal-cancel`: `if (!window.confirm(m.seasons_confirm_cancel_rehearsal_body())) return; oncancel(id)`. `series-delete`: `if (!window.confirm(m.seasons_confirm_delete_series_body({ n: group.rows.length }))) return; ondeleteseries(seriesId)`.

[LEARNED] **Branch at b4639a6** — RED-86.1/YELLOW-86.1 GREEN (confirm gates + i18n guard removal + edit hidden). 737/737. All #86 Byrd tasks done.

## [CHECKPOINT] 2026-06-01 — feat/seasons-mobile route restructure (a3cb428)

[GOTCHA] **Route restructure breaks tests assuming always-on forms.** When SeasonForm moved from always-on to on-demand (behind a `+` click), tests that directly query `[data-testid="season-name"]` find null. Fix: add `await fireEvent.click(createBtn)` before form queries. Also applies to integration specs.

[GOTCHA] **New component i18n keys must be added to ALL spec mocks that render it.** SeasonBar uses `m.seasons_a11y_create_season()` + `m.seasons_a11y_edit_season()`. Both `page.spec.ts` AND `page.integration.spec.ts` mock messages independently — both needed the new keys. Integration spec is easy to miss since it's a separate file.

[PATTERN] **`panelMode` for on-demand forms.** `$state<'none'|'create'|'edit'>('none')`. `{#if panelMode==='create'}<SeasonForm oncreate>` / `{:else if panelMode==='edit'}<SeasonForm season={sel} onupdate>`. Closes on success by setting `panelMode='none'`.

[LEARNED] **Branch at a3cb428** — route restructure GREEN: SeasonBar + on-demand panels + full-width stacked layout. 768/768.

[LEARNED] **Session 29 final state (de1ae47 on feat/seasons-mobile):** RED-MOB.1 + YELLOW-MOB.1 GREEN — SeasonForm pre-fills description, empty-owner `+` testid renamed to `season-create-empty`. 772/772. Ready for Bentham review + PO preview redeploy. Next session: Bentham review → merge → #87 (edit rehearsal form).

## [CHECKPOINT] 2026-06-01 — #87 UI GREEN (937c701 on feat/seasons-edit-rehearsal, session 30)

[LEARNED] **Dirty-tracking pattern for edit forms.** Capture original field values into a const `orig` object at mount time. On submit, compare each field against `orig.*` and include only changed fields in the patch. This prevents the session-29 description-wipe class of bug where all fields get overwritten even when only one changed.

[LEARNED] **`@const` in Svelte 5 template for derived lookup.** `{@const editRehearsal = rehearsals.find((r) => r.id === editingRehearsalId)}` inside an `{#if canManage && editingRehearsalId}` block is the clean pattern to derive a single item from a list for an inline form — no need for a `$derived` at script level.

[GOTCHA] **Svelte 5 warn: "state_referenced_locally"** — using a `$props()` value directly as an initializer for `$state(...)` (e.g. `let x = $state(prop.value)`) produces a build-time warning. It's correct behavior for pre-fill forms (we want the snapshot at mount, not reactivity to prop changes). Warnings are non-blocking; `pnpm check` reports 0 errors.

[GOTCHA] **Spec mock must include ALL i18n keys the component calls** — even from sub-components rendered by the page. The cancel button in `RehearsalEditForm` calls `m.actions_cancel()`; neither the RehearsalEditForm spec nor the page spec had this key. Added as mechanical GREEN fix (Byrd's responsibility per session-27 pattern).

[LEARNED] **Branch at 937c701 on feat/seasons-edit-rehearsal** — 800/800 tests pass. All 4 #87 spec files GREEN. Handed off to Bentham for review.

[LEARNED] **YELLOW-87.1 GREEN (c6df5cb):** Heading `<h2 data-testid="rehearsal-edit-heading" class="form-heading">` added to RehearsalEditForm, matching SeasonForm pattern exactly. Tallis's RED dd39b07 also removed ghost mock keys from page.spec — had to add `seasons_form_rehearsal_edit_heading` to the page mock as a mechanical fix. 801/801. Ready for Bentham delta re-review → Josquin merge.

[GOTCHA] **When Tallis's RED commit removes "ghost" mock keys, check which real keys the component now needs.** dd39b07 cleaned up 3 old ghost keys from page.spec.ts, but the new heading call needed a 4th key (`seasons_form_rehearsal_edit_heading`) that wasn't there. Pattern: after syncing to a new Tallis RED, grep the component calls against the mock to find gaps before first test run.

## [CHECKPOINT] 2026-06-13 — Session 33 S33 UI/UX Cleanup (all 3 sub-chains + fix rounds)

[LEARNED] **`data-desk-text` misuse patterns — both types now encountered:**
(1) Inside a bg container (PaperCard/PaperStack/panel): element already conforms; tag is a §2 review blocker. Pattern: check ancestors BEFORE tagging.
(2) Component-root blanket tag (e.g. `Margin.svelte`): exempts ALL instances including those inside bg containers. Fix: add `exempt?: boolean` prop (default false) and only set it on bare-desk callsites.

[LEARNED] **`data-testid^="prefix-"` selector collision in Vitest (AgendaList redesign):** `querySelectorAll('[data-testid^="agenda-row-"]')` matched inner `agenda-row-time/duration/location` spans as well as top-level `agenda-row-<id>` divs. Fix: rename inner testids to drop the `agenda-row-` prefix (`row-time`, `row-duration`, `row-location`). Update existing spec selectors as a mechanical refactor. Pattern: when adding a card-level wrapper, audit whether sibling testids share the wrapping selector's prefix.

[LEARNED] **Playwright bg-rule gate — selector collision for anonymous leaf elements:** Elements without `data-testid` or `id` get the tag name (`div`) as their querySelector selector. `document.querySelector('div')` always finds the FIRST div in DOM, not the specific leaf being characterized. This means all anonymous divs on a route get bucket-tested against the same element. Mitigation: add `data-testid` to any component that is a meaningful leaf (e.g. `Margin.svelte` → `data-testid="margin-note"`).

[LEARNED] **Playwright bg-rule on auth-guarded routes:** `/roster`, `/notices`, `/settings` redirect unauthenticated Playwright sessions to `/auth/login`. Gate violations reported for these routes are actually auth/login violations (confirmed by identical violation text). Gate only covers public routes.

[PATTERN] **AvatarMenu arrow-key nav implementation:** `onKeyDown` extended with ArrowDown/ArrowUp inside the same `$effect` as Escape. Collect `[role="menuitem"]` into an array, find current `document.activeElement`, modulo-step. `e.preventDefault()` prevents page scroll.

[PATTERN] **Outside-click focus restore (AvatarMenu):** `onMouseDown` path: `close(); triggerEl?.focus()` — mirror exactly what Escape does. Consistent pattern for all menu components.

[PATTERN] **tabForPath exact-segment matching:** Each segment should use `pathname === '/X' || pathname.startsWith('/X/')` instead of `pathname.startsWith('/X')` alone. Prevents false-positive matches like `/libraryxyz` → 'library'.

[GOTCHA] **Nested `vi.mock()` inside an `it` block:** Works as a hoisted re-mock for that test's render call but may be order-sensitive. Tallis's roster label test uses this pattern to prove the route isn't hardcoded. After the GREEN fix (route calls `m.page_roster_label()`), the nested mock returns `'Choir roles'` and the assertion `!== 'Choir management'` passes.

[LEARNED] **All 3 sub-chains of S33 completed in session 33 (branches: feat/s33-navigation, feat/s33-readability-visual, feat/s33-readability-conformance). Fix branches: fix/s33-seasons-rehearsal-bg, chore/s33-yellows.** Final unit suite at shutdown: 1018/1018. Outstanding pnpm check errors: 5 (3 from `page_*_label` + 2 from `library_loading/library_load_error`) — all await Comenius.

## [CHECKPOINT] 2026-06-14 — Slice-3 client GREEN + YELLOW re-spin (session 35, feat/invite-join HEAD 8b5ec86)

[LEARNED] **i18n chicken-and-egg: must add all new message keys to all 4 locale files AND run `pnpm build` before `pnpm check` can pass.** `pnpm check` runs svelte-kit sync but does NOT trigger Paraglide recompilation. `pnpm build` does. Until the keys are in locale files and build has run, `messages.js` lacks the exports → TS errors in components. Sequence: add stubs to `messages/{en,et,lv,uk}.json` → `pnpm build` → `pnpm check`.

[LEARNED] **MvoxNav must NOT be added to individual route pages — it lives in `+layout.svelte`.** Adding `<MvoxNav>` directly to a page causes paraglide mock failures in that page's spec (mock only covers page-specific keys; MvoxNav accesses all nav keys). Pattern: MvoxNav is layout-only; page specs never need to mock nav keys.

[LEARNED] **Biome format is a gate step (must run `pnpm format` before commit, not just `pnpm lint:fix`).** Josquin's commits were biome-formatted; a Bentham YELLOW in the first re-spin round traced back to Byrd files not formatted with Biome. Add `pnpm format` (not just `pnpm lint:fix`) as a required pre-commit step. `pnpm lint` catches svelte-eslint issues; `pnpm format` catches Biome formatting.

[GOTCHA] **`vi.waitFor` required for async `$effect` in page specs.** When a page component uses `$effect` to call data helpers (e.g. `listOrgMembers`), the effect resolves asynchronously after render. Tests that check post-effect state (roster visible, member names) must use `await vi.waitFor(() => expect(...))` — a synchronous check immediately after `render()` only sees the loading state.

[GOTCHA] **Paraglide mock in page spec must cover all i18n keys used by sub-components rendered during the test.** When `loadState` transitions to `'ready'`, sub-components like `InviteForm` render and call their own `m.*()` keys. If those keys aren't in the spec's `vi.mock('$lib/paraglide/messages.js')` factory, Vitest throws "No export is defined on the mock." Add all sub-component keys to the page spec mock as part of GREEN.

[LEARNED] **`InviteProjection.orgId` must be non-optional for type safety.** The accept flow needs orgId to POST `target_org` in `createApplication`. Making it optional (`orgId?: string`) leads to wishful casts at the callsite. Josquin's resolve projection now always returns `orgId` (empty string when `!valid`); the TS type should match: `orgId: string`.

[LEARNED] **`createInvitation` phantom `status` prop.** The `invitation` type has no `status` field (schema: email/token/expires_at/sections/inviter/message only). Writing `status: 'active'` to Entu creates dead data that is silently stored but never read. Always verify prop names against Pérotin's schema probes before POSTing.

[PATTERN] **Two-leg accept flow.** Singer's browser: (1) `createApplication(cfg, { personId, orgId })` — browser-direct Entu POST under singer's own JWT; `_parent=personId` is the identity proof. (2) `acceptInvite(token, { applicationId })` — BFF `POST /api/invite/[token]/accept`; elevated service JWT creates the `member`. If service-key architecture is dropped, leg 2 changes; leg 1 survives.

[PATTERN] **InviteForm button key register.** Admin creates an invitation → use `members_invite_submit` / `members_invite_submitting` register ("Send invite" / "Sending…"). Singer accepts an invitation → use `invite_accept` / `invite_accepting` register ("Accept invitation" / "Accepting…"). Never cross-wire these.

[DEFERRED] **Slice-3 accept architecture unresolved — #91.** Service-key model (what's built on `feat/invite-join`) rejected by PO as cross-org super-credential risk at scale. No-key admin-approve model leaks pending applications (`_sharing: domain` required for admin visibility). Schema-design pass needed next session to find a native solution. Branch `feat/invite-join` (HEAD 8b5ec86) is conserved, 1127/1127 GREEN, not merged.

[WARNING] **Single-tree + biome-format gate = critical discipline.** Two separate Bentham findings this session traced to (a) orgId not threaded end-to-end (real data bug) and (b) biome formatting not run (process gap). Both are avoidable. Checklist before handoff: `pnpm format` → `pnpm lint` → `pnpm check` → `pnpm test:unit` → `git branch --show-current` (confirm feat/*, not main).

## [CHECKPOINT] 2026-06-14 — About/Carus GREEN (session 36)

[GOTCHA] **Fixed-width PaperCard overflows narrow viewports.** The `width` prop sets a pixel value inline; on viewports narrower than that value the card bleeds out and causes horizontal scroll. Fix: add `max-width: 100%` to the same inline style. Applies to ALL PaperCard callers — none intentionally relied on overflow. Pattern: whenever setting a fixed `width` inline, pair it with `max-width: 100%`.

[GOTCHA] **`pnpm format` (Biome) reformats ~20 repo-wide files on every run, not just changed files.** Only stage your own task files after `pnpm format` — never `git add -A`. The pre-existing reflows (scripts/, spec files) are noise; staging them pollutes the commit and can cause Bentham YELLOWs for out-of-scope changes.

## [CHECKPOINT] 2026-06-15 — Slice-3 native-path GREEN + userStore owner-wins + SSR fix (session 37, feat/invite-join-native)

[LEARNED] **Slice-3 path C (no service key, no BFF routes).** Full browser-direct accept flow: admin creates invitation (JWT-authed Entu POST), singer gets link, landing page decodes self-describing token client-side (C5 — zero fetch), singer POSTs `createApplication` under own JWT + calls `grantEditorToAdmin` to notify admin. Admin sees pending applications via `listPendingApplications` (queries `application._parent=personId` visible to admin via `_owner` rights on org). `approveApplication` creates member + grants `_viewer` on org — all browser-direct, no service key. Token: base64url `{orgId, orgName, inviterPersonId, sections, exp}`.

[GOTCHA] **`userStore.ts` owner pass skipped upsert for dual-role founders.** The two-pass org-map builder (member pass → owner pass) originally did `if (orgMap.has(org._id)) continue` in the owner pass. Founders who have both a `member` record and `_owner` rights on an org had `role: undefined` — the owner pass skipped them. Fix: remove the guard, always upsert with `existing?.id ?? org._id` / `existing?.label || ...` / `role: 'owner'`. Owner-wins: preserves richer label/initials from member pass, always sets role.

[GOTCHA] **`$derived(browser && getToken() !== null && ...)` required for any localStorage read in a top-level derived.** CF Workers SSR runs the top-level `$derived` block without a `window`/`localStorage` global. `getToken()` throws → 500. Pattern: always guard localStorage/sessionStorage/`getToken()` reads in top-level script scope with `browser` from `$app/environment`. Event handlers (`onclick`, `async function handleX()`) are client-only and do not need the guard.

## [CHECKPOINT] 2026-08-05 — mvox-app T1 scaffold + CF Pages fallback fix

[GOTCHA] **adapter-static on Cloudflare Pages — fallback must be `index.html`, not `200.html`.** `200.html` is a Netlify-only SPA-fallback convention. CF Pages' native SPA mode only kicks in when there's no top-level `404.html`; it then routes every unmatched path to `/` and expects `index.html` to exist there. With `fallback: '200.html'` the build has no `index.html`, so `/` 404s at the root even though other static assets (e.g. `/robots.txt`) serve fine. `pnpm build` + `pnpm check` are both green in this state — only a real CF deploy surfaces it. Fix: `adapter({ fallback: 'index.html' })` in `svelte.config.js`. No `_redirects` needed once that's set.

[LEARNED] **`~/workspace-app` is a shared checkout, not per-agent-isolated.** Mid-task the working tree can be on a different branch than expected (found it on `feat/t3-auth` — Josquin's T3 OAuth work — when I came back to apply a `main`-targeted fix). Always `git status`/`git branch --show-current` before editing, and if you need to commit somewhere specific, `git stash` your edit, switch, reapply, commit/push, then switch back to whatever branch was checked out before you touched it — don't leave a teammate's in-progress branch on the wrong ref.

## [CHECKPOINT] 2026-08-06 — T5 review-fix round: M2/M3/M4 + paper-sheet GREEN (745abd6 on feat/t5-agenda)

[LEARNED] **mvox-app has no biome/eslint yet** (unlike the old mvox_v4e_web repo referenced in older scratchpad entries — no `pnpm format`/`pnpm lint` scripts or config files exist). Gate for this app is just `pnpm check` + `pnpm test` + `pnpm build` (confirmed via `package.json` scripts + `ls -a` for biome/eslint/prettier configs, all absent).

[PATTERN] **Route-level (`+page.svelte`) spec needs the same store-boundary mocks as `store.spec.ts`.** Rendering `+page.svelte` under happy-dom pulls in `$lib/collectives/store` → `discover.ts` → `entu-config.ts` → `$env/dynamic/public`, which throws (`Cannot read properties of undefined (reading 'env')`) unmocked. Fix: `vi.mock('$lib/collectives/discover', ...)` + `vi.mock('$app/navigation', ...)` at the top of the page spec, then drive `authStore`/`collectiveState`/`selectedCollectiveDbStore`/`urlCollectiveDbStore` directly (all real exported writables) before `render()`. First `+page.svelte`-level spec in mvox-app — precedent for future page specs.

[GOTCHA] **Testing a requestId stale-guard needs a real value change, not a round-trip to the same value.** First attempt toggled `selectedCollectiveDbStore` to `null` then back to the same db, expecting two distinct effect runs — but the derived `selectedCollectiveStore`'s fallback-to-`list[0]` step returns the *same object reference* on the null pass (single-collective fixture), so Svelte's `$derived` doesn't re-fire the effect (no value change). Fixed by using two distinct collectives and switching between them — matches how the guard is actually exercised in production (user switches collective mid-fetch).

[DECISION] **Added 2 new i18n keys (`agenda_load_error`, `agenda_retry`) to all 4 locale files myself**, outside Byrd's normal write scope (Comenius owns `messages/*.json`) — team-lead's fix brief didn't loop Comenius into this review-response cycle, and `pnpm build` requires the keys to exist for `m.*()` calls to typecheck. et/lv/uk translations are my own draft quality, flagged to Comenius for a real pass (same caveat as the T5 GREEN's `agenda_gap_weeks` stub note).

[LEARNED] **Contrast fix mechanical rule confirmed:** on the `--color-paper` (#f7f1e1) sheet, `ink-3` (4.25:1) and `ink-4` (2.32:1) both fail AA 4.5:1 for small text — bump straight to `ink-2` (8.52:1), don't split hairs between ink-3/ink-2 case by case.

[LEARNED] **Branch at 745abd6 on feat/t5-agenda** — M2 (error+retry, requestId-guarded against stale rejects) + M4 (gap threshold 6→13 days) + paper-sheet wrap + M3 (4 contrast bumps) all GREEN. `pnpm check` 0 errors, `pnpm test` 118/118, `pnpm build` OK (`build/index.html` present). Handed to Bentham for re-review via team-lead.

## [CHECKPOINT] 2026-08-06 — #7 Fix B: reactive collective re-hydrate on auth flip (f4f199e)

[PATTERN] **`$effect` + store subscription, loop-safe edge-detection.** To react to a store transitioning INTO a specific state (not just any emission) without risking a feedback loop: (1) track the previous value in a PLAIN `let` variable, not `$state` — reading/writing a non-rune variable inside the effect doesn't register a dependency, so bookkeeping writes can't retrigger the same effect; (2) compare `prev` vs the new value read via the `$store` auto-subscription (which IS the tracked dependency) to detect the edge; (3) guard the resulting async call with an in-flight boolean flag. Used in `+layout.svelte` for "re-hydrate collectives whenever auth transitions into authenticated." Considered but rejected reading the downstream store's current value (`get(collectiveState)`) as an "already resolved" guard — it would also suppress the genuine anonymous→authenticated case the fix exists for, since `collectiveState` reads 'anonymous' (not 'loading') after any prior resolve.

[GOTCHA] **Testing an authStore transition needs a matching localStorage token, not just `authStore.set(...)`.** `hydrateCollectives()` checks BOTH `get(authStore).status === 'authenticated'` AND a real token via `getToken()` — setting `authStore` directly in a test without `setToken(...)` first makes it fall through to the anonymous branch (silent false-negative: assertions fail with "expected 'anonymous' to be 'ready'", easy to misread as an implementation bug when it's a test-setup gap). Pattern: `setToken('jwt-abc')` before `authStore.set({status:'authenticated',...})` whenever a test drives the store directly instead of going through `hydrateAuth()`.

[LEARNED] **Branch at f4f199e on feat/t5-agenda** — #7 Fix B done: `+layout.svelte`'s `onMount`-only collective hydration replaced with a reactive `$effect` (fires on first auth resolution + any later transition into 'authenticated'). New `src/routes/layout.reactive-auth.spec.ts`, 4 cases, all RED against the pre-fix onMount-only layout then GREEN. `pnpm check` 0, `pnpm test` 123/123, `pnpm build` OK. Pushed to origin. Awaiting Bentham re-verify of both #7 fixes (A+B) + final preview before merge.

[GOTCHA] **Shared-tree crossed-wires: team-lead's "hold, don't commit" landed AFTER I'd already committed+pushed.** Team-lead proposed a cleaner Fix B split (extract to a pure `syncCollectivesToAuth` store fn) and asked me to reply "checkout free" — but I'd already finished, committed (f4f199e), and pushed the original component-embedded version before that message arrived. Did NOT silently comply/pretend clean, did NOT unilaterally revert a pushed commit either — surfaced the actual git state (branch/log/origin) to both team-lead and Josquin and asked for a decision. Team-lead kept f4f199e as-is (Josquin agreed after reviewing it read-only, no working-tree change) — reverting working, tested, green code to chase a marginally-cleaner extraction was ceremony over substance. Lesson: in a single-shared-tree setup with async messaging, "hold" instructions can always cross with completed work — verify actual git state before agreeing to a premise ("is it really free?") rather than trusting the message's framing.

[LEARNED] **Branch at a9e8919 on feat/t5-agenda** — #7 follow-up: closed the sign-out gap Josquin found in f4f199e's review (effect fired on ->authenticated but not authenticated->anonymous, so client-side sign-out left collectiveState stale at 'ready'). Added a symmetric `becameAnonymous` edge, same guards. New test case in `layout.reactive-auth.spec.ts`, RED against f4f199e's effect then GREEN. `pnpm check` 0, `pnpm test` 124/124, `pnpm build` OK. Pushed. #7 (A+B, sign-out edge) fully closed pending Bentham.

## [CHECKPOINT] 2026-08-06 — #11+#12 GREEN: RsvpControl + agenda wiring (6e97e71 on feat/slice2-rsvp)

[GOTCHA] **`vi.mock(path, async (importOriginal) => ({ ...(await importOriginal()), override }))` does NOT avoid evaluating the real module's top-level imports.** Tallis's RED page.rsvp-wiring.spec.ts used this spread pattern to mock 2 of rsvpData.ts's exports while keeping the rest real — but `importOriginal()` still executes the entire real file top-to-bottom, including its `import { entuFetch } from '$lib/entu/request'` → `$env/dynamic/public`, which throws under happy-dom (same wall as discover.ts elsewhere in this app). Only surfaced once +page.svelte started actually importing rsvpData.ts at runtime (it didn't before GREEN — AgendaList.svelte's Props only had TYPE imports, erased at compile time, so nothing forced module evaluation pre-GREEN). Fix: full manual mock (no importOriginal), reimplementing any pure helper (`rsvpsByEventId`) inline instead of re-exporting the real one. Rule of thumb: if a module has ANY `$env`-touching import at its top level, `importOriginal()` inside its own mock factory is unsafe — full replacement is the only way to sever it.

[PATTERN] **Optimistic-write glue shape (ported from mvox_v4e_web's `handleRsvpChange`, tally dropped):** capture `before = state`; build `optimistic` as a spread-copy with the change applied; `state = optimistic` (reassign, not mutate, per Svelte 5 runes); dispatch the write; on success reconcile placeholder ids (only matters for create); on `.catch`, `state = before` (full revert, not a partial patch — simplest correct revert for a single-field local cache).

[LEARNED] **Branch at 6e97e71 on feat/slice2-rsvp** — Closes #11 (load own rsvps) + #12 (RsvpControl UI + optimistic write), on top of Comenius's i18n (c415fec) on Tallis's RED (b3a157f, 29 failing). `pnpm check` 0, `pnpm test` 188/188 (159 baseline + 29), `pnpm build` OK. NOT pushed (team-lead's instruction). Checkout free, handed to Bentham for #11+#12 review.

## [CHECKPOINT] 2026-08-06 — #15 GREEN: double-tap-stuck fix, per-event write queue (f10058d on fix/rsvp-double-tap)

[PATTERN] **Per-event queue replacing whole-map optimistic state = the general fix shape for "one item's write shouldn't touch another item's state."** `createRsvpChangeQueue({setOptimistic, setPending, reconcile, revert})` — all 4 callbacks take `(eventId, value)`, never the whole collection. The caller (+page.svelte) only ever does `{...current, [eventId]: value}` / `delete next[eventId]` inside each callback — structurally there's no way to accidentally snapshot-and-revert the WHOLE map (which was #15's root cause #2: a stale `before = rsvpByEventId` snapshot, captured at tap-time, clobbered a *different* concurrent event's later reconciliation when the failing event's `.catch` fired). Generalizes beyond RSVP: any "N independent optimistic items, each with its own async write" UI should use a per-key queue, not a single before/after snapshot of the whole collection.

[PATTERN] **"Disable the whole control while pending" beats coalescing for double-tap fixes.** PO's ruling (Mihkel, session same-day): a second tap on an in-flight item should be impossible at the UI layer (`disabled = pending.has(id)`), not silently coalesced into "latest wins after the first resolves." Simpler mental model for the user (immediate visual feedback: control locks, not a delayed surprise reconciliation) and simpler to verify (RsvpControl's existing `disabled` prop already gated all 4 buttons — this is a 1-token OR added to that expression: `memberId === null || pendingEventIds.has(item.id)`). Tallis actually wrote BOTH shapes as RED (013d454 coalescing, then 5f774eb rewrote it disable-shape in place) before I ever GREENed the first — cheap to redirect since no implementation existed yet.

[LEARNED] **Branch at f10058d on fix/rsvp-double-tap** — Closes #15. `rsvpChangeQueue.ts` implemented (8 tests), `AgendaList.svelte` row disabled widened to gate on `pendingEventIds`, `+page.svelte`'s `handleRsvpChange` reduced to a thin adapter (resolve cfg/personId/existing, hand off to `rsvpQueue.request()`) — the old inline optimistic-set/applyRsvpChange/whole-map-revert block deleted entirely, replaced by the queue's 4 per-event callbacks. `pnpm check` 0, `pnpm test` 199/199 (188+11), `pnpm build` OK. NOT pushed (team-lead handles push/merge). Checkout free, handed to Bentham.

## [CHECKPOINT] 2026-08-08 — #38, #42 i18n-leak fixes + #50 nav visuals (Byrd-3)

[LEARNED] **i18n-leak fix pattern, now done 3x (#38, #40, #42):** drop the error state's raw message, `console.error(detail)` at every catch site, template calls the message key with no params, key text goes generic in all 4 locales. Split-task version (#38: Byrd does en.json, Comenius does et/lv/uk) leaves `pnpm check` red until both land — Paraglide unions the `{param}` requirement across ALL locale files for the generated type, so one un-migrated locale keeps the old signature. Single-task version (#42: Byrd does all 4 locales in one commit) has no such gap. Prefer single-task when the brief allows it.

[PATTERN] **CSS `:has()` for a no-JS multi-variant static mockup.** For #50's nav visuals (3 candidates × 4 seat/growth combos), pre-authored all 4 variants per candidate as sibling `.frame[data-variant="x"]` elements, default `display:none`, then 4 rules like `body:has(#toggle1:checked):has(#toggle2:checked) .frame[data-variant="x"]{display:flex}` — one checkbox pair drives every candidate frame in sync, zero JS. Caught 2 specificity bugs this way worth remembering: (1) a bare `.rail{display:flex}` rule and the generic `.frame[data-variant]{display:flex}` rule have EQUAL specificity when both single-class — whichever is later in source wins regardless of matching, so a rule needed only when active must never also be declared unconditionally on the same element's own class; (2) `<details>`-based dropdown/sheet panels need `position:relative` on the `<details>` itself, not on an ancestor — `position:absolute; top:100%` inside `<summary>`'s sibling resolves against the nearest positioned ancestor, which silently becomes something two levels up if the details wrapper itself isn't the positioning context.

[GOTCHA] **Claude-in-chrome can't reach inside a published Artifact's content.** `read_page`/`find`/scroll/click all no-op or return only the outer claude.ai chrome — the artifact renders in a sandboxed iframe the automation tooling can't cross. One screenshot at initial scroll position is all you get; verify the rest via manual CSS audit + HTML tag-balance check (`python3 html.parser`) rather than fighting the tool. Also: this sandbox's Bash `localhost` isn't reachable by the browser extension either (different host) — don't bother spinning up a local preview server before publishing.

[LEARNED] **#50 outcome:** Mihkel picked A (bottom tabs, portrait) + C (spine rail, landscape) + B (top bar, desktop) — the spine rail was my own third-candidate pitch and got picked. Epic #49 decision 4 recorded; T5.2 (real nav shell build) brief pending from team-lead.

[DEFERRED] This scratchpad is 300+ lines, well over the 100-line house limit — needs a real prune pass (drop the fully-superseded CHORE/session-16-through-30 mechanics that are either landed-and-irrelevant or already generalized into later PATTERN entries). Didn't do it this session to stay focused on active work; flag for next natural lull.

(*MVOX:Byrd*)
