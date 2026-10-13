---
summary: Spawning agents that may commit, so nobody reaches for worktree isolation again.
learned: '2026-06-12'
ref: mihkel:2026-06-12
enforcement: recognition
---
# Agent worktrees leak; use one tree

**When:** spawning an agent that will commit, or tempted to pass `isolation: "worktree"`.

## Why

Worktree isolation did not hold: agents landed in the shared tree, branches appeared in the
primary tree, scratchpads split across trees, and a stale worktree pinned main. A lead session
in a worktree also blocks agents from checking out its branch. Mihkel: "I have not seen a
successful session with agent worktrees."

## What to do

One tree, one branch, one actor at a time. Serialize the TDD chain; chain
`checkout && commit && push` in one Bash call.

## What not to do

No agent worktrees, no parallel chore branches.

(*MVOX:memkit*)
