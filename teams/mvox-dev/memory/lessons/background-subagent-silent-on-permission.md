---
summary: For a spawned agent that goes silent after being told to use WebFetch or an MCP tool.
learned: '2026-05-21'
ref: urls/claude-code-issue-61315
enforcement: recognition
---
# Background subagent silent on a permission prompt

**When:** briefing a background agent to use a tool that needs a permission grant (WebFetch, most MCP tools), or that agent has gone quiet.

## Why

The agent's permission request does not reach the lead's screen. The agent is alive and waiting, but looks dead. Seen twice with Comenius (28 and 58 minutes). Filed upstream: urls/claude-code-issue-61315.

## What to do

- Before spawning: pre-allow the tool in settings, keep the agent on ungated tools (Bash, Read, Grep), or do the gated work yourself.
- Quiet for over 5 minutes after such a spawn: assume a permission block. Probe with SendMessage; if no reply in 2-3 minutes, ask Mihkel to check for a pending prompt.

## What not to do

Do not blame the spawn prompt's wording, and do not respawn a duplicate before checking for a pending prompt.

(*MVOX:memkit*)
