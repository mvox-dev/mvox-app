<!-- Moved from the lead's harness auto-memory (project_polyphony_seasons_events.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-seasons-events

> Season + event + event_series entity design for polyphony's temporal layer (decided 2026-05-18 session 3)

Polyphony's temporal layer: **season** defines the annual cycle, **event** is a concrete occurrence (rehearsal / concert / festival / retreat), **event_series** defines recurring patterns (typically weekly rehearsals).

## Entity definitions

```
season  (child of org; _sharing: public)
  ── name         string         e.g., "2025/2026 season"
  ── start_date   date           required
  ── end_date     date           required (explicit — needed to know "when does the ongoing season end")
  ── description  text (optional)
```

```
event_series  (multi-parent: [org] + optionally [season(s)] + [section(s)]; _inheritrights: true; _sharing: private default)
  ── name                 string                  e.g., "Tuesday Rehearsals 2025/2026"
  ── event_type           string enum             rehearsal | concert | festival | retreat | workshop | meeting | social | other
  ── interval_days        number                  7 = weekly; 14 = biweekly; 1 = daily; 30 ≈ monthly
  ── start_time           string                  "19:00" (HH:MM)
  ── duration_minutes     number                  120
  ── start_date           date                    first occurrence (anchor)
  ── end_date             date                    last occurrence
  ── default_location     string (optional)
  ── default_description  text (optional)
```

```
event  (multi-parent: [org] + optionally [season(s)] + [section(s)] + [event_series]; _inheritrights: true; _sharing: private default)
  ── name              string                  inherited from series.name if not set
  ── event_type        string                  inherited from series.event_type if not set
  ── start_datetime    datetime                required
  ── duration_minutes  number                  inherited from series.duration_minutes if not set
  ── location          string                  inherited from series.default_location if not set
  ── description       text                    inherited from series.default_description if not set
```

**No status / cancelled field** — cancellation = delete. YAGNI on flag; add later if real need emerges. BFF series-regeneration must not blindly recreate deleted dates (would erase admin's intentional cancellation).

## Why interval_days instead of day_of_week + pattern enum

`interval_days` is more general: 7 = weekly; 14 = biweekly; 30 ≈ monthly; 1 = daily; custom intervals work. Anchor is `start_date` (first occurrence date — pick a Tuesday for weekly-Tuesday). Trade-off: monthly is approximate (interval=30 drifts across months). If precise monthly ever needed ("first Saturday of each month"), add a separate pattern type. YAGNI for MVP.

## Why duration_minutes instead of end_datetime

Symmetric: event has `start_datetime + duration_minutes`; series has `start_time + duration_minutes`. End is derived on read. Duration is the truly invariant property — a 2-hour rehearsal stays 2 hours regardless of date.

## Sharing model

| Entity | type `_sharing` | instance default | public property defs |
|---|---|---|---|
| season | public | public | name, start_date, end_date, description |
| event_series | public | private | name, event_type, interval_days, start_time, duration_minutes, start_date, end_date, default_location, default_description |
| event | public | private | name, event_type, start_datetime, duration_minutes, location, description |

**Federation directory** queries events with `_sharing: public` (replacing the earlier `org.public_event[*]` curated list — dropped per `[[polyphony-org-rights-isolation]]`). Admin flips per-event for concerts; series-level `_sharing` change cascades to all child events via BFF (since `_sharing` isn't inherited by Entu natively).

## Recurring events (series + materialized children)

Pattern: series defines defaults; events are materialized as children of series with property-level overrides.

**Read-time inheritance**: event stores only overrides. BFF resolves missing properties from series defaults. Mirrors the edition→work pattern in `[[polyphony-library-subtree]]`.

**Generation lifecycle**:
- Create series → BFF generates events for `start_date` to `end_date` at `interval_days` intervals
- Extend `end_date` → BFF generates additional events from old to new end
- Shorten `end_date` → delete future-only events past new end
- Edit series defaults → affects non-overridden events
- Per-event override stored on event entity
- Delete series → events become orphan (lose series parent, continue as independent entities)

**Series regeneration must be idempotent**: dedupe by `start_datetime` within `start_date`–`end_date` range; never recreate deleted events.

## Manual frontend assignment to series

Events can be added to / removed from series via Entu frontend (multi-parent supports this). Inheritance works for manually-added events. Series `_sharing` cascade includes all children (generated + manually added).

**Series creator ownership note**: with admin = `_owner` on org (per `[[polyphony-roles-as-rights]]`), `_owner` cascades to series and generated events. So all admins can manage all series natively. The earlier "departed admin orphan-entity friction" is resolved.

## Sharing cascade (BFF-mediated)

`_sharing` is NOT inherited via `_inheritrights` (only `_owner` / `_editor` / `_expander` / `_viewer` are). So when admin flips `series._sharing`, BFF iterates child events and updates each. Same pattern applies to event → program_item / attendance cascade.

## Related memory

- `[[polyphony-programs]]` — program_item (child of event) + repertoire_item (child of season)
- `[[polyphony-participation]]` — rsvp (child of person, refs event) + attendance (child of event)
- `[[polyphony-roles-as-rights]]` — conductor role = `_editor` on season / event / event_series scope (no separate role property)
- `[[polyphony-org-rights-isolation]]` — federation visibility model that absorbs events via instance `_sharing`
- `[[polyphony-bff-rights-pattern]]` — most event ops are native user-rights with admin = `_owner`
