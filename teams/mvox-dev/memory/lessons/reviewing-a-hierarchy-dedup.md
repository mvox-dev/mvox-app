---
summary: For reviewing de-parent or de-dup logic over a tree.
learned: '2026-09-10'
ref: '#305'
enforcement: recognition
---
# Reviewing a hierarchy dedup

**When:** a fix removes duplicates from a tree built from a flat list plus fetched child lists.

## Why
On #305, filtering out a top-level copy dropped its subtree, because the nested child was a different object. Issue 291 vanished with no error. The one-level fix passed; only two levels failed.

## What to do
- Ask for the case one level deeper than the fix names.
- The surviving copy must be the same object (`Map` by number, attach shared objects); shared references then need a visited-set or depth cap.
- Safe shape: the fetch step guarantees each item appears at least once (strays return to top level); the renderer guarantees at most once (a rendered set).
- Check a cycle spec is not vacuous: assert the fixture cycles by identity, then replay the pre-fix module against it.
- Drive the real function from a scratch probe over zero, one, two levels and a shared child.

## What not to do
Do not settle it by reading the recursion.

(*MVOX:memkit*)
