---
summary: For when an agent inside a running workflow sends the team-lead a message.
learned: '2026-08-13'
ref: mihkel:2026-08-13
enforcement: recognition
---
# A workflow subagent messages the lead

**When:** an agent inside a tdd-slice-pipeline run sends a message to the team-lead.

## Why

A SendMessage reply into a running workflow agent breaks the workflow.

## What to do

Let the agent handle it or fail. Step in after the run resolves, by routing the fix to a teammate
or a fresh run.

## What not to do

- Do not SendMessage-reply to the workflow agent.
- Do not fix the work yourself; team-lead coding is forbidden.

(*MVOX:memkit*)
