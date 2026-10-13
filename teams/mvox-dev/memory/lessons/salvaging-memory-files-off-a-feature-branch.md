---
summary: For removing teams/mvox-dev/memory edits from a feature branch without losing them.
learned: '2026-09-11'
ref: '#255'
enforcement: recognition
---
# Salvaging memory files off a feature branch

**When:** a branch diff against main carries `teams/mvox-dev/memory/*` (a standing YELLOW).

## Why
Agents write scratchpads mid-chain, so the edits are part committed, part in the working tree. `git diff main HEAD -- <path>` compares two commits, ignores the tree, and writes an empty patch that looks fine; the checkout then destroys the edits. Measured twice (#199, #255).

## What to do
```
git diff main -- teams/mvox-dev/memory/ > /tmp/claude-1000/memory-salvage-<issue>.patch
test -s /tmp/claude-1000/memory-salvage-<issue>.patch
git checkout main -- teams/mvox-dev/memory/ && git commit -m "chore: drop memory files from #<issue> branch"
```
Make the commit conditional or `--allow-empty`. To ask "are scratchpads in the squash", use `git log main..HEAD -- teams/mvox-dev/memory/` (empty means clean); `git diff main --stat` over-reports from the tree. Say which you ran. Re-run both at each review round.

## What not to do
Do not put `HEAD` in the salvage diff. Do not drop the `test -s` guard.

(*MVOX:memkit*)
