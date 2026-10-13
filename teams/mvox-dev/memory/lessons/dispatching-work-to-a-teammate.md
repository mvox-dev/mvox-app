---
summary: For ordering the brief and the task-owner update when handing work to a teammate.
learned: '2026-05-22'
ref: '2026-05-22'
enforcement: recognition
---
# Dispatching work to a teammate

**When:** assigning a task to a teammate with TaskUpdate.

## Why

Setting a task owner sends that agent an automatic notice with the bare task text. If it arrives before the brief, the agent acts on the bare text. Once Tallis wrote 29 RED specs for the opposite architecture before the brief landed.

## What to do

Send the SendMessage brief first, then set the owner (or send both in one tool-call batch). In a multi-phase chain, keep one stable owner and move phases with SendMessage handoffs.

## What not to do

Do not change the task owner at every phase: each change re-sends the original description to the next agent.

(*MVOX:memkit*)
