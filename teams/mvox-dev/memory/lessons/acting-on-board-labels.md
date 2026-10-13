---
summary: For setting motion labels on issues, and for reading labels before deciding to act.
learned: '2026-09-09'
ref: mihkel:2026-09-09
enforcement: recognition
---
# Acting on board labels

**When:** setting `in research` / `in process` / `prepped`, or deciding to dispatch from what the labels say.

## Why

Mihkel reads the board live, so a label must state what already happened. `gh issue list --label`
reads a lagging search index in both directions: an in-flight issue can show as idle and invite a
second dispatch.

## What to do

- Set a label only after the step it names succeeded (dispatch done, args written, notice sent).
- Before acting on a label, confirm that issue with `gh issue view N`.

## What not to do

- Do not label ahead of the fact.
- Do not decide from a label-filtered list alone (see ready-label-sweep-returns-zero).

(*MVOX:memkit*)
