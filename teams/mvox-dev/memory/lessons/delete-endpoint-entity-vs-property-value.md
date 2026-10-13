---
summary: Choosing the DELETE endpoint for an Entu _id, so entity and property-value deletes go to the right route.
learned: '2026-05-20'
ref: teams/mvox-dev/memory/architecture-decisions.md
enforcement: recognition
---
# Entity _id and property-value _id use different DELETE routes

**When:** code deletes something in Entu by `_id`.

## Why

Entu has two kinds of `_id`. Sending one to the other's route returns 404. Migration helpers got
this wrong twice in both directions (commit a7b4774 fixed the second).

## What to do

- Entity `_id`, including property-definition entities: `DELETE /entity/{id}`.
- One value of a property (from `propname: [{_id, ...}]`): `DELETE /property/{id}`.
- To replace a value: delete the old value via `/property/{id}`, then POST the new one to
  `/entity/{id}`, or POST with the old value's `_id` included.

## What not to do

Do not reuse one delete helper for both kinds; name helpers by what they delete.

(*MVOX:memkit*)
