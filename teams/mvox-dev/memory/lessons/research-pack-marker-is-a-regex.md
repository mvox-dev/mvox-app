---
summary: Writing markers for a research-pack run, so the contract pin does not fail on regex characters.
learned: '2026-10-02'
ref: .claude/workflows/research-pack.js
enforcement: recognition
---
# The research-pack marker is a regex

**When:** passing `marker` values to research-pack.js.

## Why

The contract pin checks the issue body with jq `test(marker)`, so the marker is a regex. Gama's
`[500] ...` sluglines failed 7 of 8 pins: the brackets became a character class. A failed pin
stops the agent before any research, wasting the run.

## What to do

Pass markers without regex metacharacters (drop prefixes like `[500] `), or change the template
to a literal match at a seam.

## What not to do

Do not copy a slugline into a marker verbatim without scanning it for `[ ] ( ) . * + ? ^ $ |`.

(*MVOX:memkit*)
