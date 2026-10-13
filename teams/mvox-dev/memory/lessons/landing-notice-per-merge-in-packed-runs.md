---
summary: For sending a landing notice for each merge while one pipeline run lands several issues.
learned: '2026-09-10'
ref: teams/mvox-dev/memory/session-mvox19-pickup-log.md
enforcement: recognition
---
# Landing notice per merge in packed runs

**When:** a packed pipeline run will merge more than one issue to main.

## Why

Notices sent only at run boundaries missed two merges (#303, #309) for hours; the PO board showed them as still in process.

## What to do

At every session or pipeline start, arm a watch on origin/main that fires per merge commit, and send the one-line notice to Gama when each merge lands. Then clear its label.

## What not to do

Do not batch notices to the end of the run. Do not skip re-arming the watch after a restart.

(*MVOX:memkit*)
