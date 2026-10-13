---
summary: "Working in the part viewer tree, its fence, and URL spies in tests."
learned: '2026-10-11'
ref: src/part-viewer-fence.spec.ts
enforcement: linted
---
# Part viewer fence and spies

**When:** editing the part viewer or its tests.

## Why

src/part-viewer-fence.spec.ts bans `.labelsFor(` in the viewer tree; labels come via `storedPartLabel` (labelStore.ts) from DownloadLink.svelte.

## What to do

- For a page near 400 lines, split out a component.
- Pair `vi.spyOn(URL, 'createObjectURL')` in beforeEach with `mockRestore` in afterEach.
- Listen for `unhandledRejection`: a swallowed-error break can pass and show only as vitest "Errors".

## What not to do

- Do not grow LINE_CAP_EXCEPTIONS; it is shrink-only.

(*MVOX:memkit*)
