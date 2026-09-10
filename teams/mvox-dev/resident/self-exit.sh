#!/usr/bin/env bash
# self-exit.sh — type a command into this container's claude pane and submit it.
# Default: /exit (ends the session cleanly). Usage: self-exit.sh [command]
# Proven 2026-09-10: send-keys into own pane arrives as user input.
set -euo pipefail
CMD="${1:-/exit}"
PANE="$(tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}' | awk '$2=="claude"{print $1; exit}')"
[ -n "$PANE" ] || { echo "no claude pane found" >&2; exit 1; }
tmux send-keys -t "$PANE" "$CMD" Enter
echo "sent '$CMD' to $PANE"
