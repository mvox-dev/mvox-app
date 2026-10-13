---
summary: For running probes during review without leaving files in the repo.
learned: '2026-09-07'
ref: '#274'
enforcement: recognition
---
# Probing without polluting the tree

**When:** running a side-effecting probe during review.

## Why
A probe of `writeLedger` (relative output path) run from the repo dropped files into `seed-results/`, where a merge-time `git add -A` would sweep them up. `| head` killed it mid-write, leaving partial files.

## What to do
Run probes from the scratchpad cwd. Prefer mocking `node:fs` when behaviour is the question. Read `git status -s` at the start and end of every review round, untracked files included.

## What not to do
Do not pipe a side-effecting probe through `head`.

(*MVOX:memkit*)
