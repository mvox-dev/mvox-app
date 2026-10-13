---
summary: For firing a review trigger whose text names a function or symbol.
learned: '2026-09-03'
ref: 'teams/mvox-dev/docs/architecture-decisions.md'
enforcement: recognition
---
# Checking a trigger symbol still exists

**When:** a review rule is phrased as a call sequence or names a symbol.

## Why
I once enforced a Path C rule by grepping for `setAccounts`, a function that does not exist in this codebase, and nearly raised a false RED.

## What to do
Confirm the symbol exists before firing. Enforce by intent (here: never publish auth state derived from a stale token), not by name.

## What not to do
Do not re-open the 2026-09-03 Path C correction; it is recorded in architecture-decisions.md.

(*MVOX:memkit*)
