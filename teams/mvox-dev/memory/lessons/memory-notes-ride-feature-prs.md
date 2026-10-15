---
summary: For an implementer whose own memory notes go in its feature PR.
learned: '2026-10-15'
ref: '#931'
enforcement: recognition
---
# Memory notes that ride a feature PR

**When:** an implementer's josquin.yaml rows go in with its feature branch (§E, 2026-10-15).

## Why
CI runs the memory lint on every PR. On #931 one 111-character row failed it after review was GREEN, and the merge waited a fix round.

## What to do
Run `sh memory-kit/lint/memory-lint.sh . --gate` before every push that touches a memory file, and put that line in each brief's gate list.

## What not to do
Do not count the suite and `pnpm check` as the whole gate when a memory file is in the diff.

(*MVOX:Palestrina*)
