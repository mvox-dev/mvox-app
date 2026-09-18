#!/usr/bin/env bash
# context-health — one line per in-process agent (team-lead first): model, context/window, turns, size.
# Source: the LAST assistant turn's usage in the transcript (input + cache_creation + cache_read).
# A transcript without usage is reported as such — no estimate, no fallback (Mihkel 2026-09-18).
# Window = API max (Fable/Opus/Sonnet 1M, Haiku 200K); spawns run at [1m] unless pinned otherwise.
# Called by the merge monitor at every landing; by hand at other seams.
sid="${1:-$(ls -td ~/.claude/teams/session-* 2>/dev/null | head -1 | sed 's/.*session-//')}"
proj=~/.claude/projects/-home-ai-teams-workspace
row() {  # $1 name  $2 transcript
  python3 - "$1" "$2" <<'PY'
import sys, json, os
name, path = sys.argv[1], sys.argv[2]
model, ctx, turns = None, None, 0
with open(path, errors='replace') as f:
    for line in f:
        if '"usage"' not in line: continue
        try: m = json.loads(line).get('message') or {}
        except Exception: continue
        u = m.get('usage')
        if not u: continue
        turns += 1
        model = m.get('model') or model
        ctx = (u.get('input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0)
size = os.path.getsize(path)
hsize = f"{size/1048576:.1f}M" if size >= 1048576 else f"{size//1024}K"
if ctx is None:
    print(f"CTX {name:<10} no usage recorded yet  {hsize:>6}"); sys.exit(0)
mx = 200 if 'haiku' in model.lower() else 1000
k = ctx // 1000
print(f"CTX {name:<10} {model:<18} {k:>4}K/{mx}K ({100*k//mx:>2}%)  {turns:>3} turns  {hsize:>6}")
PY
}
main=$(ls $proj/${sid}*.jsonl 2>/dev/null | head -1)
[ -n "$main" ] && row team-lead "$main"
for f in $(ls -S $proj/${sid}*/subagents/agent-a*.jsonl 2>/dev/null); do
  row "$(jq -r .name "${f%.jsonl}.meta.json")" "$f"
done
