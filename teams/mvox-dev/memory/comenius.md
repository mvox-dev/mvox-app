# Comenius — i18n Specialist Scratchpad

Personal notes. Only Comenius writes here. Keep under 100 lines; prune stale entries.

Tags: `[DECISION]`, `[PATTERN]`, `[WIP]`, `[CHECKPOINT]`, `[DEFERRED]`, `[GOTCHA]`, `[CONVENTION]`, `[TRANSLATION]`

---

## Session MVOX-4 — #38 roster error i18n leak (2026-08-08)

[CHECKPOINT] Dropped `{message}` param from `roster_load_error` in et/lv/uk (en done by Byrd). Commit `d8bc5ce` on `fix/38-roster-error-i18n`. `pnpm check` 0 errors (needed `pnpm build` first to regen paraglide — recurring gotcha, already logged session 14). Roster spec 6/6 pass. Handed off to Bentham.

(*MVOX:Comenius*)

---

## Session 36 — About/Carus outreach i18n (2026-06-14)

[CHECKPOINT] Translated all 12 `about_*` keys into et/lv/uk. Commit `79d6523` on `feat/about-carus`. pnpm check: 0 errors / 8 pre-existing warnings. 4-locale parity confirmed. No TODO/Lorem residue. Handoff to Bentham sent.

[GOTCHA] Typographic close-quote `"` (U+201D) has byte value 0x22 = ASCII `"` — terminates a JSON string early. In `about_values_offer`, the phrase "honest by default" / locale equivalents must use `\"..\"` escaped ASCII quotes. Opening low-9 `„` (U+201E) is safe; the closing curly `"` is NOT.

[DECISION] `about_page_title` et: `mvox-ist` (elative) not `Meist`. `Meist` is reserved for `nav_menu_about`. Consistent with `landing_footer_link_about` et.

[DECISION] `about_marginalia` uk: `~ команда mvox` (noun before brand) — natural Ukrainian word order. et/lv keep brand last.

[DECISION] `about_story_body` uk: `бували` (imperfective past, recurrence) not `були` — signals this wasn't a one-off slip; adds candour to the misstep admission.

[DECISION] `about_contact` register: 2nd-pl formal imperative in all 3 locales (et `kirjutage` / lv `rakstiet` / uk `пишіть`) — matches offer-block formal register above it.

(*MVOX:Comenius*)

---

## Session 35 — Slice-3 invite & join i18n (2026-06-14)

[DEFERRED] **Next session: About page en/et/lv/uk copy.** `/about` route exists; `about_*` keys in all 4 locales since session 27. Likely new real copy for `about_mission_body`, `about_story_body`, `about_values_body` (currently Lorem ipsum). Wait for RED spec.

[CHECKPOINT] Reviewed Byrd's 16 stubs (invite_* + members_* + nav_tab_members) — commit `6d45b14`. Fixed 2 issues: et `invite_loading` noun form ("Kutse laadimine…"); uk `invite_expired` gender ("Це" not "Цей"). Gates: build OK · 0 errors · 1127 tests.

[CHECKPOINT] YELLOW re-spin commits `8b5ec86`. Fixed YELLOW-35.1 (members_invite_submitting register: et "Saatmine…" / uk "Надсилання…" verbal nouns; lv "Sūta…" kept) + YELLOW-35.2 (nav_tab_members differentiation: et "Haldus" / lv "Dalība" / uk "Членство" — all distinct from nav_tab_roster).

[DECISION] `nav_tab_members` et "Haldus" (Management) / lv "Dalība" (Membership) / uk "Членство" (Membership). Admin management tab distinct from singer roster tab. Chose shortest clear term per locale.

[GOTCHA] Byrd pre-translated all stubs this session — Comenius i18n phase is now quality-review + fixes, not translation from scratch. Pattern to expect going forward.

[GOTCHA] nav_tab_members/nav_tab_roster collision was pre-baked in Byrd's stubs — not caught until Bentham REVIEW. Flag nav-tab collision risk in next RED spec checklist.

[DECISION] `members_invite_submitting` register: in-flight button states use verbal noun (et -mine / uk -ння suffix) NOT 1st-sg verb. Consistent with `common_loading` pattern. 3rd-sg verb (lv "Sūta…") also acceptable — matches `common_loading` lv "Ielādē…".

[CONVENTION] i18n-key foresight note posted on #91: admin-approve flow needs `invite_apply_*` (singer side) + `members_application_*` (admin side) key families. Next RED spec should include these from the start.

(*MVOX:Comenius*)

---

## Session 33 — S33 sub-chain 3 + YELLOW-33.1 i18n (2026-06-13/14)

[CHECKPOINT] Added 2 keys (library_loading + library_load_error) on feat/s33-readability-conformance, commit `5d761cd`. pnpm check: 2 errors → 0. 993/993 tests pass.

[CHECKPOINT] Added 3 keys (page_roster_label / page_notices_label / page_settings_label) on chore/s33-yellows, commit `a4a4eac`. pnpm check: 3 errors → 0. 1018/1018 tests pass.

[DECISION] `library_loading` register: ellipsis-framed phrase matching `common_loading` pattern per locale — et passive present `laaditakse`, lv 3rd-person verb `ielādē`, uk verbal noun `завантаження`. Keeps visual loading indicator register consistent with the common key.

[DECISION] `page_*_label` eyebrows: short nominative noun phrases (no sentence, no verb). et/lv: native-root words preferred over loanwords for short eyebrow context (`Suhtlus`/`Saziņa` over `Kommunikatsioon`/`Komunikācija`). uk: institutional loanword `Комунікації` is standard. `page_settings_label` aligns with `page_settings_description` vocabulary per locale.

[CONVENTION] Terminology-consistency rule established (session 33): nav-tab value is canonical term for its feature area; page descriptions and labels must use the same noun in that locale. Documented in i18n-conventions.md. Fixed `page_settings_description` lv `preferences` → `iestatījumi` (commit `07191d5`).

(*MVOX:Comenius*)

---

## Session 33 — S33 sub-chain 1 i18n (2026-06-13)

[CHECKPOINT] Added 6 keys (nav_menu_about + page_coming_soon_* + page_*_description) across 4 locales. Commit `bc57ca1` on `feat/s33-navigation`. pnpm check: 0 errors / 8 pre-existing warnings. pnpm test:unit: 112 files, 956 tests — all pass. The 6 AvatarMenu failures resolved.

[DECISION] `nav_menu_about`: et `Meist` / lv `Par mums` / uk `Про нас` — "About us" short form. Different from `landing_footer_link_about` which uses full "About mvox" phrasing. Menu context warrants shorter label.

[DECISION] `page_coming_soon_label` ("Coming soon"): et `Peagi tulemas` (matches badge vocab PEAGI+TULEMAS); lv `Drīzumā` (single word, no redundant compound); uk `Незабаром` (already covers COMING+SOON badges).

[DECISION] `page_coming_soon_back_to_agenda`: et `Tagasi kava juurde` (allative); lv `Atpakaļ uz programmu` (acc.); uk `Назад до програми` (gen.). Standard back-link patterns per locale.

[CONVENTION] `page_*_description` keys (roster/notices/settings): full real translations, no TODO markers. Simple noun phrases + description sentences, no date-specific content. Register: informal 2nd-sg (et) / formal-pl (lv/uk) per established patterns.

(*MVOX:Comenius*)

---

## Session 31 — #8 rsvp i18n Task 1 (2026-06-12)

[CHECKPOINT] Added 6 `rsvp_*` keys across 4 locales. Commit `ff77b97` on `feat/rsvp-singer`. `pnpm check` 0 errors, 8 pre-existing warnings. Reused the `comenius-agenda-i18n` worktree (checked out `feat/rsvp-singer` there — branch switch works cleanly in existing worktree with `node_modules` present).

[DECISION] `rsvp_late` disambiguation: must read as "coming but will arrive late" NOT "too late to RSVP". Solutions per locale: et `"Tulen hilja"` (1st-sg future + adverb `hilja`); lv `"Ar kavēšanos"` (with lateness — arrival-intent idiom); uk `"Запізнюся"` (1st-sg future of `запізнюватися` = to be late in arriving — unambiguously prospective).

[DECISION] `rsvp_going`/`rsvp_not_going`: et verb-form ("Tulen"/"Ei tule") mirrors Estonian button-label convention of using 1st-sg present; lv/uk future-of-бути ("Būšu"/"Nebūšu", "Буду"/"Не буду") — "I'll be there" idiom is the natural event confirmation in these locales.

(*MVOX:Comenius*)

---

## Session 31 — #10 agenda i18n Task 1 (2026-06-12)

[CHECKPOINT] Added 5 `agenda_*` keys across 4 locales. Commit `50dc92e` on `feat/agenda`. `pnpm check` 0 errors, 8 pre-existing warnings (in RehearsalEditForm.svelte — not i18n). Branch pushed as new remote.

[DECISION] `agenda_title`: et `Kava` / lv `Programma` / uk `Програма` — reuses nav tab values (already in locale files). Consistent across tab and page heading.

[DECISION] `agenda_duration_min`: en/et/lv all use `{minutes} min` — `min` is a universally legible abbreviation in these languages. Ukrainian uses `{minutes} хв` — standard Ukrainian minute abbreviation (`хвилина`).

[TRANSLATION] Empty-state register: et uses informal 2nd-sg (`Sa pole`) consistent with Estonian UI standard; lv formal plural (`Jūs vēl neesat`); uk formal 2nd-pl (`Ви ще не є`). Ask-admin CTA: et `Küsi ... kutset` (imperative sg + partitive); lv `Lūdziet uzaicinājumu savam kora administratoram`; uk `Зверніться до адміністратора хору за запрошенням`.

[CONVENTION] Worktree-install gotcha: fresh worktree has no `node_modules`; must run `pnpm install` before `pnpm build`. The `pnpm check` gate order still holds: build first, then check.

(*MVOX:Comenius*)

---

## Session 30 — #87 rehearsal edit form i18n (2026-06-01)

[CHECKPOINT] Added 1 new key `seasons_form_rehearsal_edit_heading` across 4 locales. Commit `da4e6be` on `feat/seasons-edit-rehearsal`. 5 other needed keys already existed — reused without modification. `pnpm check` 0 errors, 0 warnings. Logged reuse decision in `i18n-conventions.md`.

[DECISION] `seasons_form_season_save` ("Save changes") reused as the save control for rehearsal edit form. Canonical for all seasons-group edit forms — no sibling `seasons_form_rehearsal_save` key needed.

(*MVOX:Comenius*)

---

## Session 27 — CHORE-72 /about page i18n (2026-05-31)

[CHECKPOINT] Added 9 `about_*` keys across 4 locale files. Commits `a8d0bc1` (initial) + `7cd3480` (dedupe fix) on `chore/about-page`.

[GOTCHA] Pre-commit-msg hook auto-stages ALL modified tracked files — not just what you `git add`. In this session it pulled in Byrd's in-progress `+page.svelte` (which referenced the old `about_tagline` key) into my i18n commit. Lesson: if another agent has uncommitted work in the tree, coordinate timing. The hook cannot be bypassed without `--no-verify`.

[GOTCHA] Duplicate-key JSON: when two agents commit to the same branch in a race, append-style JSON edits can produce duplicate keys in the same file. `jq` silently resolves to last-occurrence-wins, masking the problem in tooling. Always verify with `jq 'to_entries[]|select(…)|.key' | sort | uniq -d` (empty output = no dups).

[DECISION] Key set for CHORE-72: `about_page_title`, `about_intro`, `about_mission_heading`, `about_mission_body`, `about_story_heading`, `about_story_body`, `about_values_heading`, `about_values_body`, `about_marginalia`. NO `about_tagline` (was in old spec; renamed to `about_intro` at commit 9815c2c).

[CONVENTION] TODO marker form confirmed: `TODO: <en value>` — prefix on the full English string. Applies to all non-en locales for new keys pending translation.

(*MVOX:Comenius*)

---

## Session 24 — CHORE-67 plural fix (2026-05-24)

[GOTCHA] `@inlang/plugin-message-format@2.2.0` does NOT support ICU plural syntax. Any `{n, plural, one {...} other {...}}` block is compiled as a literal param name — produces `params['n, plural, one {1 work']` in output. README says "Plurals... currently not supported, but planned." Use plain `{n}` templates until the plugin adds plural support. Commit `7cfb7b3`.

[DEFERRED] True grammatical plurals for `library_master_count` (et "1 teos / 3 teost", lv "1 darbs / 3 darbi", uk "1 твір / 3 твори / 5 творів"). Blocked on plugin support. Accept "{n} works/teost/darbi/творів" for all n until fixed. Filed in `i18n-conventions.md`.

(*MVOX:Comenius*)

---

## Session 24 — CHORE-67 Task 3 i18n keys (2026-05-24)

[CHECKPOINT] Added 11 new library_* keys (master-detail catalog UI) across 4 locales. Commit `c02063b` on `chore/library-real-data`. 65 unit test files pass, 474 tests pass. Playwright E2E failures are pre-existing (no test server), not caused by i18n changes.

[DECISION] `library_master_count` Ukrainian uses three-way plural rule (one/few/other) → `{n, plural, one {1 твір} few {{n} твори} other {{n} творів}}`. Estonian uses standard SvelteKit/Paraglide two-way (one/other) → `{n, plural, one {1 teos} other {{n} teost}}`.

[TRANSLATION] New field-level keys:
- `library_field_voicing`: et `Häälestus` / lv `Balsu sadalījums` / uk `Голосовий склад`
- `library_field_language`: et `Keel` / lv `Valoda` / uk `Мова`
- `library_work_eyebrow_in_view`: et `vaates` / lv `skatā` / uk `у перегляді`
- `library_work_eyebrow_metadata`: et `Andmed` / lv `Metadati` / uk `Метадані`

[DECISION] `library_empty_marginalia` — full translation (no TODO marker). Simple noun-phrase structure in all locales; no date-specific copy unlike `library_overdue_marginalia`. Pattern confirmed: TODO markers only for strings with literal dates/contact details needing PO input.

(*MVOX:Comenius*)

---

## Session 22 — CHORE-62 + CHORE-66 i18n keys (2026-05-24)

[CHECKPOINT] Added 6 nav_tab_* + nav_chip_librarian keys (a439228) and 2 nav_org_picker_* keys (1c9e5da) across 4 locales. All on separate branches; per-commit-GREEN gate verified each time.

[CONVENTION] New env-var branch guard: `MVOX_EXPECTED_BRANCH=<branch> git commit ...` — pre-commit hook enforces branch intent. No `.git/EXPECTED_BRANCH` file needed (superseded by env var, hook at `8a42302`).

[PATTERN] Gate order for keys-only commits: `pnpm build` first (regenerates paraglide), then `pnpm check`, `pnpm test:unit`, `pnpm lint`. Build must precede check or check fails on missing generated types.

(*MVOX:Comenius*)

---

## Session 21 — CHORE-60 i18n ship (2026-05-24)

[CHECKPOINT] Completed Tasks 30, YELLOW-A, YELLOW-D for CHORE-60 feat/library-page-ui-kit branch.

[DECISION] Task 30 (f6247af): Added 60 keys across 4 locales — library_*, auth_login_*, auth_provider_*, auth_logout_*. Updated auth_login_heading "Sign in to mvox" → "Welcome back". 1 TODO marker per non-en locale on library_overdue_marginalia (date-specific copy, needs PO input).

[DECISION] YELLOW-A (615a7e0): Wired 28 m.*() substitutions into /library/+page.svelte. Gotcha: `{@const}` invalid outside {#if}/{#each} blocks in Svelte 5 — must declare derived vars in <script> block instead.

[DECISION] YELLOW-D (0aa63d8): Added 4 *_unit keys (owned_unit, available_unit, on_loan_unit, overdue_unit) in all 4 locales. Pattern: when colored `<span>` wrappers around numbers need to survive i18n wiring, split parameterized key into separate unit-label key. Parameterized originals left in place (unused but harmless). No TODOs — unit strings directly derived from parameterized values.

[GOTCHA] `{@const}` placement: Svelte 5 only allows `{@const}` as immediate child of `{#snippet}`, `{#if}`, `{:else}`, `{#each}`, `{:then}`, `{:catch}`, `<svelte:fragment>`, `<svelte:boundary>`, or `<Component>`. NOT inside plain `<div>` or other HTML elements. Move splits/derives to `<script>` block.

(*MVOX:Comenius*)

## Session 14 — #37 i18n landing gap (2026-05-22)

[CHECKPOINT] Completed i18n phase for #37 (hardcoded "members/section" replacement). Commit `69f6ee6` on `chore/37-i18n-landing-members-per-section`. Ready for Bentham REVIEW.

[DECISION] Key name: `landing_members_per_section`. Parameterized with `{count}`. No pluralization variants — `count` can be a decimal average (e.g., 4.5), so full noun declension by number would be wrong. Partitive/genitive forms used for all locales work correctly regardless of numeric value.

[TRANSLATION] Translations:
- en: `{count} members/section`
- et: `{count} liiget häälerühmas` — `liiget` = members (partitive, works with all numbers); `häälerühmas` = in the voice group (choral term for section)
- lv: `{count} locekļi katrā sekcijā` — `locekļi` = members (nom. pl.); `katrā sekcijā` = in each section
- uk: `{count} учасників на секцію` — `учасників` = participants (gen. pl., standard with numeric count); `на секцію` = per section

[GOTCHA] `pnpm check` fails after adding new message keys if `src/lib/paraglide/` has not been regenerated. Must run `vite build` (or `pnpm build`) first to trigger Paraglide plugin regen before running `pnpm check`. No standalone `build:i18n` script exists; regen only happens via Vite. Logged for future i18n tasks.

(*MVOX:Comenius*)

## Session 14 — CHORE-41 i18n phase (2026-05-22)

[CHECKPOINT] Completed i18n phase for #41 (Real OAuth wiring). Commit `32e837f` on `feat/oauth-wiring`. Handed off to team-lead for Bentham REVIEW routing.

[DECISION] 5 OAuth auth flow keys translated (et/lv/uk). Placeholder translations were drafted against an older English version; updated to match Byrd's final copy. Key changes: added "Please try again." to `auth_callback_failed`; added "Redirecting…" phrase to `auth_callback_success`; introduced "security check" concept + "start again" in `auth_error_csrf_mismatch`; softened `auth_error_missing_session_token` from "no token received" to "did not complete".

[CONVENTION] "Start again" vs "try again" distinction: CSRF error uses `alusta uuesti`/`sāciet no jauna`/`почніть знову` — implies full flow restart, not just button retry. Logged in `i18n-conventions.md`.

(*MVOX:Comenius*)

---

## Session 13 — CHORE-35 i18n phase (2026-05-22)

[CHECKPOINT] Completed i18n phase for #35 (frontend scaffolding). Commit `98eaa33` on `feat/frontend-scaffolding-mvp`. Handed off to team-lead for Bentham REVIEW routing.

[DECISION] Translated all 10 new keys for landing + nav + login into et/lv/uk. Improved two English stubs: `landing_retry_button` → "Try again" (from "Retry"); `landing_error_state` → added "Try again." suffix for inline actionability.

[CONVENTION] Vocabulary anchored for choir domain: choir = `koor`/`koris`/`хор`; Sign in = `Logi sisse`/`Pierakstīties`/`Увійти`; Sign out = `Logi välja`/`Izrakstīties`/`Вийти`; OAuth CTA = imperative (et) / formal infinitive (lv/uk). All logged in `i18n-conventions.md`.

[GOTCHA] Pre-existing Tailwind color test (`tests/tailwind.spec.ts:22`) was failing before i18n work. Confirmed by stash+rerun. Not a Comenius concern — flag to Tallis if it resurfaces in review.

(*MVOX:Comenius*)

---

## Session 10 — CHORE-3 AC research (2026-05-21)

[CHECKPOINT] First real Comenius session. Delivered gitignore-vs-commit AC recommendation to team-lead via SendMessage.

### Findings

[DECISION] `src/lib/paraglide/` should be **gitignored**, not committed.

Key evidence:
- Paraglide compiler option `emitGitIgnore` defaults to `true` — it auto-writes a `.gitignore` inside the output dir on every compile. Committing the output requires explicitly overriding this with `emitGitIgnore: false`, which goes against Paraglide's own intent.
- The `paraglideVitePlugin` (used in `vite.config.ts`) regenerates the output dir on every `pnpm dev` and `pnpm build`. Cloudflare Pages runs `pnpm build`, so CI is covered without a separate compile step.
- No drift risk: generated output always reflects current `messages/*.json`.
- Zero PR noise: generated TS never appears in diffs.

`.gitignore` line to add:
```
src/lib/paraglide/
```

[GOTCHA] `pnpm check` (`svelte-check`) runs outside Vite and needs the generated types to exist. In a fresh CI checkout with no prior build, `pnpm check` will fail if `src/lib/paraglide/` is absent. Fix: ensure `pnpm build` runs before `pnpm check` in CI, OR add a `postinstall`/`prepare` script that runs `paraglide-js compile`. Deferred to CHORE-3 implementation — Tallis should verify how CI is structured before adding the hook.

[DEFERRED] Second-order questions sent to team-lead for resolution at CHORE-3 implementation time:
1. Does Cloudflare Pages CI run `pnpm check` separately or only `pnpm build`?
2. Exact package: `@inlang/paraglide-sveltekit` (per AC) vs `paraglideVitePlugin` from `@inlang/paraglide-js` — policy is the same either way.
3. Confirm `emitGitIgnore: false` is NOT set in the Vite config (default true reinforces the gitignore policy).

(*MVOX:Comenius*)
