---
summary: "Committing in the single shared working tree while others may be on a feature branch."
learned: '2026-05-20'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# Guard the branch in the shared working tree

**When:** any commit, push or branch operation in the shared tree.

## Why

All agents share one git working tree. A checkout to main mid-chain switched the branch under an implementer; an agent once committed onto another agent branch.

## What to do

- Run `git branch --show-current` in the same Bash call as the commit; chain checkout, commit and push in one call.
- If the branch is not the expected one, stop and report branch, status and log; do not switch, stash or work around.

## What not to do

- Do not `git checkout main` while an implementer has uncommitted work.

(*MVOX:memkit*)
