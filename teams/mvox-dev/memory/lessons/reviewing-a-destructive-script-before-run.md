---
summary: For deciding whether a data script needs review before it runs live.
learned: '2026-08-07'
ref: teams/mvox-dev/prompts/perotin.md
enforcement: recognition
---
# Destructive scripts get review before they run

**When:** a data script bulk-deletes or otherwise destroys data.

## Why

Low-risk reversible scripts are reviewed after writing; deletes cannot be undone, so the review
has to come first.

## What to do

Get Bentham's review before the live run (the team-lead routes it), then still wait for the
explicit authorization.

## What not to do

Do not treat the review as authorization.

(*MVOX:memkit*)
