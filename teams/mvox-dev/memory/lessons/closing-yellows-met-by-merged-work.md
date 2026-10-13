---
summary: For the shutdown sweep of open follow-up issues that merged work already satisfied.
learned: '2026-05-22'
ref: mihkel:2026-05-22
enforcement: recognition
---
# Closing follow-ups that merged work already met

**When:** shutting down a session (or with spare time mid-session).

## Why

A YELLOW or follow-up whose number was not in a merge's `Closes #N` stays open after its work
shipped. Mihkel saw them pile up; they read as open work and invite re-work.

## What to do

- Scan `gh issue list --state open` for issues whose fire-trigger ("fires when X lands") a merge has met.
- Close each by hand with a comment naming the merge SHA.
- Going forward, list subsumed issues at dispatch and put a `Closes #N` for each in the squash body.

## What not to do

Do not close on a guess; the trigger must actually be met by a named merge.

(*MVOX:memkit*)
