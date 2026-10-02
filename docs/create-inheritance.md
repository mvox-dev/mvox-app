# Create-time rights inheritance (#695)

Sources: app = `mvox-app` origin/main; api = `entu-api` origin/main (31a7319, 2026-09-29); docs = `entu-www` origin/main. No live Entu calls.

## Mechanism

- `postCreate` sends `_type`, `_parent`(s) and domain props only: no `_sharing`, no `_inheritrights` (`src/lib/entity/entityCreateShared.ts:121-150`).
- Entu fills the flag at create: `inheritParentProperties` (api `utils/entity.js:354-385`, called from `setEntity` on create, `entity.js:63`). It writes `_inheritrights: true` when the payload has none AND at least one `_parent` holds `_inheritrights: true` at that moment (`entity.js:380`, reads `parent.private._inheritrights[0].boolean`).
- Rights only cascade when the child holds a strict `true` (`aggregate.js:194`). Absent and false behave the same. A child without it is also skipped on every later parent-rights change (`aggregate.js:507-518`), so the gap does not self-heal.
- Child without the flag: no inherited rights; only its own direct grants (the creator's `_owner`, auto-granted) plus `_sharing` (copied from parent the same way, `entity.js:370-378`) apply. [unverified: no live read]

## Types created through `postCreate`

Five types, five callers (all in `src/lib/entity/`):

| Type | Caller | Parent(s) | Gets flag if | Can end up without inherited rights? |
|---|---|---|---|---|
| `season` | `createSeason` (`entityCreateEvent.ts:56-78`) | db entity (+ optional extras) | db entity is `true` | Yes, only if the db entity lacks `true` |
| `event_series` | `createEventSeries` (`:81-112`) | db entity + season | db entity or season is `true` | Same; season is a second chance only if it is itself `true` |
| `event` | `createEvent` (`:115-141`) | db entity + season + optional series | any of the three is `true` | Same; the db entity parent is always sent first (`parentIdsFor`, `entityCreateShared.ts:76-90`) |
| `work` | `createWork` (`entityCreateLibrary.ts:12-26`) | library entity only | library is `true` | Yes: library lacking `true` (single parent, no fallback) |
| `edition` | `createEdition` (`:35-49`) | work only | work is `true` | Yes: work lacking `true`, which follows from the library case (chain library > work > edition) |

## When is the parent `true`?

- **db entity**: bootstrap writes `_inheritrights: true` explicitly (api `utils/setupDatabase.js:117`, with `_sharing: domain`). Holds for any db created by Entu's setup. A db entity edited or created another way is not covered. [unverified for live dbs; no probe]
- **season / event_series**: created by `postCreate`, so `true` only via the auto-fill above, from the db entity. They add no independent guarantee.
- **library**: no creator in the app. Libraries are script/seed-created (`scripts/migrations/lib/library-visibility-2026-08-08.ts:34`); I found no script that sets `_inheritrights` on a library, and none that creates one. Its flag state is [unverified]. Test evidence of inheritance: `roleManagement.spec.ts:637` describes org-to-library `_inheritrights` as the existing behaviour (a spec comment, not a live read).
- **work**: created by `postCreate`, so `true` only via auto-fill from the library. `seed-293-crede-season-repertoire-2026-09-08.ts:25` relies on this ("NO _sharing/_inheritrights").

## Types that can end up without inherited rights

All five share one cause: a parent without `_inheritrights: true` at create time.

1. **`work`, `edition`**: the cause is a library entity without the flag (library created by a path that did not set it). Single-parent chain, so no fallback; an edition inherits the gap through its work. Highest exposure because the library has no known creator in the repo.
2. **`season`, `event_series`, `event`**: the cause is a db entity without the flag. Every type then lacks the flag together. Not expected for Entu-bootstrapped dbs.
3. Order case: creating a child before its parent's flag is set (e.g. a sub-parent still being created). Does not occur in these callers: all parents already exist and are not newly created by `postCreate` in the same flow, except `SeriesCreateForm.svelte:334-356`, which creates the series then events under it. The series gets its flag at create, so the events see it. [speculative: assumes the series' flag write has landed before the event POST; api aggregation is async but the auto-fill reads the stored `private._inheritrights`, which is written at create]

## Docs vs source

- Docs (`entu-www`: `overview/entities/index.md:35,75`, `overview/properties/index.md:102`) say only that a child inherits when it has `_inheritrights: true`. They say nothing of a create-time auto-fill. The auto-fill is source-only (`entity.js:354-385`).
- The `entu-www` examples (`examples/index.md:51,181`) tell users to set the flag explicitly on children.
- Stale citation: the issue and `sectionActions.create-inheritrights.spec.ts` cite `entity.js:296-325`. On origin/main that range is the `_parent` write-access check; the auto-fill is at `entity.js:354-385`. Cascade check cited as `aggregate.js:166-183` is now `aggregate.js:194`.
- The auto-fill triggers on ANY parent being `true`, not all; the spec comment says "at least one", which matches.

## Gap versus sections

`createSection` pins an explicit `_inheritrights: true` (#264 item 6, `sectionActions.create-inheritrights.spec.ts`) so it does not depend on the auto-fill. The five `postCreate` types above do not.

(*MVOX:Finn*)
