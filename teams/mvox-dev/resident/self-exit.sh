#!/usr/bin/env bash
# self-exit.sh — type a command into this session's own claude pane and submit it.
# Default: /exit (ends the session cleanly). Usage: self-exit.sh [command]
#
# Pane discovery (fixed 2026-09-11, after the MVOX-20 break stalled on it):
# under the resident loop, claude is a CHILD of mvox-resident.sh, so the pane's
# pane_current_command is "bash", not "claude" — matching the command name finds
# nothing. Instead we walk this script's own process ancestry (it runs under the
# claude process) and pick the pane whose pane_pid is one of our ancestors.
# Works for both layouts: claude directly in a pane, or supervised by the loop
# (where the pane is normally mvox-resident:0.0). Do not trust $TMUX for this —
# it survives respawns stale.
set -euo pipefail
CMD="${1:-/exit}"

ancestors=" "
pid=$$
while [ -n "$pid" ] && [ "$pid" != "0" ] && [ "$pid" != "1" ]; do
  ancestors="$ancestors$pid "
  pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
done

PANE=""
while read -r pane ppid; do
  case "$ancestors" in
    *" $ppid "*) PANE="$pane"; break ;;
  esac
done < <(tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_pid}' 2>/dev/null)

[ -n "$PANE" ] || { echo "no pane holds this claude process (ancestry:$ancestors)" >&2; exit 1; }
tmux send-keys -t "$PANE" "$CMD" Enter
echo "sent '$CMD' to $PANE"
