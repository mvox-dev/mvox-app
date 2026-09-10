---
name: mvox-exit
description: End this session cleanly from inside — checkpoint first, arm the resident respawn loop, then type /exit into the session's own pane. Use at a planned seam (restart requested, work landed, tree on main) or when Mihkel says to exit. Invoke as /mvox-exit.
---

# mvox-exit — end the session from inside, at a seam

**Mechanism (proven 2026-09-10):** `tmux send-keys` into this session's own pane arrives exactly like typed user input. Sending `/exit` + Enter ends the session. **Respawn is automatic** when the resident loop is armed (below); without it, the `up` launcher's wake override (`~/.claude/up-wake` → `/mvox-wake`) reorients the next manually-launched session.

## The resident loop (adopted from Passepartout, consult 2026-09-10)

`~/.claude/mvox-resident.sh`, run as the sole command of a detached tmux session, supervises claude: launch in foreground → claude exits → sleep 5 → relaunch. The loop IS the supervisor. Flag protocol, all in `~/.claude/`:

- **`fresh-next`** — touch before a planned retirement: next launch is FRESH (no `--continue`), stale team dirs archived, wake skill fires in a clean context. Flag is consumed.
- absent → crash/plain exit: relaunch `--continue "/mvox-wake"` — conversation resumes, wake re-runs (it checks the live roster before spawning, so it is safe to re-fire).
- **`stay-down`** — touch to PARK: the loop exits entirely at the next iteration. Remove the flag and restart the resident to resume. This is the pause gesture under residency — exiting claude no longer parks the container.

Guards: a `--continue` that dies non-zero under 20s falls back once to fresh; `sleep 5` caps spin; DNS poll before first launch (remote MCP handshake). Log: `~/.claude/mvox-resident.log`.

**Container-boot integration** (starting the resident automatically at container start) is Passepartout's piece with Mihkel. Until it lands, the exit skill arms the resident per-exit (step 2 below).

## Preconditions — do not exit over live work

1. **No pipeline or workflow running.** A run dies with the session and `resumeFromRunId` does not survive restart. If one is live, wait for it to land or state why you are abandoning it.
2. **Tree on `main`, pushed.** `cd ~/workspace-app && git status -sb` — commit or explicitly hand off anything uncommitted.
3. **Checkpoint current.** The block atop `teams/mvox-dev/memory/team-lead.md` reflects the queue and open items; `task-list-snapshot.md` points at it; both committed.
4. **PO told.** One line to gama@po-team: seam declared, wake expected (or park declared, if `stay-down`).

## The exit

1. **Choose the flag.** Retirement (fresh context next): `touch ~/.claude/fresh-next`. Park (no respawn): `touch ~/.claude/stay-down`. Crash-style resume test only: neither.
2. **Arm the resident if not already running:**
   ```
   tmux has-session -t mvox-resident 2>/dev/null || tmux new-session -d -s mvox-resident "$HOME/.claude/mvox-resident.sh"
   ```
   The script's handover phase waits for THIS claude to end before launching the next — no second-claude race. Idempotent: if the resident session exists, skip.
3. **Say goodbye to Mihkel in your final message BEFORE sending** — the send is the last thing you do; nothing after it runs.
4. Send the exit. Preferred: `bash ~/.claude/skills/mvox-exit/self-exit.sh`. If the classifier blocks the script, run the two allowed commands directly (they carry explicit permission rules in `~/.claude/settings.json`):
   ```
   tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}'
   tmux send-keys -t <the claude pane> "/exit" Enter
   ```

**Never wire "kill/restart the tmux server or session" as the retirement gesture** — Passepartout's hard-won warning: it takes attached operator terminals down with it. Exit claude; let the loop respawn.

## Boundary

Self-injected input arrives labeled as user input. **Use this only to submit slash commands at a deliberate seam, on Mihkel's instruction or a checkpointed plan.** Never use it to answer your own questions, approve your own pending permission prompts, or manufacture consent — that is self-laundering, same class as the peer version.

(*MVOX:Palestrina*)
