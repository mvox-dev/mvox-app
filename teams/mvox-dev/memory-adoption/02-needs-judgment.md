# 02 — Needs judgment (Phase 2 → 3)

Sources stay unchanged in git until cutover; full text of any id regenerates with
`split.py` (01-items.tsv ids). Quoted here: id + the question, not whole bodies — 202 whole
bodies run to ~25k words.

## Arithmetic (Phase 2)

```
in 923 = converted 171 + needs-judgment 202 + ruled dead 397 + moved 117 + phase-4 36 = 923
(+ MEMORY.md, ruled at GATE 1 to become one pointer)
```
converted = 168 by four converter batches (02-conv.tsv; each batch passes `memory-lint --gate`)
+ 3 by memkit (team-lead#1, team-lead#2, task-list-snapshot#1 → team-lead.yaml; #890 and #897
closed after the checkpoint, so they are not carried). needs-judgment = 188 idle-role / longform
items + 14 the converters refused.

## Batch 1

### 1A — converter questions (14). Plain ones decided under the docs-first rule.

| id | question | recommendation |
|---|---|---|
| `feedback_ultracode_team_roles#1` | Still valid? Parallel adversarial reviewers conflict with 2026-10-01 ruling that Bentham reviews alone; Tallis/Byrd roles idle. | dead (superseded by fresh-implementer + Bentham-alone rulings) |
| `project_cf_pages_wrangler_vars#1` | mvox-app has no wrangler.json now; retire this memory? | dead |
| `project_cf_workers_process_env#1` | App is adapter-static with no server code or wrangler.json; retire this lesson? | dead |
| `project_entu_way_of_entu#1` | Its row says _sharing never propagates, but docs say parents copy it at create; drop that row, keep lesson? | DECIDED: convert, drop the row the docs contradict (docs first) |
| `project_pnpm_not_on_path#1` | pnpm now resolves on PATH via ~/.local/bin/pnpm; retire this lesson? | dead (pnpm resolves from ~/.local/bin in a bare login shell, checked today) |
| `project_polyphony_no_domain_sharing#1` | mvox now uses domain sharing (schema extensions, #56); retire or narrow this 2026-05-17 ruling? | dead (polyphony frozen, #407) |
| `project_wrangler_deploy_auth#1` | mvox-app has no deploy script or wrangler config; retire this lesson? | dead |
| `team-lead-archive#3` | entu-www now says new children get _inheritrights:true if a parent has it; archive denies auto-write. Which stands? | DECIDED: the docs version stands; convert as an entu fact |
| `team-lead-archive#18` | No pnpm format script or biome.json in repo now; retire this Biome gotcha? | dead |
| `team-lead-archive#92` | TeamDelete/TeamCreate no longer exist (implicit teams); retire L117 protocol? | dead |
| `team-lead-archive#101` | TeamDelete/TeamCreate no longer exist; keep only "shut teammates down before session end"? | DECIDED: keep only "shut teammates down before session end" as a lesson |
| `finn#10` | #350 added /version.json with CF_PAGES_COMMIT_SHA; retire this gotcha? | dead |
| `finn#12` | No voicing/language read in src now; close this deferred library-filter item? | dead (close the deferred item) |
| `perotin#3` | Platform facts, not lesson; "POST never replaces" contradicts docs overwrite-by-_id. Re-tier to facts/entu-platform.yaml? | DECIDED: re-tier to facts, stated as the docs say (overwrite by _id) |

### 1B — idle roles + long-form (188): screened against the repo (02-screen.tsv)

Recommendation: accept the screen as is. dead 141, keep:fact 6, keep:lesson 21, keep:longform 10, keep:rule 9, keep:ruling 1.
Keepers convert by the Phase 2 spec; `keep:longform` (10 polyphony-era design notes) move to
`teams/mvox-dev/docs/design-notes/`; `keep:rule` (9) join the Phase 4 candidates. Idle-role
scratchpads (byrd, comenius, tallis, victoria) hold no live `current`/`staging` after this,
so per GATE 1 they get no yaml.

Keepers:

| id | → | evidence |
|---|---|---|
| `byrd#25` | keep:lesson | vitest.config.ts globals:false still; 143 specs call cleanup() explicitly |
| `byrd#29` | keep:rule | src/routes/+layout.svelte uses $app/state; grep finds no $app/stores in src |
| `byrd#43` | keep:lesson | CSS fact independent of code; dropdowns still in NavShell; cheap and true |
| `byrd#47` | keep:lesson | Tailwind fact still true; generic mobile-layout trap |
| `byrd#68` | keep:lesson | vi.importActual module isolation is Vitest behavior, still applicable |
| `byrd#91` | keep:lesson | Dirty-field patch avoids description-wipe; seasonFieldEdit.ts exists in src/lib/seasons |
| `byrd#100` | keep:lesson | Selector prefix collision in Vitest is generic and still applies to testid conventions |
| `byrd#109` | keep:lesson | package.json check = svelte-kit sync only, build triggers paraglide compile; still true |
| `byrd#112` | keep:lesson | Async $effect in page specs needs vi.waitFor; vitest 4 still |
| `byrd#113` | keep:lesson | 259 specs mock paraglide messages; strict mock throws on missing keys |
| `byrd#129` | keep:rule | Shared ~/workspace-app tree still real; check git branch before editing; not in common-prompt (grep) |
| `byrd#133` | keep:lesson | Stale-guard tests need real value change; generic derived-store pitfall, store.spec.ts exists |
| `byrd#135` | keep:fact | src/app.css still has ink-3 #7a7166 and ink-4 #a89f91; AA contrast rule on paper bg |
| `byrd#138` | keep:lesson | Plain-let edge detection in $effect avoids loops; generic Svelte 5 pattern |
| `byrd#139` | keep:lesson | collectives/store.ts hydration needs token plus authStore; store.spec.ts tests |
| `byrd#144` | keep:lesson | importOriginal still evaluates real module imports; Vitest behavior |
| `byrd#149` | keep:ruling | PO ruling: disable control while pending, no coalescing; still design stance |
| `byrd#152` | keep:rule | i18n-leak rule: generic error key, console.error detail; 4 locales still |
| `byrd#160` | keep:lesson | Cold-start auth ordering pin; avoids hand-set-state anti-pattern; generic |
| `bentham#6` | keep:fact | Verified: no src/lib/server, adapter-static in svelte.config.js; prompts/bentham.md security list already updated, but #362 standing check still useful. |
| `comenius#6` | keep:lesson | JSON quote-termination gotcha is general to messages/*.json; key about_values_offer itself no longer in messages/en.json. |
| `comenius#43` | keep:lesson | Duplicate-key JSON check via jq|sort|uniq -d is still valid for messages/*.json; not in common-prompt.md. |
| `comenius#58` | keep:lesson | Svelte 5 {@const} only allowed in blocks/snippets; general gotcha, not in common-prompt.md (grep). |
| `comenius#60` | keep:lesson | Svelte 5 {@const} placement rule; same as comenius#58, restates it with full list; not in common-prompt.md. |
| `tallis#3` | keep:rule | Vacuous-guard audit; common-prompt.md and Test review rule not shown to cover waitFor/toBeDefined points (grep vacuous: none). |
| `tallis#4` | keep:rule | Stub-with-RED rule keeps pnpm check at 0; still part of TDD chain; not in common-prompt.md (grep). |
| `tallis#5` | keep:lesson | Do not force ts-expect-error for retired fields; 4 specs still use ts-expect-error; type-level RED practice still applies. |
| `tallis#6` | keep:rule | Positive-proof absence assertions still valid test practice; matches partial-assertion lessons. |
| `tallis#7` | keep:rule | Assert rejection message against throw stub; general RED practice, not covered elsewhere. |
| `tallis#8` | keep:lesson | ts-expect-error covers only next line; pnpm check still part of gates (package.json); vitest strips types. |
| `tallis#9` | keep:rule | Assert base and breakpoint Tailwind classes together; Tailwind v4 still in use (package.json). |
| `tallis#11` | keep:rule | Injected fetchImpl with real Response mock convention; Entu client tests still follow it. |
| `tallis#12` | keep:fact | entu_user mint trigger, creator auto _owner, person parent = db entity; add_user only mentioned as never read in inviteCreate.ts:70. |
| `tallis#14` | keep:lesson | fake timers vs waitFor hang; useFakeTimers still used in several specs; real-dates workaround still valid. |
| `victoria#11` | keep:fact | Conductor = direct _editor grant on season; matches src/routes/page.season-manage-conductors.spec.ts and roles-as-rights design. |
| `victoria#19` | keep:fact | entu-api enforces no mandatory on REST; matches auto-memory Entu mandatory is soft. |
| `victoria#21` | keep:fact | add_user deleted (#22); inviteCreate.ts:70 confirms it is never read. Partly in tallis#12. |
| `project_polyphony_email_trust#1` | keep:longform | Email trust rules still relevant to invite discovery; polyphony frozen (#407) but rationale reusable, move to docs/. |
| `project_polyphony_library_subtree#1` | keep:longform | Full library property design; src/lib/library implements work/edition/copy; schema-of-record is mvox-schema-extensions.ts. Move to docs/. |
| `project_polyphony_onboarding#1` | keep:longform | Bilateral-consent design behind src/lib/invite; polyphony-era, reference prose for docs/. |
| `project_polyphony_org_rights_isolation#1` | keep:longform | _inheritrights false per org rationale; rights model still in use (rights-model-identifiers.spec.ts). Move to docs/. |
| `project_polyphony_participation#1` | keep:longform | rsvp vs attendance split rationale; src/lib/rsvp and src/lib/attendance both exist. Move to docs/. |
| `project_polyphony_programs#1` | keep:longform | repertoire_item/program_item design; src/lib/repertoire exists. Reference prose for docs/. |
| `project_polyphony_roles_as_rights#1` | keep:longform | Roles as rights grants; still the model (adminStore, season-manage-conductors). Move to docs/. |
| `project_polyphony_seasons_events#1` | keep:longform | season/event/event_series design; src/lib/seasons and events exist. Reference prose for docs/. |
| `project_polyphony_section_structure#1` | keep:longform | Recursive section tree design; src/lib/sections exists. Reference prose for docs/. |
| `project_polyphony_work_edition_model#1` | keep:longform | Work/Edition model implemented in src/lib/library (EditionRow, WorkRow). Reference prose for docs/. |

Dead: the other 141 rows of 02-screen.tsv, each with its evidence.

### 1C — test-gaps still holding (GATE 1: lead decides on issues)

| gap | evidence |
|---|---|
| Tailwind purge No test verifying dynamic class | No spec on dynamic-class purge found (grep purge/dynamic in specs: none relevant). |
| CHORE-35 Real Entu OAuth flow not E2E testable | No Playwright installed or config; only unit specs for callback exchange. |
| CHORE-35 Loading skeleton appearance not tested | No Playwright; src/lib/loading has routeLoad specs only, no skeleton-appearance check. |
| CHORE-76/77 Responsive nav viewport stacking | No Playwright/e2e dir; no viewport overflow or z-index paint-order specs found. |
| CHORE-78 Mobile library viewport scroll behaviour | No Playwright/e2e; library specs are unit/DOM only, no viewport tests. |
| CHORE-79 Auth guard E2E flow not Playwright-tested | No Playwright; guard.spec.ts and redirect.spec.ts unit-test logic only. |

Gone: 9 of 15 (02-test-gaps-check.tsv).

## Rulings

_Pending._

(*MVOX:memkit*)
