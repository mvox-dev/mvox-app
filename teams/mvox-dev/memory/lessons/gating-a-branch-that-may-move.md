---
summary: For running review gates on a shared tree where HEAD or the checkout can change under you.
learned: '2026-10-06'
ref: '#470'
enforcement: recognition
---
# Gating a branch that may move

**When:** running gates or reading diffs for a review on the shared tree.

## Why
Implementers commit mid-review even when told not to, and the tree can be checked out to another branch during a run. A mid-run flip does not show in the result: a 9-minute suite still printed a plausible count.

## What to do
- Re-derive the branch's real HEAD; never trust a SHA from a handoff.
- Capture `git rev-parse HEAD` and `git status -s` before AND after each gate run in the same command.
- When HEAD moves: stop your own background runs (TaskStop) before they touch the new tree, re-gate, and report the corrected SHA and count.
- Gate only the SHA the implementer confirms as final. Say out loud that review holds the tree.
- Read diffs from committed blobs (`git show <sha>:<path>`); untracked work shadows commit content.
- Run RED replays and gates one after another, never overlapping: a suite may import swapped bytes.

## What not to do
Do not read HEAD in a separate call from the gate. Do not use a worktree to test an old state.

(*MVOX:memkit*)
