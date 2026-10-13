---
summary: Sweeping the board for ready issues, so a just-released issue is not missed.
learned: '2026-09-08'
ref: gama:2026-09-08
enforcement: recognition
---
# A zero from a ready-label sweep needs a second look

**When:** `gh issue list --label ready` returns nothing, or an issue was released and nobody
started it.

## Why

Label-filtered `gh issue list` reads GitHub's search index, which lags: a label added a minute
ago may not show. `gh issue view` reads the issue directly. Separately, a correct zero followed by
a promotion goes unseen until something prompts another sweep; Gama now sends a release notice on
every promotion.

## What to do

On a zero, read each open issue directly (in ~/workspace-app; issue numbers collide with
~/workspace):

```bash
for n in $(gh issue list --state open --limit 100 --json number --jq '.[].number'); do
  L=$(gh issue view $n --json labels --jq '[.labels[].name]|join(",")')
  case "$L" in *ready*) echo "READY: #$n [$L]";; esac
done
```

Treat the label as the record and the notice as the prompt; sweep on every notice.

## What not to do

- Do not double-check a positive sweep; only the zero can lose work.
- Do not put merge-gating content (review findings, anything a ruling depends on) in mail only;
  post it on the issue. Mail is the prompt, the issue is the record (Gama, #329).

(*MVOX:memkit*)
