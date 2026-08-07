# mvox-dev — Startup Checklist

Paths and step-by-step startup procedure for the mvox-dev team.

## Paths

All paths derived from two anchors:

| Anchor | How to resolve |
|---|---|
| `REPO` | `git rev-parse --show-toplevel` or the working directory |
| `TEAM_DIR` | `$HOME/.claude/teams/mvox-dev` (runtime, ephemeral) |

| Item | Path |
|---|---|
| Repo root | `$REPO/` |
| Team config dir | `$REPO/teams/mvox-dev/` |
| Runtime dir | `$TEAM_DIR/` |
| Roster | `$REPO/teams/mvox-dev/roster.json` |
| Common prompt | `$REPO/teams/mvox-dev/common-prompt.md` |
| Memory dir | `$REPO/teams/mvox-dev/memory/` |

## Startup Sequence

Execute in order. State each phase name before executing.

**Task scope (implicit teams).** The active task list is **session-scoped for the whole session** — `~/.claude/tasks/session-<id>/`. There is no `TeamCreate` and no mid-startup switch to a team-scoped list: verified 2026-08-05, no `~/.claude/tasks/mvox-dev/` exists, only `session-<id>` dirs. Tasks do **not** survive a restart, so cross-session continuity relies on the `memory/task-list-snapshot.md` shutdown/restore ceremony (Phase 4). It's still fine to defer formal `TaskCreate` until you're routing real work in Phase 4/5.

### Phase 0: Orient

Read these files in order:

1. This file (`startup.md`)
2. `roster.json` (roster — team members, models, roles)
3. `common-prompt.md` (mission, standards, shutdown protocol)
4. `memory/team-lead.md` (your scratchpad — prior session state)
5. `memory/task-list-snapshot.md` (prior session's task state, if exists)

**Expected outcome:** You know the team, the mission, and where you left off.

### Phase 1: Sync

```bash
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO" && git pull
```

**Expected outcome:** Prompts, roster, and memory files are at HEAD.

### Phase 2: Establish team

**Implicit teams** (CLI 2.1.211+, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, verified 2026-08-05). There is **no `TeamCreate`/`TeamDelete`** — those tools do not exist on this CLI — and the old State A/B/C probe-and-branch does not apply. There is nothing to create: the team is established automatically for the session. Ownership: each team reconciles its own startup/lifecycle docs against its own live CLI (ai-teams#105).

What to know instead:

- The runtime dir is `~/.claude/teams/session-<id>/` (verified 2026-08-05), **session-scoped and rotating on restart** — NOT a stable `~/.claude/teams/mvox-dev/` dir. `team_name: "mvox-dev"` passed to Agent/SendMessage is a cosmetic label.
- **Fresh CLI start:** you lead a fresh session team with no teammates. Nothing to create — proceed. You respawn teammates in Phase 5 (the restart-recovery duty — see ai-teams#102).
- **`/clear` (same process, warm):** teammates spawned earlier in this process may still be alive. Do not re-spawn blindly — Phase 5 checks the live roster first (`config.json` in the current session dir).

**Expected outcome:** you know you're under implicit teams; no team-creation step; whether teammates already exist determines what Phase 5 spawns.

**CRITICAL:** it's still fine to hold formal `TaskCreate` until you're routing real work (Phase 4/5) — see the task-scope note at the top of this file.

> `[unverified]` The exact cross-session **restore target paths** below (Phase 3 inbox restore, Phase 4 task restore) were written for the old stable `~/.claude/teams/mvox-dev/` runtime. Under a rotating `session-<id>` dir they need re-confirming against a live restart (which cannot be tested mid-session). The persistence *intent* — repo inboxes + task snapshot carry state across sessions — still holds; the concrete destination path is the open detail. Confirm on the next real restart before relying on the Phase 3 script verbatim.

### Phase 3: Restore inboxes

> `[unverified]` `TEAM_DIR` below still points at the old stable `~/.claude/teams/mvox-dev/`. Under implicit teams the live runtime is `~/.claude/teams/session-<id>/` (rotating). Before relying on this script, resolve the current session's dir and confirm the restore target — see the flag in Phase 2. The repo→runtime restore *intent* is unchanged; only the destination path is unconfirmed.

```bash
TEAM_CONFIG="$HOME/workspace-app/teams/mvox-dev"
TEAM_DIR="$HOME/.claude/teams/mvox-dev"

# Restore inboxes from repo (durable copy from prior session's shutdown)
if [ -d "$TEAM_CONFIG/inboxes" ]; then
  mkdir -p "$TEAM_DIR/inboxes"
  cp -r "$TEAM_CONFIG/inboxes/"* "$TEAM_DIR/inboxes/" 2>/dev/null || true
  echo "Inboxes restored from repo."
else
  echo "No inboxes to restore (first session or never persisted). This is OK."
fi

# Verify team is operational
if [ -f "$TEAM_DIR/config.json" ] && [ -d "$TEAM_DIR/inboxes" ]; then
  echo "Team mvox-dev operational: config.json OK, inboxes dir exists."
else
  echo "WARNING: Team infrastructure incomplete. Re-run Phase 2."
fi
```

**Note (warm `/clear` continuation):** inboxes from earlier in this same process may still be in the runtime dir. The `cp` above is idempotent — it overwrites runtime copies with the repo copies, which should be equal or newer (per shutdown protocol).

**Expected outcome:** Inboxes restored from repo (or no-op if first session). Team operational.

### Phase 4: Restore tasks (conditional)

**Skip if teammates are already alive from this same process** (a `/clear` warm continuation — the session task list is untouched).

**Run on a fresh CLI start** — the task list is session-scoped and starts empty, so `memory/task-list-snapshot.md` is the only source of prior task state. Recreate the active rows from it:

1. Read `teams/mvox-dev/memory/task-list-snapshot.md`.
2. For each non-completed row, call `TaskCreate(subject, description)` with the snapshot's subject + description verbatim.
3. Completed rows from the snapshot are NOT recreated. The recreated task list starts with fresh IDs; original numbering is lost — note this in your scratchpad if the originals are referenced anywhere (commits, PRs, prior agent messages).

**Expected outcome:** Active tasks from the prior session are visible to teammates. Lost ID numbering is acceptable collateral (closed-issue history lives in GitHub, not the local task list).

### Phase 5: Spawn

Spawn order:

1. **finn** + **bentham** (parallel — always-on roles, intros are independent) — wait for both intros before phase 2
2. **tallis** + **byrd** + **josquin** (parallel if working on independent issues)
3. **comenius** (only if i18n work is needed this session)
4. **victoria** (only if requirements analysis is needed this session)
5. **perotin** (only if seeding / data refresh / write-probe / data-quality work is needed this session — on-demand specialist)

Phase 1 is a gate: do not spawn implementer agents until finn + bentham have introed (research and review infrastructure must be ready).

**Before each spawn:** Check `config.json` for existing members with the same name.
- If agent already registered → `SendMessage` with the new task. Do NOT re-spawn.
- If agent not registered → Spawn via Agent tool with `run_in_background: true`.

**Spawn method depends on environment** (see `.claude/CLAUDE.md` "Spawn Method"):
- **Container:** use `spawn_member.sh` with the Pane Map.
- **Local:** use the `Agent` tool directly. The prompt is the content of `teams/mvox-dev/prompts/<name>.md`.

**Spawn checklist per agent:**

```
1. jq '.members[].name' "$HOME/.claude/teams/mvox-dev/config.json"  # check duplicates
2. Read prompt content from teams/mvox-dev/prompts/<name>.md
3. Spawn (env-specific method above) with name="<name>", team_name="mvox-dev", run_in_background=true
4. Wait for intro message from agent
```

### Phase 6: Ready

Send ready message to user. Wait for task assignment.

---

## Known Environment Issues

### Common (both envs)

- **Implicit teams — no `TeamCreate`/`TeamDelete`** (CLI 2.1.211+). The old "TeamCreate silent failure / verify config.json / retry with TeamDelete" workaround is obsolete; there is nothing to create or retry. See Phase 2.
- **pnpm, not npm** — this is a pnpm workspace. All commands use `pnpm`.

### Container env

- Runs inside a Docker container (Ubuntu 24.04). `$HOME=/home/ai-teams`, app repo at `/home/ai-teams/workspace-app`, schema repo at `/home/ai-teams/workspace`.
- **`$HOME` edge case:** If `$HOME` is empty in any shell context, re-resolve: `HOME="/home/ai-teams"`.
- Pane Map applies — see `.claude/CLAUDE.md` "Container Pane Map".
- Spawn via `spawn_member.sh`.

### Local env

- `$HOME=/home/<user>` (no rewrite needed). Workspace path: resolve via `REPO="$(git rev-parse --show-toplevel)"`.
- No tmux Pane Map. Spawn agents via the `Agent` tool with `run_in_background: true`, `name: "<name>"`, `team_name: "mvox-dev"`. The agent's prompt is the content of `teams/mvox-dev/prompts/<name>.md`.

(*FR:Volta*) — Phase 2 / task-scope / known-issues reconciled to implicit teams 2026-08-05 per ai-teams#105 (*MVOX:Palestrina*)
