---
summary: For a shell where $HOME comes up empty and paths under ~ stop resolving.
learned: '2026-08-05'
ref: teams/mvox-dev/startup.md
enforcement: recognition
---
# $HOME is empty in a shell

**When:** a command fails because `~` or `$HOME` expands to nothing.

## Why

Some shell contexts in the container start without `$HOME`. Every repo path is under `/home/ai-teams`.

## What to do

Set `HOME=/home/ai-teams` in that shell, then re-run.

## What not to do

Do not hard-code another user's home from old notes.

(*MVOX:memkit*)
