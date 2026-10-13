---
summary: "Writing an authorization or brief for a live run, so it carries only what the PO directed."
learned: '2026-06-15'
ref: urls/mem-team-lead-archive-9d2803d
enforcement: recognition
---
# Keep your own assumptions out of an authorization

**When:** drafting the authorization message for a live-mutating run.

## Why

An extra guard slipped into an authorization contradicted the schema and had to be reverted; the PO had not asked for it.

## What to do

- Authorize exactly what was directed.
- Check any guard you want to add against the schema, then raise it separately.

## What not to do

- Do not bundle an untested assumption into the authorized scope.

(*MVOX:memkit*)
