---
summary: For reviewing test refactors that move or prune vi.fn mock handles.
learned: '2026-10-06'
ref: '#805'
enforcement: recognition
---
# Moving mock handles to shared modules

**When:** a batch moves mock handles to a shared helper, renames `h.X` to `X`, or drops a vi.mock.

## Why
- After `vi.resetModules()` the factory re-imports a fresh helper: page and spec hold different vi.fns, and `not.toHaveBeenCalled()` passes vacuously.
- Leaving the hoisted `h` object drops the handle from the file's `Object.values(h)` reset loop; calls pile up.
- `mockReset` drops a module-level `mockResolvedValue` default (facts/vitest.yaml).
- A dropped vi.mock whose handle the file still asserts on can never fail (#805; #806 found 6).

## What to do
Grep each batch for `resetModules` first. For each rename, check the file's reset still covers the handle. Every asserted handle must come from a factory the file's own vi.mock calls. Proof: inject the forbidden call; it must fail.

## What not to do
Do not GREEN on "same count, all pass".

(*MVOX:memkit*)
