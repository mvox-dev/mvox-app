---
summary: For deciding what to do when the auto-mode classifier blocks a command.
learned: '2026-09-12'
ref: mihkel:2026-09-12
enforcement: recognition
---
# Classifier block: reword or escalate

**When:** a command comes back "Blocked by classifier".

## Why

Some blocks are about form (compound command, wrong tool); rewording fixes them. Others are about
permission or a threat category; going around those, even when the classifier is wrong, was
retired as process (merge-318, research-343). Mihkel prefers to switch to manual mode and approve directly.

## What to do

- Form block: split the command, use the dedicated tool, rephrase.
- Permission or threat block: stop, state what was blocked and why it is needed, ask for manual
  mode (teammates report to the team-lead, who tells Gama). After the switch, re-run it unchanged.
- State the decision already made; ask only for clearance (see blocked-command-ask-for-clearance-only).

## What not to do

- Do not retry a threat-shaped action split into smaller pieces.
- Do not fix the stated concern and retry.

(*MVOX:memkit*)
