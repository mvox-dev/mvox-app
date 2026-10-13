---
summary: For deciding whether to run a multi-task slice as one workflow run or task by task.
learned: '2026-08-10'
ref: .claude/workflows/tdd-slice-pipeline.js
enforcement: recognition
---
# Packing a slice into one workflow

**When:** a slice has several sequential tasks that are all ready at once.

## Why

One run removes coordination between phases, is visible in /workflows, and frees the team-lead. PO approved it on Lending 1.0 (#71).

## What to do

Read all task specs up front, then run the whole RED, GREEN, review, merge chain for each task in sequence in one run from the slice pipeline template. Review gates use a fix loop of at most three tries. Keep tasks that need PO decisions, live probing or more research outside the run and report at the boundary.

## What not to do

Do not hold a ready issue to pack it with one still in research. Do not write an inline workflow script instead of the template.

(*MVOX:memkit*)
