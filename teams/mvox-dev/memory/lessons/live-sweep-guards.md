---
summary: "Guarding a live write sweep and its ledger against drift and false success."
learned: '2026-09-15'
ref: teams/mvox-dev/memory/perotin.md
enforcement: recognition
---
# Live sweep guards

**When:** writing or running a script that writes to many live entities.

## Why

Populations drift between runs, a write count can diverge from what landed, and a foreign `_owner` means someone else holds the row.

## What to do

- Hardcode the population snapshot and diff live re-reads every run, naming each delta.
- Touch one canary row first; throw if it fails.
- Scan `_owner` for non-db-root holders before writing; abort if found.
- Name ledger fields by what they attest (intended vs read back); keep one current artifact per script.
- Take the done-signal from the post-verify population total (Gama, #369).

## What not to do

- Do not call a remedy run done on its write count.

(*MVOX:memkit*)
