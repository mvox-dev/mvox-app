---
summary: For reviewing PRs built from a prescriptive brief, especially by Sonnet.
learned: '2026-10-09'
ref: '#866'
enforcement: recognition
---
# Reviewing Sonnet-built PRs

**When:** reviewing a PR built from a brief.

## Why
The brief steers the result more than the model. Where #866's brief left a detail open, the child wrote state directly while its neighbour used a callback.

## What to do
Check every point the brief left open for drift from the surrounding code. Recompute line counts and the ratio from the branch every round; fix rounds leave the PR body stale.

## What not to do
Do not trust PR body numbers after a fix round.

(*MVOX:memkit*)
