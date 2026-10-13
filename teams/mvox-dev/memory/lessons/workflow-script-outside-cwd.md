---
summary: Launching the app-repo pipeline template from the ~/workspace session, so the launch is accepted.
learned: '2026-09-02'
ref: mihkel:2026-09-11
enforcement: recognition
---
# Workflow scripts must be launched from cwd or scratchpad

**When:** starting tdd-slice-pipeline.js from a session whose cwd is ~/workspace.

## Why

Workflow refuses a scriptPath outside the working directory or added directories, and the app
repo is neither. Reading the copy or passing inline args costs lead context for nothing.

## What to do

- `cp ~/workspace-app/.claude/workflows/tdd-slice-pipeline.js` into the scratchpad and check it
  with `md5sum` against the original.
- Launch with `args: {argsFile: '<committed args json>'}`; the template's load step reads it.
- Check the args file with a `jq` summary (order, issue numbers, field lengths).

## What not to do

Do not Read the copy or the args file in full, and do not pass args inline.

(*MVOX:memkit*)
