---
summary: For reviewing a module whose header states a pagination rule.
learned: '2026-09-10'
ref: '#305'
enforcement: recognition
---
# Checking every endpoint against stated pagination

**When:** a module header explains how it paginates.

## Why
In `scripts/roadmap/fetch-issues.ts` one function paginated and its neighbour (sub-issues, default 30 per page) did not. A stated rule reads as covering the whole file.

## What to do
Check every endpoint the module calls against the stated rule.

## What not to do
Do not check only the endpoint the comment discusses.

(*MVOX:memkit*)
