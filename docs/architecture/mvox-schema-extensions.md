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
`admin_member_record` (mvox-app#265) is the second, and the first to use
per-property sharing and the `PropertyAdditionDef` shape (for the R2 toggle,
added to the existing `database` type rather than a new type of its own).

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

### `admin_member_record`

Admin-owned record of a member's real identity — real name, phone, email,
birth date — independent of and never overwriting the member's own profile.
Commissioned [mvox-app#265](https://github.com/mvox-dev/mvox-app/issues/265),
from a live discussion between Mihkel and Joosep: members may play with their
own profile, but the admin needs the real name and phone on file, with a
roster-wide toggle for whether members see real or profile names.

**Parent**: `database` (single, required) — the same attachment point as
`member`, reusing the existing collective owner/editor = admin rights cascade
with no new rights mechanism. **Corrected post-shape-review**: the review
approved `organization` as the parent, but neither polyphony nor mvox_crede
has an `organization` type-def live — it was retired in the #161
org→db-entity migration (2026-08, MVOX-11). The collective root has been the
database entity itself since then, on both databases uniformly, not as a
single-collective special case; `member`'s own type-def description
("membership record within one organization") is aspirational leftover
predating #161, while its actual live `_parent` already points at the
database entity. This is the same entity the R2 toggle below lives on.

**One per person** is an app-level invariant (check-then-create at
provisioning/seed time) — Entu has no native uniqueness constraint, same
discipline as `profile`/`member`.

| Property    | Type      | Required | Sharing | Notes                                                                                          |
| ----------- | --------- | -------- | ------- | ------------------------------------------------------------------------------------------------ |
| `person`    | reference | **yes**  | domain  | Which person this record belongs to. Domain, not private — see the sharing rationale below.      |
| `name`      | string    | **yes**  | domain  | The member's real, correct name. Always used on outputs of record (R3), regardless of R2.        |
| `phone`     | string    | no       | private | Real phone number, admin-managed. Not readable by members.                                       |
| `email`     | string    | no       | private | Real email, admin-managed. Not readable by members.                                              |
| `birthdate` | datetime  | no       | private | Date of birth, admin-managed. Not readable by members. (No date-only wire type exists — full datetime, UI shows the date portion.) |

Required-vs-optional and the sharing split are Mihkel's shape-review
corrections (comment 5561754737): only `name` is required (not `phone`, as
the proposal had first read the commission); the rest are optional.

**Rights posture**: `_inheritsRights: true`, cascading the collective's own
`_owner`/`_editor` down as this record's own — an admin (holds `_editor`+ on
the collective) gets create+edit automatically; a plain member gets nothing.
`creators: parent_right _editor`. Being the `person` a record refers to grants
**no** rights on it — referencing ≠ rights — so a member reads their own
`admin_member_record` exactly as any other domain-tier member does (their own
real name, nothing else), unless they separately hold admin rights.

**Why per-property sharing is a privacy control here, not a style choice**
(Mihkel, ruling comment 5561632474): `mvox_crede` is a real-life pilot holding
real people's personal data. `name`/`person` at `domain` is what lets the
roster render real names when R2 is on; `phone`/`email`/`birthdate` at
`private` is what keeps every other member from reading a colleague's phone
number and birth date. **Every prop-def's `_sharing` is set EXPLICITLY, never
omitted** — a live probe (mvox-app#265, `probe-265-mixed-sharing-live-
2026-09-06T19-36-05Z.json`) found that omitting `_sharing` on a prop-def does
NOT default to private, it silently **inherits the parent type's tier**
(`domain` here) — which would have widened every personal field the moment
someone forgot to set it. `mvox-schema-extensions.ts`'s `PropertySpec.sharing`
field exists specifically so this can never be an accident.

**R3 (outputs-of-record rule)**: an eventual output of record (e.g. a concert
programme) always reads `admin_member_record.name`, never `profile`,
unconditionally regardless of R2. No such output exists today — documented
contract only, nothing built for it in this commission.

**R4 (prefill without dependency)**: an admin creating a record MAY prefill
`name` from the person's existing profile display name as a **one-time plain
value copy** at creation time — never a formula or live reference. Entu
formula properties cannot "compute once then freeze" (they always
live-recompute against current sources), so a formula-based prefill would
violate "drawing on, but not depending on" profile data the moment it changed.

**Provisioning contract — read-back-then-assert (PO addition, comment
5561754737)**: this is not doubt about the documented per-property sharing
model — Mihkel's own standing ruling on #265 is to consult and believe Entu's
official documentation on platform behaviour, not build verification ladders
against it. It IS asserting that *our own writes landed as written*, the same
class of discipline as mvox-app#264 item 6. The provisioning script for this
type must, after creating each prop-def, read back its effective `_sharing`
and fail loudly on any mismatch against the table above, recording the result
in the `seed-results/` ledger. `ensure-schema-type.ts`'s `assertPropDefSharing`
helper implements this primitive; the provisioning script (next phase, not
this commit) is what calls it.

**mvox app extension** — not part of the canonical v4E schema.

### Org tree (excerpt)

```
polyphony database root (= the collective root, post-#161: organization retired)
        ├── member
        ├── admin_member_record    ← mvox extension, one per person
        ├── roster_show_real_names  (property on the database entity itself, not a child type)
        ├── event_series
        ├── event (multi-parent: db + season + section(s) + event_series)
        │     ├── program_item
        │     ├── schedule_item          ← mvox extension
        │     └── attendance
        └── invitation
```

### Rights matrix (excerpt)

| Entity                 | Anonymous | Section member (matching S) | Any member                              | Conductor                                  | Admin (of collective) |
| ----------------------- | --------- | ----------------------------- | ----------------------------------------- | -------------------------------------------- | ----------------------- |
| `program_item`          | read      | read                           | read                                       | full (if conductor of parent event scope)    | full                     |
| `schedule_item`         | read      | read                           | read                                       | full (if conductor of parent event scope)    | full                     |
| `admin_member_record`   | none      | none                           | read `name`/`person` only, rest invisible  | none (not an org-editor role by default)     | full                     |

### Bucket exposure (excerpt)

BFF acts in the authenticated user's rights by default.

| Entity                 | Type `_sharing` (verified live) | Instance default | Domain-visible properties                         |
| ----------------------- | -------------------------------- | ------------------ | ---------------------------------------------------- |
| `program_item`          | domain                            | matches event       | name, edition, ordinal, notes                         |
| `schedule_item`         | domain                            | matches event       | name, datetime                                        |
| `admin_member_record`   | domain                            | domain (asserted)   | `person`, `name` ONLY — `phone`/`email`/`birthdate` never leave the private bucket, per-property, regardless of the type/instance tier |

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

## Property additions to existing types

Not every schema change is a new type — `PropertyAdditionDef` in
`mvox-schema-extensions.ts` covers adding one property to something that
already exists (canonical v4E or another extension). Same commissioning /
`PO-Approved` discipline; lighter shape.

### `roster_show_real_names` (on `database`)

Boolean toggle, commissioned [mvox-app#265](https://github.com/mvox-dev/mvox-app/issues/265)
design input 3: whether the roster shows members' real names
(`admin_member_record.name`) or profile names. Lives on the collective entity
— which, since the #161 org→db-entity migration, is the database entity
itself on both databases (not a single-collective special case) — the same
entity `admin_member_record` is parented to.

- **Default `false`** (Mihkel correction 3): roster shows profile names until
  an admin explicitly turns real names on.
- **Sharing: no special case** (Mihkel correction 4) — takes the SAME posture
  as the database/collective entity's other properties. This is the one place
  in this schema surface where OMITTING an explicit `sharing` override is
  correct: the whole point is inheriting whatever tier `database` already
  carries, not asserting an independent one. `ensurePropDef`'s tooling
  extension resolves this by having the provisioning script read the LIVE
  `database` type's own current `_sharing` and pass it as the fallback — not
  by relying on Entu's own create-time inherit-on-omission behavior (the same
  behavior flagged as a trap above), so the intended inheritance is asserted
  by our own code, not left to chance.
- **Read-broad, write-admin-only**: every member's client (Path C,
  browser-direct) needs to read this to render the roster correctly — that's
  a read concern, not a write one. Write access needs no new mechanism:
  whoever already holds `_owner`/`_editor` on the collective can already write
  any of its existing properties.

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

`admin_member_record` and `roster_show_real_names` were commissioned, shaped,
and approved entirely within [mvox-app#265](https://github.com/mvox-dev/mvox-app/issues/265)
(2026-09-06) — no upstream path was ever considered, per the standing
schema-independence ruling. Two rulings on that issue are load-bearing beyond
the shape itself:

- **Posture** (comment 5561632474): `mvox_crede` is a real-life pilot holding
  real people's personal data; `polyphony` is the synthetic one. This is why
  the per-property sharing split matters as a genuine privacy control and why
  entering real names/phones/emails/birth dates into `mvox_crede` needs
  Mihkel's explicit say-so as its own decision, separate from this shape's
  approval (which covers provisioning the empty structure on both databases).
- **Method** (comment 5561754737, standing beyond #265): "entu has really
  great official documentation about all aspects. we should consult and
  believe, what it claims. if life shows later otherway, then we will file the
  bug report." The branch decision (one entity, per-property sharing) rests on
  Entu's own documented bucket-exposure model, confirmed by two independent
  source reads (`entu-api`) and a live partition probe on `polyphony`
  (`probe-265-mixed-sharing-live-2026-09-06T19-36-05Z.json` — a throwaway
  mixed-sharing type read back by a genuinely non-privileged, unauthenticated
  caller, torn down clean afterward) — not by further verification against a
  second real member seat, which this ruling explicitly says not to build.

(*MVOX:Perotin*)
