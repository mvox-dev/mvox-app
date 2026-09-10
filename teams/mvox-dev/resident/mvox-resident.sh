#!/usr/bin/env bash
# mvox-resident.sh — claude respawn loop for the mvox container.
#
# Adapted from Passepartout's passe-resident.sh (consult 2026-09-10): the
# loop IS the supervisor. Runs as the sole command of a detached tmux
# session; launches claude in the foreground; when claude exits (quit,
# crash, retirement) the loop relaunches it after a short pause. Operators
# attach with `tmux attach -t mvox-resident` (or `up`, which attaches to
# any existing session rather than double-launching).
#
# Retire-vs-resume protocol (Passepartout's .fresh-next, verbatim):
#   ~/.claude/fresh-next  present -> next launch is FRESH (no --continue),
#                         flag consumed. The /mvox-exit skill touches this
#                         before a planned retirement.
#   absent                -> crash/plain exit: relaunch with --continue so
#                         the conversation resumes, wake skill re-runs.
#   ~/.claude/stay-down   present -> loop exits entirely (park the
#                         container). Remove the flag and rerun this script
#                         (or reboot integration) to resume residency.
#
# Crash-loop guards (Passepartout's two layers): a --continue that dies
# non-zero in under 20s falls back ONCE to a fresh start; sleep 5 between
# iterations caps the spin rate. DNS poll before first launch so remote MCP
# connectors do not fail their handshake on cold boot.
#
# (*MVOX:Palestrina*)
set -u

WORKSPACE="$HOME/workspace"
CLAUDE_BIN="$HOME/.local/bin/claude"; [ -x "$CLAUDE_BIN" ] || CLAUDE_BIN="claude"
TEAM="${TEAM:-${HOSTNAME:-mvox}}"
ENV_ID="$(printf '%s' "$TEAM" | tr '[:lower:]' '[:upper:]')"
FRESH_FLAG="$HOME/.claude/fresh-next"
HOLD_FLAG="$HOME/.claude/stay-down"
WAKE_FILE="$HOME/.claude/up-wake"
LOG="$HOME/.claude/mvox-resident.log"

log() { printf '%s resident: %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

claude_running() {
    # Same conservative /proc scan as /usr/local/bin/up (#102): comm match
    # only — any match means a live claude we must not race.
    local cmdfile comm
    for cmdfile in /proc/[0-9]*/comm; do
        IFS= read -r comm <"$cmdfile" 2>/dev/null || continue
        [ "$comm" = "claude" ] && return 0
    done
    return 1
}

archive_stale_team_dirs() {
    # Only ever called when no claude is running (fresh launch path).
    local teams_dir="$HOME/.claude/teams" archive_dir="$HOME/.claude/teams-archive" d dest stamp
    [ -d "$teams_dir" ] || return 0
    stamp="$(date +%Y%m%dT%H%M%S)"
    shopt -s nullglob
    for d in "$teams_dir"/session-*; do
        mkdir -p "$archive_dir"
        dest="$archive_dir/$(basename "$d").$stamp"
        mv -T "$d" "$dest" && log "archived stale team dir $d -> $dest"
    done
    shopt -u nullglob
}

wake_input() {
    local w=""
    if [ -f "$WAKE_FILE" ]; then IFS= read -r w <"$WAKE_FILE" || true; fi
    printf '%s' "${w:-/mvox-wake}"
}

launch_fresh() {
    archive_stale_team_dirs
    local session_name wake
    wake="$(wake_input)"
    session_name="$TEAM $(date '+%d.%m %H:%M')"
    log "fresh launch (wake: $wake)"
    ( cd "$WORKSPACE" && env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
        CLAUDE_ENV_ID="$ENV_ID" "$CLAUDE_BIN" --name "$session_name" "$wake" )
}

launch_continue() {
    local wake
    wake="$(wake_input)"
    log "continue launch (wake: $wake)"
    ( cd "$WORKSPACE" && env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
        CLAUDE_ENV_ID="$ENV_ID" "$CLAUDE_BIN" --continue "$wake" )
}

# --- handover: if a claude is already alive (resident armed from inside a
# live session, e.g. by /mvox-exit just before sending /exit), wait for it
# to end rather than racing a second claude beside it.
if claude_running; then
    log "live claude detected at start — waiting for it to end (handover)"
    while claude_running; do sleep 5; done
    log "handover complete — prior claude gone"
fi

# --- DNS wait (remote MCP handshake), up to ~2 min ---------------------------
for _ in $(seq 1 24); do
    getent hosts api.anthropic.com >/dev/null 2>&1 && break
    sleep 5
done

# --- the loop ----------------------------------------------------------------
while true; do
    if [ -e "$HOLD_FLAG" ]; then
        log "stay-down flag present — parking (loop exits; remove $HOLD_FLAG and restart to resume)"
        exit 0
    fi

    if [ -e "$FRESH_FLAG" ]; then
        rm -f "$FRESH_FLAG"
        launch_fresh
        rc=$?
        log "claude exited rc=$rc (was fresh)"
    else
        start_ts=$(date +%s)
        launch_continue
        rc=$?
        dur=$(( $(date +%s) - start_ts ))
        log "claude exited rc=$rc after ${dur}s (was continue)"
        if [ "$rc" -ne 0 ] && [ "$dur" -lt 20 ]; then
            # Wedged/absent resume — fall back once to fresh instead of
            # hammering --continue (Passepartout guard a).
            log "continue died fast — one-shot fresh fallback"
            launch_fresh
            rc=$?
            log "claude exited rc=$rc (fallback fresh)"
        fi
    fi

    sleep 5
done
