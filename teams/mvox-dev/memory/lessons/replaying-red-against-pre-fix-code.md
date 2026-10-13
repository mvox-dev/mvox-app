---
summary: For proving a new test really fails on the old code.
learned: '2026-10-10'
ref: '#875'
enforcement: recognition
---
# Replaying RED against pre-fix code

**When:** checking a pin is RED-first or load-bearing.

## Why
RED and GREEN commits seconds apart prove nothing. A RED spec can fail only on a class pin while the behaviour it claims already held.

## What to do
- Revert at file granularity (`git checkout <pre> -- <src files>` or `git show <c> -- f | git apply -R`); when later commits touched the same modules, revert the set together.
- Check out each RED commit and run its spec.
- It must fail on an assertion. A timeout or module error proves nothing.
- Read which assertion fails on main and whether it tests behaviour, not a class.

## What not to do
Do not use a worktree. Do not replay while a suite is running.

(*MVOX:memkit*)
