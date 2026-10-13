---
summary: "Reviewing a new Entu verb+path that mocks pass but no live call has exercised."
learned: '2026-05-20'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# An unverified wire shape is YELLOW

**When:** review of code calling an Entu endpoint not yet exercised live.

## Why

A mock test matched the URL substring and passed; live Entu answered 404 for that endpoint.

## What to do

- Require a documented probe, or mark "wire shape unverified" YELLOW until the first live run.

## What not to do

- Do not give GREEN on passing mocks alone for a new wire shape.

(*MVOX:memkit*)
