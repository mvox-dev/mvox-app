---
summary: For when another agent's report conflicts with a clean read of my own.
learned: '2026-05-31'
ref: 'teams/mvox-dev/memory/architecture-decisions.md'
enforcement: recognition
---
# When team-lead contradicts my read

**When:** team-lead or another agent reports a value that conflicts with what I read.

## Why
I once dropped a correct blob read in favour of team-lead's report. The blob SHA was right; the social correction was wrong.

## What to do
Present the raw conflict plus a deterministic cross-check. Content hashes (`git rev-parse <ref>:<path>`, `git cat-file -p <blob>`, `git hash-object`) settle it, and survive a flaky output channel where rendered text does not.

## What not to do
Do not agree to be agreeable.

(*MVOX:memkit*)
