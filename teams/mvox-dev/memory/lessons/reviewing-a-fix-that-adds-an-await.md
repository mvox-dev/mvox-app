---
summary: For reviewing a change that adds a suspension point to a guarded async handler.
learned: '2026-10-02'
ref: '#268'
enforcement: recognition
---
# Reviewing a fix that adds an await

**When:** a fix inserts an `await` into a guarded async handler or a route-load gate hook.

## Why
A new await is a coverage event: old race tests may now pass at the new early guard and never reach the guard they were written for. A gate hook that writes page state after an await can overwrite state a newer load reads (#702).

## What to do
1. Is every earlier guard re-checked after the new await?
2. Did existing race pins short-circuit? Trace the await order in each test.
3. Does the new guard have its own race test that holds the new await?
A route-load `gate` that writes state after an await needs its own `isCurrent()` check.

## What not to do
Do not take a green suite as proof of which guard did the work.

(*MVOX:memkit*)
