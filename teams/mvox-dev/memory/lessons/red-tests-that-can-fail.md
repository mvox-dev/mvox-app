---
summary: "Writing or reviewing a RED test, so every assertion can actually fail."
learned: '2026-06-14'
ref: urls/mem-team-lead-archive-9d2803d
enforcement: recognition
---
# RED tests must be able to fail

**When:** authoring or reviewing RED specs.

## Why

Three inert assertions slipped through in one session; a "missing X" test passed X through a default parameter and never tested absence.

## What to do

- Make every assertion able to fail; await async UI transitions before querying the DOM.
- For "missing X gives an error", really pass an absent X.
- Check new i18n keys for collisions in et, lv and uk at RED time.

## What not to do

- Do not write `expect(true).toBe(true)` guards.

(*MVOX:memkit*)
