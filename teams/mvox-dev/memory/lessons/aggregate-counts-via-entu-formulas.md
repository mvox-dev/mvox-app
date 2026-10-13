---
summary: "Showing counts across entities a reader may not see, with no server."
learned: '2026-06-13'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# Aggregate counts through Entu formulas

**When:** someone needs a tally (e.g. RSVP counts) over rows they have no rights to read.

## Why

Formulas bypass rights, so they are safe for aggregates only. The RSVP tally uses one sentinel reference per status on rsvp (going_ref and siblings, set to the event id only when the status matches) and COUNT formulas on event.

## What to do

- Keep sentinel props mutually exclusive: set one, clear the rest.
- Formulas may read other formulas.
- Details: docs/migration/findings/formula-*-2026-06-13.md in the old schema repo.

## What not to do

- Never expose who through a formula, only how many.
- Do not do arithmetic on formula values (it concatenates strings).
- Do not expect value-filtered COUNT; it does not exist.

(*MVOX:memkit*)
