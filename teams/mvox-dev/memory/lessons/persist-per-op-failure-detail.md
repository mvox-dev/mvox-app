---
summary: "Designing a script that continues after failures, so its report keeps per-op errors."
learned: '2026-05-20'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# Persist per-op failure detail

**When:** writing a migration or orchestration script with continue-on-failure.

## Why

A run with 15 of 44 failures recorded only the count; finding the three root causes took about 40 minutes instead of 5.

## What to do

- Serialize each failed op with its error into the report.

## What not to do

- Do not report summary counts alone.

(*MVOX:memkit*)
