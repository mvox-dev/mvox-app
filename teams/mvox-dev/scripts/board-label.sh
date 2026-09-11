#!/usr/bin/env bash
# board-label.sh — procedural board-state transitions (label contract v2).
#
# Usage: board-label.sh <issue> research|prepped|enter|land
#
# Encodes the contract (Mihkel 2026-09-09/10, made procedural 2026-09-11):
#   research : + "in research"                      (research dispatch)
#   prepped  : + "prepped"  - "in research"          (research landed + args authored)
#   enter    : + "in process" - "prepped" - "in research"   (slice enters a run)
#   land     : - all three                           (after the landing notice)
# `ready` is never touched — it stays on throughout and is PO-owned.
#
# After the transition, if the issue is a native sub-issue of an epic, the
# epic's mirror label is recomputed: highest active tier among its OPEN
# sub-issues (in process > prepped > in research > none) — the
# epic-label-mirrors-tasks rule, no longer recomputed by hand.
set -euo pipefail
cd "$HOME/workspace-app"
N="${1:?issue number}"
T="${2:?transition: research|prepped|enter|land}"

case "$T" in
  research) gh issue edit "$N" --add-label "in research" >/dev/null ;;
  prepped)  gh issue edit "$N" --add-label "prepped" --remove-label "in research" >/dev/null ;;
  enter)    gh issue edit "$N" --add-label "in process" --remove-label "prepped" >/dev/null
            gh issue edit "$N" --remove-label "in research" >/dev/null 2>&1 || true ;;
  land)     gh issue edit "$N" --remove-label "in process" >/dev/null
            gh issue edit "$N" --remove-label "prepped" >/dev/null 2>&1 || true
            gh issue edit "$N" --remove-label "in research" >/dev/null 2>&1 || true ;;
  *) echo "board-label: unknown transition '$T'" >&2; exit 1 ;;
esac
echo "#$N -> $T"

# --- epic mirror -------------------------------------------------------------
parent="$(gh api graphql \
  -f query='query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){issue(number:$n){parent{number}}}}' \
  -f owner=mvox-dev -f repo=mvox-app -F n="$N" \
  --jq '.data.repository.issue.parent.number // empty' 2>/dev/null || true)"
[ -n "$parent" ] || exit 0

labels_json="$(gh api graphql \
  -f query='query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){issue(number:$n){subIssues(first:50){nodes{state labels(first:20){nodes{name}}}}}}}' \
  -f owner=mvox-dev -f repo=mvox-app -F n="$parent" \
  --jq '[.data.repository.issue.subIssues.nodes[] | select(.state=="OPEN") | .labels.nodes[].name]')"

want=""
grep -q '"in process"'  <<<"$labels_json" && want="in process"
[ -z "$want" ] && grep -q '"prepped"'     <<<"$labels_json" && want="prepped"
[ -z "$want" ] && grep -q '"in research"' <<<"$labels_json" && want="in research"

for l in "in process" "prepped" "in research"; do
  if [ "$l" = "$want" ]; then
    gh issue edit "$parent" --add-label "$l" >/dev/null
  else
    gh issue edit "$parent" --remove-label "$l" >/dev/null 2>&1 || true
  fi
done
echo "epic #$parent mirror -> ${want:-none}"
