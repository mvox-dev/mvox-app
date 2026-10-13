<!-- Moved from the lead's harness auto-memory (project_polyphony_participation.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-participation

> Split rsvp (child of person, member-created) + attendance (child of event, conductor-created); both natively creatable in user-rights mode (decided 2026-05-18 session 3)

Participation is split into two entities — `rsvp` (member-set, lives under person) and `attendance` (conductor-set, lives under event). Splitting (rather than combining v3-style) sidesteps the field-level rights problem entirely and gives each side native user-rights ownership.

## Why split (not combined)

v3 sketched a combined `Participation` entity holding both RSVP and attendance state. **Rejected** because:
- Member shouldn't be able to edit attendance; conductor shouldn't edit RSVP
- Combined entity would require BFF field-level enforcement
- Field-level enforcement violates the BFF user-rights principle (`[[polyphony-bff-rights-pattern]]`) — would require marked elevation per RSVP write

Split gives clear creator-ownership: member creates rsvp (owns it); conductor creates attendance (owns it). Both are native user-rights operations.

**Trade-off accepted**: ~2× entity count per event (50 events × 50 members × 2 entity types ≈ 5000 per choir per season). Manageable.

## Entity definitions

```
rsvp  (child of person; add_from = person type; _sharing: private default)
  ── event        ref → event        single, mandatory
  ── member       ref → member       single, mandatory (per-org context — same person can be member of multiple orgs)
  ── status       enum                going | not_going | maybe
  ── notes        text (optional)    "arriving late", "joining for second half"
```

**Why under person, not event**: member must be able to create RSVPs natively. Person has `_editor: self` from Entu's auto-create (per `[[polyphony-onboarding]]`); `_editor` includes `_expander` via tier cascade → member can create rsvp as child of own person. If rsvp were under event, member would need `_expander` on event (which `_viewer` cascade doesn't provide), requiring BFF elevation per RSVP — high-frequency op, not great.

```
attendance  (child of event; add_from = event type; _sharing: private default)
  ── member       ref → member       single, mandatory
  ── status       enum                present | absent | late
  ── notes        text (optional)    "left after intermission"
```

**Conductor creates attendance natively** — conductor's `_editor` on events scope (see conductor role below) gives `_expander` cascade → can create child of event.

## Sharing

Both entities `_sharing: private` by default. Visibility comes via rights cascade:
- rsvp inherits from person (own creator) — person sees own; others don't see by default
- attendance inherits from event — org members have `_viewer` cascade on event → can read attendance (matches choir reality: who attended is communal info)

For "who's coming to event X" view from member perspective: BFF cross-rights query — pulls RSVPs across all persons where `event = X`, returns aggregated view. Marked elevated op (per `[[polyphony-bff-rights-pattern]]`).

For "what events am I RSVP'd to" view from member perspective: native query under own person.

## Excused absence pattern

No separate `excused` flag. Derive from rsvp + attendance combination:
- Member RSVPed `not_going` AND attendance `absent` → "absent with notification" (excused)
- Member RSVPed `going` AND attendance `absent` → "no-show" (unexcused)
- No RSVP AND attendance `absent` → "absent" (unannounced)

If finer distinction ever needed, add status values or flag later. YAGNI for MVP.

## Conductor role — scope-dependent `_editor`

Per `[[polyphony-roles-as-rights]]` — no separate `conductor` role property or entity. Conductor = `_editor` on whatever event-related scope they lead. Admin grants per conductor:

| Conductor type | `_editor` granted on |
|---|---|
| Main conductor (all events in a season) | the `season` entity |
| Series-specific conductor (e.g., weekly Tuesday rehearsals) | the `event_series` entity |
| Guest conductor (one-off concert) | the specific `event` entity |
| Section conductor (sectional rehearsals) | the `section` entity (also makes them section-leader) |

`_editor` cascade gives `_expander` → conductor creates `program_item`, `attendance`, edits event details within their scope.

**"List all conductors of org X"** = aggregate persons with explicit `_editor` (filtered `inherited != true`) on any `season` / `event` / `event_series` entity in org X's subtree. BFF aggregation across multiple entity types.

**Member relationship**: per the membership-rights invariant (`[[polyphony-roles-as-rights]]`), conductor must be a member of org. Admin's `_editor` grant is checked against member existence by BFF before grant.

## Related memory

- `[[polyphony-seasons-events]]` — event + event_series entities that participation hangs off
- `[[polyphony-onboarding]]` — person has `_editor: self` from auto-create; member entity definition
- `[[polyphony-roles-as-rights]]` — conductor role mapping (no separate property); membership-rights invariant
- `[[polyphony-bff-rights-pattern]]` — "who's coming" aggregate query is a marked elevated BFF report
