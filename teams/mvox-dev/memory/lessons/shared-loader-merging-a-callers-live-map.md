---
summary: For reviewing a shared loader that merges into a caller's live map.
learned: '2026-10-01'
ref: '#596'
enforcement: recognition
---
# Shared loader merging a caller's live map

**When:** a shared loader merges against each caller's live map.

## Why
It is one rule only if every caller's map holds the same thing. A page map still holding its page-load read brought back records cleared elsewhere (#596).

## What to do
Probe in /tmp: page load sees X, the server drops X, then open the panel.

## What not to do
Do not assume callers' maps are alike.

(*MVOX:memkit*)
