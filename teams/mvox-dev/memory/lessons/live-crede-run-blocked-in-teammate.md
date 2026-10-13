---
summary: An authorized live crede run is classifier-blocked in a teammate, so it still gets run correctly.
learned: '2026-09-19'
ref: "#418"
enforcement: recognition
---
# Teammates keep auto mode after the lead goes manual

**When:** a data-manager teammate's authorized live crede command is "Blocked by classifier".

## Why

A subagent spawned under auto mode keeps it; switching the lead session to manual mode does not
reach the teammate. On #418 the same command passed from the lead session with a normal prompt.

## What to do

With the authorization recorded on the issue, ask Mihkel for manual mode and run the exact
briefed command from the lead session. Hand read-back and the ledger commit/PR back to the
data manager. This is an authorized op, not lead coding.

## What not to do

Do not retry in the teammate or rewrite the command to slip past the classifier.

(*MVOX:memkit*)
