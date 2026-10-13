---
summary: For asking a human for help when a command is blocked during routine local cleanup.
learned: '2026-09-15'
ref: mihkel:2026-09-15
enforcement: recognition
---
# Blocked command: ask for clearance only

**When:** a routine fix on unpushed local state (preserve, reset, verify, re-squash) hits a blocked command.

## Why

That fix loses nothing and asks no product question, so the decision is the team-lead's. Only clearing the block needs a human. On #357 Mihkel said the decision "was Palestrina's job".

## What to do

Decide first, then ask in the shape: "I have decided to do X; the command is blocked; I need it cleared."

## What not to do

Do not hand up the situation with "what should we do?".

(*MVOX:memkit*)
