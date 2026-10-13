---
summary: "After a merge whose body says Closes #N, confirming the issue really closed."
learned: '2026-05-31'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# Check the issue closed after merge

**When:** a squash merge with `Closes #N` has landed.

## Why

Auto-close via squash-push was inconsistent: one issue closed, another stayed open.

## What to do

- Run `gh issue view N` after merge; close it by hand if still open.

## What not to do

- Do not assume the trailer closed it.

(*MVOX:memkit*)
