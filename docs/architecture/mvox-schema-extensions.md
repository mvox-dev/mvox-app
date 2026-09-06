# mvox schema extensions

App-extension entity types — types that exist because mvox needs them, not
because they trace to canonical v4E. Home settled on
[mvox-app#246](https://github.com/mvox-dev/mvox-app/issues/246) (Gama SETTLE,
2026-09-06), following the 2026-09-06 ruling that retired the `entu/research`
upstream flow entirely. `entu/research`'s `docs/schema/v4E/` remains historical
reference and design heritage — never a sync target again. All schema evolution
is mvox-side: PO sign-off on the commissioning issue + a seed/setup script under
`scripts/migrations/`, no PR, no `Schema-Change:` trailer.

Type definitions themselves (the `EntityDef`-shaped vocabulary, properties,
notes) live in
[`scripts/migrations/lib/mvox-schema-extensions.ts`](../../scripts/migrations/lib/mvox-schema-extensions.ts).
This document is the narrative companion — the prose a designer or reviewer
would look for in the v4E README, adapted here because these types are no
longer v4E's to describe.

Precedent note: `mvox_collective` (the first app-extension type) predates this
document and still lives inline in `entu/research`'s `setup-entity-types.ts` —
a different repo, a different team's file. That was only ever a *procedural*
precedent (skip `schema.ts`/PR/trailers), never a *location* one. `schedule_item`
is the first type to land with its definition here, mvox-side, front door.

---

## Entity catalog

### `schedule_item`

A single named point in time within an event (call, rehearsal start,
performance start). One event, several named times.

**Parent**: `event` (single, required)

**`add_from`**: `event` type

**`_sharing`**: cascades from the parent event's `_sharing` at create-time (BFF
cascade), same as `program_item`.

| Property   | Type     | Required | Notes                                                                                                     |
| ---------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `name`     | string   | yes      | what this time is — free text (call, warm-up, sound check, rehearsal, performance, photo, …); open set       |
| `datetime` | datetime | yes      | sort key; `name` is the costless tie-break for two items sharing a minute — deliberately **no `ordinal`**    |

`event.start_datetime` stays required and directly writable — the agenda's
sole sort key. Deriving it as a formula over children is disqualified: a
formula property overwrites unconditionally and silently drops POSTs
(mvox-app#233 finding). Adjudicated on mvox-app#246 — the ordinal challenge
was conceded after a deliberate search for a display-order-diverges-from-
chronological case turned up none.

**Rights posture**: identical to `program_item` — whoever holds `_editor`+ on
the parent event (conductor/admin tier, per the roles-as-rights model) can
create/edit schedule items.

**mvox app extension** — not part of the canonical v4E schema. `entu/research`
never carries this type; the upstream flow that would have added it there was
withdrawn and then retired entirely (mvox-app#246 comment thread, 2026-09-06).

### Org tree (excerpt)

```
polyphony database root
        ...
        ├── event_series
        ├── event (multi-parent: org + season + section(s) + event_series)
        │     ├── program_item
        │     ├── schedule_item          ← mvox extension
        │     └── attendance
        └── invitation
```

### Rights matrix (excerpt)

| Entity          | Anonymous | Section member (matching S)                 | Any member | Conductor                                 | Admin (of collective) |
| --------------- | --------- | -------------------------------------------- | ---------- | ------------------------------------------ | ---------------------- |
| `program_item`  | read      | read                                          | read       | full (if conductor of parent event scope)  | full                    |
| `schedule_item` | read      | read                                          | read       | full (if conductor of parent event scope)  | full                    |

### Bucket exposure (excerpt)

BFF acts in the authenticated user's rights by default.

| Entity          | Type `_sharing` (verified live) | Instance default | Domain-visible properties       |
| --------------- | -------------------------------- | ----------------- | -------------------------------- |
| `program_item`  | domain                            | matches event      | name, edition, ordinal, notes    |
| `schedule_item` | domain                            | matches event      | name, datetime                   |

Note on the "Type `_sharing`" column: the salvaged v4E draft literal declared
`schedule_item.sharing = 'public'` (design-time aspiration). A live read-only
probe against `program_item` (2026-09-06, part of landing this extension)
found its actual type-def `_sharing` is `domain`, not `public` — so
`schedule_item`'s type-def was created at `domain` to genuinely match its
sibling, per the settled "identical rights posture to program_item" ruling.
The federation-anonymous-visible-properties column from the original v4E
README template is omitted above: mvox has no live federation-anonymous
exposure surface yet, so a "public"-tier claim would be untested and
potentially misleading here.

---

## Provenance

`schedule_item`'s shape was drafted and adjudicated on
[mvox-app#246](https://github.com/mvox-dev/mvox-app/issues/246) while the
`entu/research` upstream path still existed, briefly opened as
`entu/research#54`, then withdrawn and closed when Mihkel ruled the upstream
flow out of place (2026-09-06) and, in the same session, retired the upstream
flow entirely for every future type. The object literal and this narrative are
salvaged verbatim (ordinal-drop ruling already baked in) from the closed PR's
branch `feat/v4e-schedule-item` (`entu/research`, deleted after copy-out) —
adapted only to mark them explicitly as an mvox app extension rather than a
canonical v4E entity.

(*MVOX:Perotin*)
