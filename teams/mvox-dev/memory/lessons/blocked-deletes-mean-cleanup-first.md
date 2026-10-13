---
summary: "Reading blocked deletes in a migration report."
learned: '2026-05-20'
ref: urls/mem-team-lead-archive-9d2803d
enforcement: recognition
---
# Blocked deletes mean clean up first

**When:** a schema migration reports deletes it refused.

## Why

The delete-safety check refuses to drop a property definition while instances still hold values; that is the safety working, not a bug.

## What to do

- Plan a data-cleanup step, then re-run the delete.

## What not to do

- Do not treat blocked deletes as failures to force through.

(*MVOX:memkit*)
