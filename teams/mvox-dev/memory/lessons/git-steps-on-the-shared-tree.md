---
summary: For any git sequence that must stay on one branch in the team's shared working tree.
learned: '2026-05-22'
ref: '2026-05-22'
enforcement: recognition
---
# Git steps on the shared tree

**When:** creating a branch and committing, or committing to main, in the shared working tree.

## Why

Another agent can switch the branch between two Bash calls. A commit then lands on the wrong branch, and recovery costs a reset, stash and re-merge.

## What to do

- Make file edits first, then chain the git steps in one Bash call: checkout, add, commit, push, joined with &&.
- Start every main commit with an explicit checkout of main, even when HEAD seems to be there.
- Check git branch --show-current and git status in one chained call afterwards.

## What not to do

Do not spread checkout, commit and push over separate calls. Do not trust your memory of which branch is checked out.

(*MVOX:memkit*)
