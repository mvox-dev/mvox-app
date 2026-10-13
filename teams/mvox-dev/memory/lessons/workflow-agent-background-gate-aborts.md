---
summary: Writing workflow agent prompts, so gates run in the foreground and the pipeline does not abort.
learned: '2026-09-18'
ref: .claude/workflows/tdd-slice-pipeline.js
enforcement: recognition
---
# A workflow agent that backgrounds a gate aborts the pipeline

**When:** writing or reviewing prompts for workflow agents that run tests or builds.

## Why

A subagent's turn ends when it stops calling tools; a background task re-invokes only the
parent. A GREEN agent ran `pnpm test` in the background, said it would wait, and ended without
StructuredOutput, aborting the run and leaving uncommitted edits. The template now prefixes
prompts with TURN DISCIPLINE.

## What to do

Keep the TURN DISCIPLINE prefix on every agent prompt: foreground gates, no pause-and-wait, end
only after StructuredOutput. Recover with remainder args and a fresh launch.

## What not to do

Do not write a workflow prompt that allows run_in_background.

(*MVOX:memkit*)
