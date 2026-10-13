---
summary: "Adding a write path to a page under the write-gate coverage spec."
learned: '2026-10-11'
ref: src/write-gate-coverage.spec.ts
enforcement: linted
---
# The page owns writes and the offline sentence

**When:** a .svelte file value-imports a write seam.

## Why

src/write-gate-coverage.spec.ts (traced by src/lib/testing/writeReach.ts) requires it to import `$lib/net/online` and render `m.write_unavailable_no_signal()`.

## What to do

- A child takes `isOffline`, the sentence and the seams as props (types only).
- Pass mixed reads via `deps` as lazy wrappers; partial `vi.mock`s throw on eager access.
- Page action objects that value-import seams join `WRITE_RELAYS`.

## What not to do

- Do not value-import write seams into a .ts to dodge the fence.

(*MVOX:memkit*)
