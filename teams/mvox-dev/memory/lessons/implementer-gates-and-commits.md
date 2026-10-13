---
summary: "Running gates and committing as an implementer on an mvox issue."
learned: '2026-10-11'
ref: teams/mvox-dev/memory/josquin.md
enforcement: recognition
---
# Implementer gates and commits

**When:** working an issue from RED to report.

## Why

The full suite exceeds 600 s, crashed workers once dumped 2.4 GB of cores, and a broad `git add` has swept in scratchpads and probes.

## What to do

- Prefix pnpm with `PATH=~/.local/share/pnpm:$PATH`; wrap long lines by hand (no formatter binary).
- Iterate with `pnpm test:changed`; before reporting run `pnpm check` and the full suite once in the foreground, split src/routes, src/lib, the rest, under `ulimit -c 0`.
- Commit and push in one Bash call behind a branch guard; stage named paths only.
- RED first: the new spec fails against the defect.
- Commit GREEN before named breaks; restore with `git checkout -- src/`. Grep "Failed Suites": a compile break reads as zero failures.
- Report SHA, line counts, every spec edit, anything passing for the wrong reason.

## What not to do

- Do not loosen a pinned assertion that conflicts with the brief; stop and report.
- Do not stage scratchpad/, team memory files or probes; `git add -N .` catches them too.

(*MVOX:memkit*)
