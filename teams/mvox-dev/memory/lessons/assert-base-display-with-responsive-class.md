---
summary: "Testing elements with sm:/md:/lg: display classes, since jsdom cannot compute layout."
learned: '2026-05-31'
ref: urls/mem-team-lead-archive-9d2803d
enforcement: recognition
---
# Assert the base display class too

**When:** a component carries a responsive display class or a single-axis overflow clip.

## Why

jsdom cannot see computed display. Two bugs shipped with the responsive class present but no base `hidden`, and an overflow-x clip that forced overflow-y on a dropdown host.

## What to do

- Assert the base `hidden` (or correct default) alongside any sm:/md:/lg: display class.
- Treat a single-axis overflow clip on a dropdown or popover host as RED.

## What not to do

- Do not accept the responsive class alone as proof of layout.

(*MVOX:memkit*)
