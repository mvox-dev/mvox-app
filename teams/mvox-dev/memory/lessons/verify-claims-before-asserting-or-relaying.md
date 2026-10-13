---
summary: "Checking a SHA, count, error or agent report yourself before you assert it or act on it."
learned: '2026-05-31'
ref: urls/mem-team-lead-archive-9d2803d
enforcement: recognition
---
# Verify before asserting or relaying

**When:** an agent reports an identifier, a gate count, a prod state or an external-system fault, or you are about to state one.

## Why

Agents have reported fabricated SHAs, test counts and review verdicts. A "stale key 401" was a wrong key in the agent shell; the real key returned 200. The cheap local check usually resolves what a rotation or escalation would not.

## What to do

- Run your own git or curl check in the same turn before asserting.
- Settle byte disputes with `git rev-parse <sha>:<path>` and `git cat-file -p <blob>`.
- Before a commit, have the agent show `git diff --cached --name-only` and confirm the file set.
- Before recommending key rotation or escalation, reproduce the fault locally.

## What not to do

- Do not relay an agent claim as fact.
- Do not send "verified" before the tool result has returned.

(*MVOX:memkit*)
