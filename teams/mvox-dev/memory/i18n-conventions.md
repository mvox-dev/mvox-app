# mvox i18n Conventions

Steward: **Comenius**. All teammates read; only Comenius appends.

Canonical locale list: `en` (source), `et`, `lv`, `uk`. All 4 must stay in sync at all times.

---

## Plural Rule (IMPORTANT)

`@inlang/plugin-message-format` does NOT support ICU plural syntax (`{n, plural, one {...} other {...}}`). Plugin README explicitly states: "Advanced formatting such as Plurals... are currently not supported, but they are planned." Using ICU syntax produces broken compiled output — the whole block becomes a literal param name.

**Current rule: use plain `{n}` templates for all count-dependent strings.** Accept the grammatical imperfection at n=1 as a known limitation. When the plugin gains plural support, revisit.

For grammatically correct form across all n, prefer the form that degrades least at n=1:
- **et**: partitive plural (`teost`, `eksemplari`) — works correctly for all numeric values including 1
- **lv**: nominative plural (`darbi`, `eksemplāri`) — minor imperfection at n=1 ("1 darbi"), acceptable
- **uk**: genitive plural (`творів`, `учасників`) — standard with numeric count; grammatically expected with numbers

Example: `library_master_count` — `"{n} works"` / `"{n} teost"` / `"{n} darbi"` / `"{n} творів"` (commit `7cfb7b3`)

[DEFERRED] True per-locale plural variants (one/few/other) — blocked until plugin adds support.

(*MVOX:Comenius*)

---

## Eyebrow Label Pattern

Single-word noun-phrase eyebrow labels (collapsed/inactive state) use nominative singular — the simplest, most neutral noun form in each locale. No article, no case inflection beyond the base form.

Pattern: `library_*_eyebrow_inactive` (and similar single-concept state labels)
- **en**: nominative → `"Work"`
- **et**: nominative sg → `"Teos"` (not partitive `"Teost"` — that's for counted nouns)
- **lv**: nominative sg → `"Darbs"` (not gen.pl.)
- **uk**: nominative sg → `"Твір"` (not gen.pl. `"Творів"`)

Example: `library_work_eyebrow_inactive` (commit `89ff708`, YELLOW-67.2)

Contrast with `library_work_eyebrow_in_view` (active state) — contextual phrase, not a noun label.

(*MVOX:Comenius*)

---

## Naming Conventions

Keys are flat strings in `messages/{locale}.json`. No nesting.

### Group prefixes

| Prefix | Use for |
|---|---|
| `common_` | Generic UI concepts reused across features (loading, error, empty states) |
| `actions_` | Verb labels on buttons and interactive controls |
| `participation_` | RSVP, attendance, rehearsal presence |
| `repertoire_` | Works, editions, copies, scores |
| `materials_` | File uploads, attachments, documents |
| `roster_` | Members, sections, roles within an org |
| `events_` | Seasons, events, series, programmes (see note) |
| `seasons_` | Rehearsal-schedule feature sub-group (session 29+): season/series forms, conductor panel, rehearsal list, confirmations. Chosen over `events_` to match the `src/lib/seasons/` module name — first concrete slice of the `events_` domain. Future concert/programme keys will use `events_` or their own sub-group. |
| `org_` | Organisation-level settings, onboarding, admin |
| `auth_` | Login, logout, identity, invite flows |

Use `common_` not `shared_`. Use `actions_` not `btn_`. Use `roster_` not `event_members_`.

### Key construction

`<prefix>_<concept>[_<qualifier>]`

- `common_loading`, `common_error`, `common_empty`
- `actions_save`, `actions_cancel`, `actions_add`, `actions_edit`, `actions_delete`
- `events_create_title`, `events_create_submit`
- `roster_member_remove_confirm`

Keep qualifiers short. Avoid restating the prefix in the qualifier (`actions_save_action` → `actions_save`).

### Alphabetical sort

Keys within each JSON file are sorted **alphabetically** by key name. This is the canonical order. Do not group by feature inside the file — the prefix carries all grouping information needed.

---

## 4-Locale Parity Rule

Every key that exists in `messages/en.json` must exist in `messages/et.json`, `messages/lv.json`, and `messages/uk.json` with the same key name. Missing keys in any locale file = build error (Paraglide compiler fails loudly).

At handoff to Bentham: all 4 files must have identical key sets.

---

## Translation Philosophy

Translate **meaning and user intent**, not words. A Paraglide message is a UI affordance, not a dictionary entry. Prefer the natural phrasing a native speaker would use in that UI context.

- **Estonian**: direct and concise; formal register by default (app has institutional users — choir admins, conductors). `Salvesta` not `Salvestage` (imperative 2nd-person singular is standard for UI buttons in Estonian).
- **Latvian**: standard literary Latvian; formal. Infinitive form for button labels where natural (`Saglabāt`, `Atcelt`).
- **Ukrainian**: standard Ukrainian (not surzhyk); formal register. Infinitive for button labels (`Зберегти`, `Скасувати`).

### Music-domain terminology

Choral-music terms that have no idiomatic translation should stay in English (or use the widely-understood loanword). Decision log below — append as new terms arise.

| Term | Policy | Rationale |
|---|---|---|
| choir | et: `koor`, lv: `koris`, uk: `хор` | Standard choral-community term in each language; not the more formal "ensemble" or "kollektiiv" |
| Sign in | et: `Logi sisse`, lv: `Pierakstīties`, uk: `Увійти` | Standard UI login verb per locale; consistent across nav + login page |
| Sign out | et: `Logi välja`, lv: `Izrakstīties`, uk: `Вийти` | Paired with Sign in convention |
| Continue with [brand] | et: `Jätka [brand]uga`, lv: `Turpināt ar [brand]`, uk: `Продовжити з [brand]` | OAuth CTA pattern — infinitive in lv/uk, imperative in et |

### Proper nouns and brand names

Brand names (`Multivox`, `Entu`) are never translated. Entity names entered by users (choir name, event title) are not in message files — they come from the database and are displayed as-is.

---

## Translation Decision Log

Append entries here when a non-obvious translation choice is made. Format: key, locale, chosen value, rationale.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `common_loading` | et | `Laadimine…` | Noun form (loading as a process); natural in Estonian UI contexts. `Laadin…` (verb) feels too conversational. |
| `common_error` | et | `Tekkis viga` | "An error occurred" — past tense; Estonian UI convention for error states. `Viga` alone is too bare. |
| `common_loading` | lv | `Ielādē…` | Verb form (3rd-person present); natural Latvian pattern for progress states. |
| `common_error` | lv | `Radās kļūda` | "An error arose" — past tense, standard Latvian UI error phrasing. |
| `common_loading` | uk | `Завантаження…` | Noun/verbal noun; standard Ukrainian UI loading indicator text. |
| `common_error` | uk | `Сталася помилка` | "An error occurred" — standard Ukrainian UI error phrasing, feminine agreement with `помилка`. |
| `landing_signed_out_headline` | et | `Laula koos, jaga muusikat` | Imperative 2nd-sg ("Sing together, share music"); direct and energetic, natural Estonian marketing tone. |
| `landing_signed_out_headline` | lv | `Dziediet kopā, dalieties ar mūziku` | Imperative 2nd-pl (formal); Latvian UI prefers formal plural for address. |
| `landing_signed_out_headline` | uk | `Співайте разом, діліться музикою` | Imperative 2nd-pl; standard Ukrainian informal-friendly register. |
| `landing_retry_button` | en | `Try again` | Changed from Byrd stub "Retry" — "Try again" is more conversational, mirrors `landing_error_state` phrasing. |
| `landing_error_state` | en | `Could not load your choirs. Try again.` | Added "Try again." hint to match retry button text and make the error actionable inline. |
| `auth_callback_success` | et | `Sisse logitud. Suunamine…` | "Redirecting" as `Suunamine` (verbal noun); brief for a transient screen. |
| `auth_callback_success` | lv | `Pierakstīšanās veiksmīga. Novirzīšana…` | `Novirzīšana` = redirecting (noun form); standard Latvian UI pattern. |
| `auth_callback_success` | uk | `Вхід виконано. Перенаправлення…` | `Перенаправлення` = redirecting (verbal noun); standard Ukrainian UI pattern. |
| `auth_error_csrf_mismatch` | et | `Sisselogimise turbekontroll ebaõnnestus. Palun alusta uuesti.` | `turbekontroll` = security check; `alusta uuesti` = start again (implies full flow restart, not just retry). |
| `auth_error_csrf_mismatch` | lv | `Pierakstīšanās drošības pārbaude neizdevās. Lūdzu, sāciet no jauna.` | `drošības pārbaude` = security check; `sāciet no jauna` = start again (formal plural). |
| `auth_error_csrf_mismatch` | uk | `Перевірка безпеки входу не вдалася. Будь ласка, почніть знову.` | `Перевірка безпеки` = security check; `почніть знову` = start again (imperative plural). |
| `auth_error_missing_session_token` | et | `Sisselogimine ei lõppenud. Palun proovi uuesti.` | `ei lõppenud` = did not complete; softer/less technical than "no token received". |
| `auth_error_missing_session_token` | lv | `Pierakstīšanās netika pabeigta. Lūdzu, mēģiniet vēlreiz.` | `netika pabeigta` = was not completed (past passive); matches English final-copy tone. |
| `auth_error_missing_session_token` | uk | `Вхід не завершено. Будь ласка, спробуйте ще раз.` | `не завершено` = was not completed (short passive); consistent with English final copy. |
| `landing_members_per_section` | et | `{count} liiget häälerühmas` | `liiget` = members (partitive, works for all numeric values incl. decimals); `häälerühmas` = in the voice group — choral term for section. No pluralization variants: count can be a decimal average. |
| `landing_members_per_section` | lv | `{count} locekļi katrā sekcijā` | `locekļi` = members (nom. pl.); `katrā sekcijā` = in each section. Nominative plural works for display counts. |
| `landing_members_per_section` | uk | `{count} учасників на секцію` | `учасників` = participants/members (gen. pl., standard with numeric count); `на секцію` = per section. |
| `auth_login_heading` | en | `Welcome back` | Updated from "Sign in to mvox" for redesigned login page. Friendlier re-entry tone; eyebrow carries the functional "Sign in" label. |
| `auth_login_heading` | et | `Tere tulemast tagasi` | Literal "Welcome back"; standard warm-return greeting in Estonian UI. |
| `auth_login_heading` | lv | `Laipni atpakaļ` | `Laipni` = graciously/welcome; `atpakaļ` = back. Standard Latvian welcome-back phrase. |
| `auth_login_heading` | uk | `З поверненням` | "With return" — standard Ukrainian welcome-back phrase. |
| `auth_logout_stamp` | et | `Välja logitud` | Past passive; mirrors `auth_callback_success` stamp pattern. |
| `auth_logout_stamp` | lv | `Atteicies` | Reflexive past; "has logged out" — standard Latvian session-end state label. |
| `auth_logout_stamp` | uk | `Вихід виконано` | "Exit performed" — past passive, matches tone of `auth_callback_success`. |
| `auth_provider_email_sub` | et | `maagiline link` | `maagiline` = magical; direct translation of "magic link". |
| `auth_provider_email_sub` | lv | `maģiskā saite` | `maģiskā` = magical (adj.); `saite` = link. Natural Latvian compound. |
| `auth_provider_email_sub` | uk | `магічне посилання` | `магічне` = magical; `посилання` = link. Standard Ukrainian tech phrasing. |
| `library_overdue_marginalia` | et/lv/uk | `TODO` markers | Free-text marginalia with a specific date ("31 May") — deferred for PO to supply locale-specific copy or confirm en passthrough. |

### New key group: `library_*` (added session 21)

Covers: `library_top_*`, `library_rehearsal_*`, `library_search_*`, `library_returns_*`, `library_overdue_*`, `library_pull_*`, `library_catalog_*`.

**Stamp keys** (`library_returns_stamp`, `library_overdue_stamp`, `library_pull_stamp`): uppercase in en; translated uppercase in et/lv/uk where natural ("SAABUNUD", "TAHTAEG ULETATUD", "SHANTTOPTEN" etc.) for visual stamp presentation.

**Parameterized keys in this group:** `library_rehearsal_in` ({time}, {countdown}), `library_returns_counted` ({n}), `library_returns_confirm` ({n}), `library_overdue_borrower_days` ({n}), `library_pull_pull_n` ({n}), `library_pull_request_line` ({date}), `library_catalog_works` ({n}), `library_catalog_owned` ({n}), `library_catalog_available` ({n}), `library_catalog_on_loan` ({n}), `library_catalog_overdue` ({n}).

### New key group: `library_master_*`, `library_field_*`, `library_work_*` (added session 24)

Master-detail catalog UI for `/library`. 11 keys across 4 locales. Commit `c02063b` on `chore/library-real-data`.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `library_field_voicing` | et | `Häälestus` | `häälestus` = voice/vocal setting; standard Estonian choral term for SATB etc. |
| `library_field_voicing` | lv | `Balsu sadalījums` | "voice distribution" — more descriptive than `vokalizācija`; natural Latvian choral terminology. |
| `library_field_voicing` | uk | `Голосовий склад` | "voice composition" — standard Ukrainian choral term. |
| `library_field_language` | et | `Keel` | Standard label for language field. |
| `library_field_language` | lv | `Valoda` | Standard Latvian for language. |
| `library_field_language` | uk | `Мова` | Standard Ukrainian for language. |
| `library_work_eyebrow_in_view` | et | `vaates` | Inessive case — "in the view"; concise secondary tag. |
| `library_work_eyebrow_in_view` | lv | `skatā` | Locative — "in view"; standard Latvian locative for visual-context labels. |
| `library_work_eyebrow_in_view` | uk | `у перегляді` | "in the review/view" — standard Ukrainian prepositional phrase. |
| `library_work_eyebrow_metadata` | et | `Andmed` | "Data" — concise; `Metaandmed` would be technically correct but too long for an eyebrow. |
| `library_work_eyebrow_metadata` | lv | `Metadati` | Direct loanword; natural in Latvian technical UI. |
| `library_work_eyebrow_metadata` | uk | `Метадані` | Standard Ukrainian technical term. |
| `library_master_count` | uk | three-way plural | `one {1 твір} few {{n} твори} other {{n} творів}` — Ukrainian requires one/few/other for accurate noun agreement. |

### New key group: `nav_tab_*` + `nav_chip_*` (added session 22)

Tab label keys for MvoxNav: `nav_tab_agenda`, `nav_tab_library`, `nav_tab_roster`, `nav_tab_notices`, `nav_tab_settings`, `nav_chip_librarian`.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `nav_tab_agenda` | et | `Kava` | Programme/agenda for choir context; `kava` is the standard Estonian term for a concert or rehearsal programme. |
| `nav_tab_agenda` | lv | `Programma` | Standard Latvian for programme/agenda in a music event context. |
| `nav_tab_agenda` | uk | `Програма` | Standard Ukrainian for programme/agenda. |
| `nav_tab_roster` | et | `Liikmed` | "Members" — direct translation of roster in choir context; `nimekiri` (list) is less natural for a nav tab. |
| `nav_tab_roster` | lv | `Dalībnieki` | "Participants/members" — standard for choir member lists in Latvian. |
| `nav_tab_roster` | uk | `Учасники` | "Participants/members" — standard for choir member lists in Ukrainian. |
| `nav_tab_notices` | et | `Teated` | "Notices/announcements" — concise and natural for a nav tab in Estonian. |
| `nav_tab_notices` | lv | `Paziņojumi` | "Notices/announcements" — standard Latvian UI term. |
| `nav_tab_notices` | uk | `Повідомлення` | "Notices/messages" — standard Ukrainian UI term. |
| `nav_tab_settings` | et | `Seaded` | "Settings" — standard Estonian UI term. |
| `nav_tab_settings` | lv | `Iestatījumi` | "Settings" — standard Latvian UI term. |
| `nav_tab_settings` | uk | `Налаштування` | "Settings" — standard Ukrainian UI term. |
| `nav_chip_librarian` | et | `RAAMATUKOGUHOIDJA` | Uppercase per visual chip presentation. Long but correct Estonian term. |
| `nav_chip_librarian` | lv | `BIBLIOTEKĀRS` | Uppercase; `bibliotekārs` = librarian in Latvian. |
| `nav_chip_librarian` | uk | `БІБЛІОТЕКАР` | Uppercase; standard Ukrainian term. |
| `nav_org_picker_placeholder` | et | `Organisatsioone pole` | "No organizations" — genitive plural (pole + gen.pl.); natural Estonian negative-existence phrasing. |
| `nav_org_picker_placeholder` | lv | `Nav organizāciju` | "No organizations" — `nav` (there isn't/aren't) + gen.pl.; standard Latvian negative-existence form. |
| `nav_org_picker_placeholder` | uk | `Немає організацій` | "No organizations" — `немає` + gen.pl.; standard Ukrainian negative-existence phrasing. |
| `nav_org_picker_switch_to` | et | `Lülitu: {orgName}` | "Switch: {orgName}" — imperative singular; colon separates verb from target; aria-label context. Shorter than "Lülitu organisatsioonile" without losing clarity. |
| `nav_org_picker_switch_to` | lv | `Pārslēgt uz {orgName}` | "Switch to {orgName}" — infinitive + `uz` (to/onto); standard Latvian action phrasing for aria-labels. |
| `nav_org_picker_switch_to` | uk | `Перейти до {orgName}` | "Go to {orgName}" — infinitive + `до` (to/into); natural Ukrainian aria-label for navigation-style selection. |

(*MVOX:Comenius*)

---

### Terminology consistency rule (added session 33, 2026-06-13)

When a nav-tab key establishes the canonical term for a feature area, all other keys in that feature area (page titles, descriptions, back-links) **must use the same term**. The tab is the primary entry point and sets user expectation.

- **lv "settings"**: canonical term is `iestatījumi` (from `nav_tab_settings`). Do NOT use `preferences` loanword in descriptions or labels — that creates terminology drift within the same interface.
- General check: before committing `page_*_description` or similar context keys, verify the noun form matches the corresponding `nav_tab_*` value in that locale.

(*MVOX:Comenius*)

---

### Naming rule: i18n keys are vocabulary-neutral (added session 24, 2026-05-31)

i18n message **keys** never carry vertical-specific vocabulary (no `choir`, `sing`, `orchestra`, etc. in key names). The **values** carry the vocabulary; the keys describe what slot the string fills semantically.

- ✓ `landing_hero_headline` — semantic, vertical-neutral
- ✗ `landing_hero_choir_headline` — vertical word in the key
- ✓ `pillar_roster_title` — describes the pillar slot
- ✗ `pillar_choir_members_title` — describes a choir-specific concept

**Why**: future verticals (orchestra, ensemble, etc.) will be implemented as net-new skin layers — sibling locale bundles that swap the message **values** without touching keys. Keys are the stable contract; values are the skinnable surface. See `architecture-decisions.md` → "Vertical-skin neutrality — domain vocabulary lives in i18n values, never in code (2026-05-31)" for the full rule, which also covers component / type / route / function names.

When authoring translations: don't preserve the source-language metaphor literally. The English value `"The back-of-house for your choir."` is a load-bearing piece of brand copy; the Estonian / Latvian / Ukrainian values are free to find the most idiomatic equivalent for their reader, not a word-for-word port.

(*MVOX:Palestrina, contributed for Comenius's stewardship*)

---

### New key group: `landing_*` (CHORE-72, added session 24, 2026-05-31)

Covers all landing page keys for the redesigned `/` route: `landing_hero_*`, `landing_pillars_*`, `landing_pillar_*`, `landing_invites_*`, `landing_request_*`, `landing_footer_*`, `landing_dashboard_*`.

**Deprecated and removed:** 7 scaffold-era keys (`landing_signed_out_headline`, `landing_signed_out_cta`, `landing_signed_in_heading`, `landing_empty_state`, `landing_error_state`, `landing_retry_button`, `landing_members_per_section`) removed from all 4 locale files. The old `+page.svelte` scaffold references were replaced with inline string literals (temporary: the page is rewritten in Task 15).

**First `_html`-suffix key:** `landing_invites_body_1_html` — contains `<strong>` tags rendered via `{@html}`. All translations preserve the `<strong>` tags verbatim. This is the project's first HTML-bearing i18n key. Convention: `_html` suffix = key value may contain safe, developer-authored HTML; Svelte templates use `{@html m.key()}`. Never use for user-generated content.

**`landing_dashboard_library_meta_ready` plural note:** `{worksCount} works · {copiesCount} copies · {overdueCount} overdue` — three plural-word gotchas per the no-ICU-plural rule. Static suffixes used in all locales:
- et: `{worksCount} teost · {copiesCount} eksemplari · {overdueCount} hilinenud` — partitive forms work for all n; "hilinenud" (overdue/delayed) is an adjective that doesn't inflect with count — grammatically clean.
- lv: `{worksCount} darbi · {copiesCount} eksemplāri · {overdueCount} nokavēti` — nom. pl.; minor imperfection at n=1 ("1 darbi"), accepted per convention.
- uk: `{worksCount} творів · {copiesCount} примірників · {overdueCount} прострочено` — gen. pl. for works/copies; "прострочено" (overdue, short passive) is invariant — grammatically comfortable with any count.

**"Back office" localization:** the English brand phrase "the back-of-house" / "back office" varies by locale:
- et: `tagakontor` (footer tagline, hero headline) — compound noun, natural Estonian; shorter than `tagatuba` (backroom). In marginalia context: `kontor` alone (concise for Caveat stamp).
- lv: `aizmugures birojs` — "back office" as two words; `birojs` (office) is the standard Latvian term.
- uk: `офіс` — "office"; the English "back-of-house" metaphor doesn't translate naturally; `офіс хору` (choir's office) in the tagline is more idiomatic.

**Stamp / badge uppercase note:** `landing_pillar_badge_*`, `landing_*_stamp`, `landing_dashboard_badge_soon` — all uppercase in source. Translations rendered uppercase where natural:
- `SHIPPED` → et: `VALMIS` (ready/done), lv: `PIEEJAMS` (available — "shipped" doesn't map cleanly; "pieejams" signals it's usable), uk: `ГОТОВО` (done/ready)
- `IN DEV` → et: `ARENDUSES`, lv: `IZSTRĀDĒ`, uk: `В РОЗРОБЦІ`
- `COMING` → et: `TULEMAS`, lv: `GAIDĀMS`, uk: `НЕЗАБАРОМ`
- `SOON` → et: `PEAGI`, lv: `DRĪZUMĀ`, uk: `НЕЗАБАРОМ`
- `INVITE ONLY` → et: `AINULT KUTSEGA`, lv: `TIKAI AR UZAICINĀJUMU`, uk: `ЛИШЕ ЗА ЗАПРОШЕННЯМ`
- `RECEIVED` → et: `SAADUD`, lv: `SANEMTS` (pre-existing diacritic-dropped form — matches `library_returns_stamp` pattern), uk: `ОТРИМАНО`

**`landing_hero_cta` ("Request an invite"):**
- et: `Taotle kutset` — imperative 2nd-sg + partitive; natural Estonian action phrase.
- lv: `Lūgt uzaicinājumu` — infinitive + accusative; standard Latvian CTA form.
- uk: `Надіслати запит на запрошення` — infinitive "send a request for an invite"; more natural than "запросити запрошення" (invite an invite — tautological).

**`landing_footer_link_about` ("About mvox"):**
- et: `mvox-ist` — elative case; Estonian "about" construction; concise.
- lv: `Par mvox` — standard Latvian "about" preposition.
- uk: `Про mvox` — standard Ukrainian "about" preposition.

**`landing_dashboard_eyebrow` + `landing_dashboard_greeting`:** reuse the `auth_login_heading` welcome-back register for consistency (et: `Tere tulemast tagasi`, lv: `Laipni atpakaļ`, uk: `З поверненням`). The greeting adds the name param: `{name}.` appended directly.

**`landing_invites_eyebrow` ("Getting in"):**
- et: `Sissesaamine` — verbal noun "getting in/entry"; concise, action-oriented.
- lv: `Kā pievienoties` — "How to join"; more natural than a direct noun translation for Latvian.
- uk: `Як потрапити` — "How to get in"; same pattern as lv, most natural for Ukrainian.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `landing_dashboard_marginalia` | et | `{org} · kontor` | `kontor` = office; shorter than `tagakontor` for Caveat marginalia context. |
| `landing_dashboard_marginalia` | lv | `{org} · birojs` | `birojs` = office; concise for marginalia. |
| `landing_dashboard_marginalia` | uk | `{org} · офіс` | `офіс` = office; the "back-of-house" metaphor doesn't translate; clean noun. |
| `landing_footer_tagline` | uk | `Офіс хору. Бібліотека…` | "Choir's office" vs literal "back-of-house" — more idiomatic Ukrainian. |
| `landing_hero_headline` | et | `Koori tagakontor.` | "Choir's back office" — `tagakontor` is the established compound. |
| `landing_hero_headline` | lv | `Kora aizmugures birojs.` | "Choir's back office" — two-word Latvian compound. |
| `landing_hero_headline` | uk | `Офіс вашого хору.` | "Your choir's office" — possessive form feels more personal in Ukrainian. |
| `landing_pillar_badge_shipped` | lv | `PIEEJAMS` | "SHIPPED" has no clean Latvian equivalent; `PIEEJAMS` (available/accessible) communicates the same user-facing meaning (it works, you can use it). |
| `landing_invites_body_1_html` | all | `<strong>` preserved | HTML tags preserved verbatim in et/lv/uk per `_html`-suffix convention. |
| `landing_dashboard_library_meta_ready` | uk | `{overdueCount} прострочено` | `прострочено` is a short passive form invariant across counts — avoids the one/few/other split that ICU plurals would need. |
| `landing_pillars_heading` | et | `Mida sisaldab` | "What's inside" — verb-last Estonian construction; natural. |
| `landing_pillars_heading` | lv | `Kas iekšā` | "What's inside" — elliptical Latvian construction; natural for a heading. |
| `landing_pillars_heading` | uk | `Що всередині` | "What's inside" — standard Ukrainian heading form. |

### New key group: `nav_signed_in_as` + `nav_user_menu_aria` (CHORE-75, added session 25, 2026-05-31)

Two utility/a11y keys for the avatar dropdown menu. Both neutral register, no brand voice.

**`nav_signed_in_as`** — eyebrow label above the user name in the dropdown panel. Short noun phrase, label-register (not a sentence).
- et: `Sisse logitud` — past-passive noun phrase ("logged in"); dropping "as" is natural for Estonian eyebrow context; the name line immediately below supplies the referent.
- lv: `Pieslēdzies kā` — "signed in as"; reflexive perfect + `kā` (as); standard Latvian UI phrasing for session-state indicators.
- uk: `Увійшли як` — "signed in as"; 2nd-person plural (`увійшли`) + `як` (as); polite standard Ukrainian for session-state labels.

**`nav_user_menu_aria`** — aria-label on the trigger button; functional, screen-reader-only. Pure noun phrase.
- et: `Kasutaja menüü` — "user menu"; genitive compound; direct and unambiguous.
- lv: `Lietotāja izvēlne` — "user's menu"; genitive + `izvēlne` (menu); standard Latvian accessibility label pattern.
- uk: `Меню користувача` — "menu of the user"; noun + genitive; standard Ukrainian accessibility label form.

**Register note:** `nav_signed_in_as` is a visible eyebrow (UI copy); `nav_user_menu_aria` is aria-only (never displayed). Both are utility copy — no brand voice, no tagline register.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `nav_signed_in_as` | et | `Sisse logitud` | Past-passive label; "as" dropped — eyebrow context + name below makes referent clear. |
| `nav_signed_in_as` | lv | `Pieslēdzies kā` | Reflexive perfect + `kā`; natural Latvian session-state indicator. |
| `nav_signed_in_as` | uk | `Увійшли як` | 2nd-pl polite + `як`; standard Ukrainian for session-state labels. |
| `nav_user_menu_aria` | et | `Kasutaja menüü` | Genitive compound; direct aria-label. |
| `nav_user_menu_aria` | lv | `Lietotāja izvēlne` | Genitive + `izvēlne` (menu); standard Latvian a11y label. |
| `nav_user_menu_aria` | uk | `Меню користувача` | Noun + genitive; standard Ukrainian a11y label form. |

(*MVOX:Comenius*)

---

### New key: `seasons_form_rehearsal_edit_heading` (#87, session 30, 2026-06-01)

Single new key added for the rehearsal inline edit form heading. All other needed strings already existed and were reused:

- `seasons_field_duration`, `seasons_field_location`, `seasons_field_description` — field labels reused as-is
- `seasons_form_season_save` ("Save changes") — reused for the save button in the rehearsal edit form; the value is generic enough to cover any "save changes" action (season or rehearsal)
- `actions_cancel` ("Cancel") — reused for close-without-saving; no seasons-specific cancel key needed

**[CONVENTION]** `seasons_form_season_save` is the canonical "Save changes" key for any seasons-sub-group edit form. Do NOT add a `seasons_form_rehearsal_save` sibling — the value is form-agnostic.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `seasons_form_rehearsal_edit_heading` | et | `Muuda proovi` | verb `muuda` (imperative/inf.) + partitive object `proovi`; mirrors `seasons_form_season_edit_heading` pattern (`Muuda hooaega`). |
| `seasons_form_rehearsal_edit_heading` | lv | `Rediģēt mēģinājumu` | infinitive + accusative; direct parallel to `Rediģēt sezonu`. |
| `seasons_form_rehearsal_edit_heading` | uk | `Редагувати репетицію` | infinitive + accusative; direct parallel to `Редагувати сезон`. |

(*MVOX:Comenius*)

---

### New key group: `agenda_*` (#10, Task 1, session 31, 2026-06-12)

5 keys for the `/agenda` unified singer view. Commit `50dc92e` on `feat/agenda`.

**`agenda_title`**: reuses the existing nav-tab values (`Kava` / `Programma` / `Програма`) — page heading and tab should match; no new translation needed.

**`agenda_duration_min`**: en/et/lv use `{minutes} min`; uk uses `{minutes} хв`. The abbreviation `хв` (хвилина) is standard in Ukrainian UI contexts; `min` is an accepted loanword but `хв` is more idiomatic.

**`agenda_empty_no_orgs`**: empty state when user has no orgs. Register: et informal 2nd-sg (`Sa pole ... Küsi`), lv formal plural (`Jūs vēl neesat ... Lūdziet`), uk formal 2nd-pl (`Ви ще не є ... Зверніться`). Matches each locale's established UI register (see auth keys for precedent).

**`agenda_empty_no_rehearsals`**: et `Tulevasi proove pole` — adj. `tulevasi` (upcoming, adj.pl.) + `proove` (rehearsals, partitive pl.) + `pole` (there aren't); lv `Nav gaidāmo mēģinājumu` — `gaidāmo` (expected/awaited, gen.pl.); uk `Немає запланованих репетицій` — `запланованих` (scheduled, gen.pl.) + `репетицій` (rehearsals, gen.pl.).

**`agenda_partial_error`**: et `Proovide laadimine ebaõnnestus: {orgs}` (verbal-noun pattern); lv `Neizdevās ielādēt mēģinājumus: {orgs}` (verb-first past tense, acc.pl. object); uk `Не вдалося завантажити репетиції для: {orgs}` (impersonal past + infinitive, acc.pl. object; `для:` for `for:`).

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `agenda_duration_min` | uk | `{minutes} хв` | Standard Ukrainian abbreviation; `min` accepted but `хв` more idiomatic. |
| `agenda_empty_no_orgs` | et | `Sa pole veel ühegi koori liige. Küsi oma koori administraatorilt kutset.` | Informal 2nd-sg; `administraatorilt kutset` = ask admin for an invite (elative + partitive). |
| `agenda_empty_no_orgs` | lv | `Jūs vēl neesat nevienā korī. Lūdziet uzaicinājumu savam kora administratoram.` | Formal plural; `Lūdziet` imperative pl.; `savam kora administratoram` = your choir's admin (dative). |
| `agenda_empty_no_orgs` | uk | `Ви ще не є членом жодного хору. Зверніться до адміністратора хору за запрошенням.` | Formal 2nd-pl; `Зверніться` = contact/turn to (imperative pl.); `за запрошенням` = for an invite (instrumental). |
| `agenda_empty_no_rehearsals` | et | `Tulevasi proove pole.` | `tulevasi` (upcoming, adj.); partitive plural `proove`; `pole` (neg. existential). |
| `agenda_empty_no_rehearsals` | lv | `Nav gaidāmo mēģinājumu.` | `gaidāmo` (awaited/expected, gen.pl.); `Nav` neg. existential. |
| `agenda_empty_no_rehearsals` | uk | `Немає запланованих репетицій.` | `запланованих` (scheduled, gen.pl.adj.); `репетицій` (rehearsals, gen.pl.); `Немає` neg. existential. |
| `agenda_partial_error` | et | `Proovide laadimine ebaõnnestus: {orgs}` | Verbal-noun structure; `proovide laadimine` = loading of rehearsals. |
| `agenda_partial_error` | lv | `Neizdevās ielādēt mēģinājumus: {orgs}` | Verb-first (impersonal past); `mēģinājumus` acc.pl. object. |
| `agenda_partial_error` | uk | `Не вдалося завантажити репетиції для: {orgs}` | Impersonal past + infinitive; `репетиції` acc.pl.; `для:` mirrors English `for:`. |

(*MVOX:Comenius*)

---

### New key group: `rsvp_*` (#8, Task 1, session 31, 2026-06-12)

6 keys for the 4-state RSVP control. Commit `ff77b97` on `feat/rsvp-singer`.

**Key `rsvp_late` — disambiguation critical.** Must read as "I'm coming but will arrive late" (forward attendance intent), NOT "the RSVP window has closed". Solutions chosen:
- et: `"Tulen hilja"` — 1st-sg present `tulen` (I come/will come) + adverb `hilja` (late). The subject "I" + verb makes it personal intent. `hilja` as standalone would be opaque; the verb makes the meaning unambiguous.
- lv: `"Ar kavēšanos"` — "with lateness/delay". Standard Latvian idiom for announcing one's late arrival. `kavēšanās` = lateness/delay; `ar` = with. Short and natural for a button.
- uk: `"Запізнюся"` — 1st-sg future of `запізнюватися` (to arrive late). Inherently prospective — means "I will be late [in arriving]". Cannot be read as a past-deadline notice.

**`rsvp_going`/`rsvp_not_going` register:** et uses 1st-sg present verb form (`Tulen`/`Ei tule` — "I come"/"I'm not coming"), consistent with Estonian button-label convention; lv/uk use future of "to be" (`Būšu`/`Nebūšu`, `Буду`/`Не буду` — "I'll be there"/"I won't be there") — the natural event-attendance idiom in those locales.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `rsvp_going` | et | `Tulen` | 1st-sg present "I come/am coming"; Estonian RSVP confirmation. |
| `rsvp_going` | lv | `Būšu` | 1st-sg future of `būt` "I'll be there"; natural Latvian event confirmation. |
| `rsvp_going` | uk | `Буду` | 1st-sg future of `бути` "I'll be there"; natural Ukrainian event confirmation. |
| `rsvp_not_going` | et | `Ei tule` | Negated 1st-sg "I'm not coming"; direct pair of `Tulen`. |
| `rsvp_not_going` | lv | `Nebūšu` | Neg. future "I won't be there"; direct pair of `Būšu`. |
| `rsvp_not_going` | uk | `Не буду` | Neg. future "I won't be there"; direct pair of `Буду`. |
| `rsvp_late` | et | `Tulen hilja` | 1st-sg verb + adverb; unambiguously personal arrival-intent. |
| `rsvp_late` | lv | `Ar kavēšanos` | "With lateness" — arrival-intent idiom in Latvian. |
| `rsvp_late` | uk | `Запізнюся` | 1st-sg future of `запізнюватися`; prospective by grammar. |
| `rsvp_maybe` | et | `Võib-olla` | Standard Estonian "maybe". |
| `rsvp_maybe` | lv | `Varbūt` | Standard Latvian "maybe". |
| `rsvp_maybe` | uk | `Можливо` | Standard Ukrainian "maybe". |
| `rsvp_not_member` | et | `Sa pole selle koori liige — RSVP pole saadaval.` | Informal 2nd-sg, matches agenda register. |
| `rsvp_not_member` | lv | `Jūs neesat šī kora loceklis — RSVP nav pieejams.` | Formal plural; `loceklis` = member (masc.sg.nom.); `nav pieejams` = unavailable. |
| `rsvp_not_member` | uk | `Ви не є членом цього хору — RSVP недоступний.` | Formal 2nd-pl; `недоступний` = unavailable (adj. masc. agreeing with `RSVP`). |
| `rsvp_error` | et | `RSVP salvestamine ebaõnnestus. Palun proovi uuesti.` | Verbal-noun pattern for error (matches `agenda_partial_error` style). |
| `rsvp_error` | lv | `Neizdevās saglabāt RSVP. Lūdzu, mēģiniet vēlreiz.` | Verb-first impersonal past; matches `auth_callback_failed` style. |
| `rsvp_error` | uk | `Не вдалося зберегти RSVP. Будь ласка, спробуйте ще раз.` | Impersonal past + infinitive; matches existing error patterns. |

(*MVOX:Comenius*)

---

### New key group: `nav_menu_*` + `page_*` (S33 sub-chain 1, session 33, 2026-06-13)

6 keys for avatar menu "About" link and placeholder coming-soon pages. Commit `bc57ca1` on `feat/s33-navigation`.

**`nav_menu_about`** — plain "About" nav menu item linking to `/about`. Distinguished from `landing_footer_link_about` ("About mvox" full phrase) by context: the dropdown menu is tighter, "About" alone is the natural label.
- et: `Meist` — "About us"; standard Estonian product nav label; shorter than `Teave mvox-i kohta`.
- lv: `Par mums` — "About us"; standard Latvian dropdown label; `Par mvox` reserved for the footer where the brand name clarifies context.
- uk: `Про нас` — "About us"; standard Ukrainian nav label.

**`page_coming_soon_label`** — eyebrow label on placeholder pages ("Coming soon").
- et: `Peagi tulemas` — combines `PEAGI` (soon) + `TULEMAS` (coming); matches badge vocabulary; two-word phrase natural for an eyebrow.
- lv: `Drīzumā` — "soon/coming soon"; single word covers the meaning; more natural than `Gaidāms drīzumā` (redundant).
- uk: `Незабаром` — standard Ukrainian "coming soon"; already used for both `COMING` + `SOON` badges.

**`page_coming_soon_back_to_agenda`** — back-link on placeholder pages ("Back to Agenda").
- et: `Tagasi kava juurde` — "back to the agenda" (allative `juurde`); natural Estonian back-link phrasing.
- lv: `Atpakaļ uz programmu` — "back to programme" (accusative `programmu` after `uz`); standard Latvian back-link.
- uk: `Назад до програми` — "back to programme" (genitive `програми` after `до`); standard Ukrainian back-link.

**`page_roster_description`, `page_notices_description`, `page_settings_description`** — one-line descriptions on placeholder pages. Full translations — no TODO markers. Register: informal 2nd-sg (et) / formal-pl (lv/uk), matching established patterns.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `nav_menu_about` | et | `Meist` | "About us" elative; standard Estonian product nav label. |
| `nav_menu_about` | lv | `Par mums` | "About us"; standard Latvian dropdown (footer gets `Par mvox`). |
| `nav_menu_about` | uk | `Про нас` | "About us"; standard Ukrainian nav label. |
| `page_coming_soon_label` | et | `Peagi tulemas` | "Coming soon" two-word phrase; matches badge vocab (`PEAGI`+`TULEMAS`). |
| `page_coming_soon_label` | lv | `Drīzumā` | Single word covers "coming soon"; avoids redundant compound. |
| `page_coming_soon_label` | uk | `Незабаром` | Standard Ukrainian "coming soon"; already used for `COMING`+`SOON` badges. |
| `page_coming_soon_back_to_agenda` | et | `Tagasi kava juurde` | "Back to agenda" (allative); natural Estonian back-link. |
| `page_coming_soon_back_to_agenda` | lv | `Atpakaļ uz programmu` | "Back to programme" (acc. after `uz`); standard Latvian. |
| `page_coming_soon_back_to_agenda` | uk | `Назад до програми` | "Back to programme" (gen. after `до`); standard Ukrainian. |
| `page_roster_description` | et | `Vaata, kes sinu kooris laulab — häälerühmad, hääled ja kontaktid.` | Informal 2nd-sg `Vaata`; `häälerühmad`=voice groups, `hääled`=voice parts. |
| `page_roster_description` | lv | `Uzziniet, kas dzied jūsu korī — sekcijas, balsu daļas un kontaktinformācija.` | Formal pl. `Uzziniet`; `balsu daļas`=voice parts. |
| `page_roster_description` | uk | `Дізнайтеся, хто співає у вашому хорі — секції, партії і контакти.` | Formal 2nd-pl; `партії`=voice parts (choral term). |
| `page_notices_description` | et | `Teated ja sõnumid sinu koorile.` | `teated`=notices; `sõnumid`=messages; `koorile`=for choir (dative). |
| `page_notices_description` | lv | `Paziņojumi un ziņas jūsu korim.` | `paziņojumi`=announcements; `ziņas`=messages; `korim`=for choir (dative). |
| `page_notices_description` | uk | `Оголошення та повідомлення для вашого хору.` | Standard Ukrainian; both nouns in nominative. |
| `page_settings_description` | et | `Sinu konto ja eelistused.` | `eelistused`=preferences; informal 2nd-sg (`sinu`). |
| `page_settings_description` | lv | `Jūsu konts un iestatījumi.` | `iestatījumi` = settings — must match `nav_tab_settings`; "preferences" loanword was inconsistent. Fixed in `07191d5`. |
| `page_settings_description` | uk | `Ваш обліковий запис та налаштування.` | `обліковий запис`=account (standard formal); `налаштування`=settings/preferences. |

(*MVOX:Comenius*)

---

### New key group: `about_*` — Carus-outreach copy (session 36, 2026-06-14)

12 keys for the `/about` page rewrite targeting choral music publishers. Commit `79d6523` on `feat/about-carus`. Register requirement: sincere, plain, warm, confident — no defensiveness, no hedging, own the misstep directly. ET is priority locale (PO native speaker).

**`about_page_title`** — "About mvox" page title.
- et: `mvox-ist` — elative case "about mvox"; consistent with `landing_footer_link_about` pattern already established for et. Do NOT use `Meist` (that's the nav dropdown short-form).
- lv: `Par mvox` — consistent with `landing_footer_link_about` lv.
- uk: `Про mvox` — consistent with `landing_footer_link_about` uk.

**`about_marginalia`** — stamp/signature line. en: `~ the mvox team`.
- et: `~ mvox meeskond` — `meeskond` = team; drop "the" (Estonian has no article).
- lv: `~ mvox komanda` — `komanda` = team.
- uk: `~ команда mvox` — word order flips: noun before brand name (natural Ukrainian).

**`about_intro_circle`** — "larger circle" lens line connecting choir to publishers.
- et: `Koor asub suuremal ringil` — `asub suuremal ringil` = sits on a larger circle; natural Estonian spatial metaphor.
- lv: `Koris pastāv plašākā lokā` — `plašākā lokā` = in a broader circle.
- uk: `Хор існує всередині більшого кола` — `існує всередині` = exists inside (slightly more contained metaphor, natural in Ukrainian).

**`about_story_body`** — owns the misstep directly; register is candid and humane. Critical locale notes:
- et: `oleme ise olnud valel poolel` — reflexive `ise` (ourselves) adds personal candour. `mõnikord valusalt` = sometimes painfully. `kangelasetegu` = act of heroism — pithy compound noun, mirrors en without calque.
- lv: `paši esam bijuši nepareizajā pusē` — `paši` (ourselves) = same candour pattern.
- uk: `самі бували не з того боку межі` — `бували` = imperfective past of `бувати`; signals recurrence (not a one-off slip), adds weight and candour.
- ALL locales: no publisher/composer/dispute names. "Wrong side of the line" = canonical phrase — translate meaning.

**`about_values_offer`** — publisher co-design invitation. Must read as inviting, not defensive.
- et: `koos teiega, mitte teie eest` = with you, not for you; `ausus vaikimisi` = honesty by default (lit. honesty-by-silence).
- lv: `kopā ar jums, nevis jūsu vietā` = together with you, not in your place; `godīgums pēc noklusējuma` = honesty by default.
- uk: `разом з вами, а не замість вас` = together with you, not instead of you; `чесність за замовчуванням` = honesty by default (standard Ukrainian UX term for "default").
- **JSON gotcha:** inner phrase `"honest by default"` / locale equivalents: use escaped straight quotes `\"..\"` — do NOT use typographic close-quote `"` (U+201D); its byte is 0x22 = ASCII `"` and terminates the JSON string early. Opening low-9 `„` (U+201E) is safe; the closing curly `"` is NOT.

**`about_contact`** — lead-in phrase only; email rendered separately as inline `<a href="mailto:...">` link.
- et: `Kirjastajad ja õiguste valdajad: kirjutage` — `kirjutage` = 2nd-pl imperative, formal. Colon before link.
- lv: `Izdevēji un tiesību īpašnieki: rakstiet` — `rakstiet` = 2nd-pl imperative, formal.
- uk: `Видавці та правовласники: пишіть` — `пишіть` = 2nd-pl imperative, formal.
- Register: 2nd-pl formal imperative in all 3 locales — matches the formal register of the offer block above it.

| Key | Locale | Value | Rationale |
|---|---|---|---|
| `about_page_title` | et | `mvox-ist` | Elative; matches `landing_footer_link_about` et. Do not use `Meist` (that's the nav-menu short-form). |
| `about_page_title` | lv | `Par mvox` | Matches `landing_footer_link_about` lv. |
| `about_page_title` | uk | `Про mvox` | Matches `landing_footer_link_about` uk. |
| `about_marginalia` | uk | `~ команда mvox` | Noun before brand (Ukrainian word order). |
| `about_values_offer` inner quotes | all | `\"..\"` escaped | Typographic `"` (U+201D) = ASCII `"` (0x22) → breaks JSON. Use `\"` only. |
| `about_contact` | et | `kirjutage` | 2nd-pl formal imperative; matches offer-block register. |
| `about_contact` | lv | `rakstiet` | 2nd-pl formal imperative. |
| `about_contact` | uk | `пишіть` | 2nd-pl formal imperative. |
| `about_story_body` | et | `kangelasetegu` | "Act of heroism" compound noun — pithy, mirrors en without literal calque. |
| `about_story_body` | uk | `бували` | Imperfective past signals recurrence; adds candour to the misstep admission. |
| `agenda_gap_weeks` | en | `{weeks} weeks later` | Reworded (task #11) from `In {weeks} weeks` — PO flagged as ambiguous ("from today" vs. gap after prior rehearsal). Relative-jump phrasing removes the ambiguity. |
| `agenda_gap_weeks` | et | `{weeks} nädalat hiljem` | "N weeks later"; partitive-sg `nädalat` correct for numeral N≥2 (Estonian numeral agreement). |
| `agenda_gap_weeks` | lv | `{weeks} nedēļas vēlāk` | "N weeks later"; nominative-plural `nedēļas`, same pattern as `darbi`/`eksemplāri`. |
| `agenda_gap_weeks` | uk | `{weeks} тижнів по тому` | "N weeks after that" — idiomatic relative-later construction; avoids `через`, which retains English "in"'s from-now ambiguity. Genitive-plural `тижнів` per convention. |

**Re-confirmed 2026-08-06 (task #11):** ICU plural (`{n, plural, one {...} other {...}}`) is still unsupported by `@inlang/plugin-message-format` (checked `project.inlang/settings.json` + `package.json` — `@inlang/paraglide-js ^2.23.1`, same module). Team-lead's task brief asked for "proper ICU plural" as a tracked follow-up on this key; flagged back and resolved by applying the existing plain-`{n}`-template convention instead (matches `library_master_count` precedent). [DEFERRED] item is unchanged — still blocked on upstream plugin support.

| `rsvp_status_going` | en/et/lv/uk | Going / Tulen / Būšu / Буду | Harvested verbatim from old app (`~/workspace/messages/*.json` `rsvp_going`) — same schema enum. |
| `rsvp_status_not_going` | en/et/lv/uk | Not going / Ei tule / Nebūšu / Не буду | Harvested verbatim (`rsvp_not_going`). |
| `rsvp_status_maybe` | en/et/lv/uk | Maybe / Võib-olla / Varbūt / Можливо | Harvested verbatim (`rsvp_maybe`). |
| `rsvp_status_late` | en/et/lv/uk | Late / Tulen hilja / Ar kavēšanos / Запізнюся | Harvested verbatim (`rsvp_late`). Note: Tallis's RED spec mock (`RsvpControl.spec.ts`) uses local placeholder `"Running late"` — that mock is self-contained and doesn't bind the real key; flagged to team-lead as FYI in case it was intended copy. |
| `rsvp_non_member_hint` | en | `Only members can RSVP.` | New copy (task #12) — team-lead's brief phrasing, shorter than old app's `rsvp_not_member` sentence to fit the 9px hint-line UI pattern. Not a harvest. |
| `rsvp_non_member_hint` | et/lv/uk | Ainult liikmed saavad RSVP kinnitada. / Tikai dalībnieki var apstiprināt RSVP. / Лише учасники можуть підтвердити RSVP. | Concept-translated (not the old app's longer `rsvp_not_member` sentence). `RSVP` kept as untranslated loanword in all 3, matching old app's `rsvp_error`/`rsvp_not_member` precedent. lv uses `dalībnieki` (matches `seasons_notice_assign_not_member` lv, not the old app's one-off `loceklis`). |

(*MVOX:Comenius*)
