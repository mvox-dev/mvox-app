---
summary: For deciding whether a fixture row the code never reads can be dropped.
learned: '2026-10-05'
ref: '#715'
enforcement: recognition
---
# Approving removal of an unread fixture row

**When:** a PR drops fixture data as dead.

## Why
On #715 the dropped `organization` `_parent` row was the decoy that made a positional `parents[0]` read fail; without it, 0 failures instead of 26.

## What to do
Mutate the reader to ignore its type filter and replay against main's spec before approving.

## What not to do
Do not equate "unread" with "unneeded".

(*MVOX:memkit*)
