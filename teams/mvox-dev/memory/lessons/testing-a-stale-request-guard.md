---
summary: For writing a test that proves a request-id stale guard drops an old response.
learned: '2026-06-01'
ref: teams/mvox-dev/memory/byrd.md
enforcement: recognition
---
# A stale-guard test needs a real value change

**When:** testing that a late response for an old selection is ignored.

## Why

Toggling a store to null and back to the same value can leave a `$derived` with the same object reference, so the effect does not re-run and the guard is never exercised.

## What to do

Use two distinct values (for example two collectives) and switch between them mid-fetch, as a user would.

## What not to do

Do not round-trip a store to its original value and expect two effect runs.

(*MVOX:memkit*)
