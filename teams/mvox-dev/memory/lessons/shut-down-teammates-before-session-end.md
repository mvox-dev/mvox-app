---
summary: For ending a session or restarting the team without leaving teammate processes running.
learned: '2026-06-01'
ref: urls/mem-team-lead-archive-9d2803d
enforcement: recognition
---
# Shut teammates down before the session ends

**When:** a session is about to end or restart while teammates are spawned.

## Why

Clearing a teammate's config does not stop its process. Live teammates kept writing to inboxes after the team was rebuilt.

## What to do

Send a `shutdown_request` to every active teammate and wait for each to confirm before ending the session.

## What not to do

Do not edit runtime team config by hand to remove a teammate that is still running.

(*MVOX:memkit*)
