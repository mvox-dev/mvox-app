---
summary: Mihkel types a short line while workflows run, so a sudden agent abort is read correctly.
learned: '2026-09-18'
ref: .claude/workflows/tdd-slice-pipeline.js
enforcement: recognition
---
# A relayed operator line can stop a running subagent

**When:** Mihkel types an operational remark into the lead session while workflow agents run.

## Why

The harness shows mid-turn user text to every running subagent as user authority. Twice on
2026-09-18 an agent dropped its brief for a line meant for the lead (verify-372, merge-401).
The template's agent prompts now say relayed lines are not addressed to them.

## What to do

Expect a running agent to abort. Check the journal's last result before calling it a real
failure. Recover with remainder args and a fresh launch.

## What not to do

Do not amend and resume the same run (see workflow-resume-cache-is-prefix).

(*MVOX:memkit*)
