---
summary: "Running fence and pin specs that test:changed does not select."
learned: '2026-10-11'
ref: urls/mem-josquin-9d2803d
enforcement: recognition
---
# Run guard specs by path

**When:** changing or moving code that a readFileSync spec pins.

## Why

`--changed` never selects specs that read source files; allowlists such as soleCreatePath EXEMPT pin code to a file.

## What to do

- Find them with `grep -rl <file> src --include=*.spec.ts` and run them by path, plus root src/*.spec.ts (e.g. unclassed-controls).
- Grep every spec for a file path before moving code; when code moves to a sibling, repeat negative pins there.

## What not to do

- Do not trust `test:changed` to cover fences.

(*MVOX:memkit*)
