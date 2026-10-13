---
summary: "Choosing how to do a one-off live op such as seeding, a probe or cleanup."
learned: '2026-05-20'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# One-off live ops as small scripts

**When:** a tactical live operation comes up mid-chain.

## Why

A five-line idempotent script and one live run replaced a new op kind plus a full RED/GREEN cycle.

## What to do

- Hand it to a specialist as a small idempotent script with its own run.

## What not to do

- Do not bake a one-off into the orchestrator.

(*MVOX:memkit*)
