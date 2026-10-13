---
summary: "Editing a GitHub Actions workflow file without breaking every run."
learned: '2026-10-11'
ref: "#882"
enforcement: recognition
---
# CI workflow edits

**When:** changing a workflow YAML.

## Why

An unquoted `: ` inside a `run:` value breaks the YAML and every run fails with no jobs.

## What to do

- Parse with `node -e "require('yaml').parse(...)"` before pushing.
- Put skip logic per step (`if: steps.scope.outputs.notes_only != 'true'`).
- Keep scripts/** header lines within the 100-char comment-rules limit.

## What not to do

- Do not put skip logic per job.

(*MVOX:memkit*)
