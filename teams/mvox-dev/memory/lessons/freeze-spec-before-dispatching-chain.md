---
summary: "Changing a spec while a TDD chain is already running on it."
learned: '2026-05-31'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# Freeze the spec before dispatching the chain

**When:** about to dispatch RED, or tempted to edit the spec after dispatch.

## Why

A spec restructure after RED was dispatched made the chain run the old structure first: duplicate i18n keys, wrong headings, and about three times the expected churn.

## What to do

- Freeze the spec before RED.
- If a change is unavoidable, pause the chain and re-sync every downstream agent before anyone commits.

## What not to do

- Do not let a spec update chase a moving branch.

(*MVOX:memkit*)
