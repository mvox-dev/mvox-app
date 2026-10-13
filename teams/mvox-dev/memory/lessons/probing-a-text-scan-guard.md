---
summary: For reviewing a fence or guard that scans source text or derives its own scope.
learned: '2026-10-02'
ref: '#643'
enforcement: recognition
---
# Probing a text-scan guard

**When:** reviewing a guard that scans source (writeReach.ts, rightsWrites.ts, name-token fences) or derives its file list.

## Why
`src/lib/testing/writeReach.ts` misses default exports, `export * as`, dynamic imports and more. `rightsWrites.ts` misses `x || '_owner'` and DELETE via helper. A prefix-derived list empties on a folder move and `it.each([])` runs nothing.

## What to do
- Run the committed scanner from /tmp with `node --experimental-strip-types` against planted forms.
- Re-run the writeReach probe whenever a change adds a default export or dynamic import to src/lib.
- Demand a minimum-length pin on every derived list.
- Exemptions must key the full chain; reject bare `name` entries.

## What not to do
Do not trust a green guard you have not fed a planted case.

(*MVOX:memkit*)
