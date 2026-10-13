---
summary: Recovering or amending a halted workflow run, so finished steps do not re-run live.
learned: '2026-09-11'
ref: .claude/workflows/tdd-slice-pipeline.js
enforcement: recognition
---
# Workflow resume cache is prefix-based

**When:** a workflow halted mid-pack and you want to resume or amend it.

## Why

`resumeFromRunId` replays the longest unchanged prefix of agent() calls; the first edited call
and everything after it runs live. Editing the early args-load call re-ran every finished slice
(a stale RED for merged #323 ran against main). Not editing it serves the old args from cache.

## What to do

Write a remainder args file: drop landed tasks, amend the halted task (`skipRed: true` if its
RED is committed, check out the existing branch first), and launch fresh.

## What not to do

Do not amend and resume. Late-step edits resume only if every earlier call is byte-identical.

(*MVOX:memkit*)
