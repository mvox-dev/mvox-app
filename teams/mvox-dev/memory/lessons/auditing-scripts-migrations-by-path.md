---
summary: For running any audit predicate over scripts/migrations.
learned: '2026-09-07'
ref: '#278'
enforcement: recognition
---
# Auditing scripts/migrations by path

**When:** grepping or listing files under `scripts/migrations/`.

## Why
It holds twin files: `X.ts` (a runner that owns the file write) and `lib/X.ts` (logic, no write). Reporting by basename merges each pair and hides which half matched; I nearly raised a false finding on #278.

## What to do
Emit full relative paths. Check that a guard's exemption list and the audit that produced it use the same path shape: they can agree on the set and differ on the keys.

## What not to do
Do not use `basename` in these predicates.

(*MVOX:memkit*)
