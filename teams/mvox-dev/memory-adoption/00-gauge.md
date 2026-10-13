# 00 — Gauge (Phase 0)

Kit: memory-kit v0.1.0-alpha.2, vendored at `memory-kit/` (subtree, squash). Date: 2026-10-14.

## Lint over the existing home

`sh memory-kit/lint/memory-lint.sh teams/mvox-dev/memory --report` → `clean`.
That is a negative from the instrument: the lint reads only `*.yaml` and the tier
directories, and the home has none. Nothing was checked; nothing passes.

## What exists

Sources in scope (brief §3):

- `teams/mvox-dev/memory/*.md` — 16 markdown files (+ `.gitkeep`), plus two subdirectories of
  pipeline artefacts: `pipeline-args/` (89 JSON) and `research/` (53 JSON).
- Harness auto-memory (the lead's): 123 memory files + `MEMORY.md` index.

Item = one heading section or one `[TAG]` entry in a team file; one file in auto-memory.
Split and measured by `gauge.py` (this directory). Regenerate:

    python3 teams/mvox-dev/memory-adoption/gauge.py teams/mvox-dev/memory \
      ~/.claude/projects/-home-ai-teams-workspace/memory

Columns: `sourced` = item carries a sha, `#NN`, date, path or names a ruling;
`fit_fact` = ≤ 42 words (fact cap); `fit_record` = ≤ 100 chars (scratchpad record cap).


### team memory (16 files)

| file | items | words | sourced | url | fit_fact | fit_record |
|---|---|---|---|---|---|---|
| architecture-decisions.md | 91 | 25526 | 75 | 6 | 4 | 0 |
| bentham.md | 60 | 11886 | 59 | 1 | 0 | 0 |
| byrd.md | 165 | 7434 | 68 | 0 | 78 | 26 |
| chore-72-state.md | 7 | 511 | 3 | 0 | 2 | 0 |
| comenius.md | 76 | 2576 | 41 | 0 | 54 | 18 |
| finn.md | 12 | 1003 | 10 | 0 | 2 | 0 |
| i18n-conventions.md | 26 | 7967 | 17 | 0 | 6 | 1 |
| josquin.md | 12 | 790 | 5 | 1 | 4 | 0 |
| perotin.md | 7 | 1138 | 7 | 0 | 1 | 0 |
| session-mvox19-pickup-log.md | 26 | 2430 | 26 | 0 | 4 | 2 |
| tallis.md | 16 | 889 | 8 | 0 | 8 | 1 |
| task-list-snapshot.md | 1 | 43 | 1 | 0 | 0 | 0 |
| team-lead-archive.md | 132 | 39066 | 110 | 18 | 8 | 2 |
| team-lead.md | 3 | 369 | 3 | 0 | 1 | 0 |
| test-gaps.md | 2 | 683 | 1 | 0 | 1 | 0 |
| victoria.md | 22 | 1167 | 14 | 0 | 9 | 3 |
| **total** | 658 | 103478 | 448 | 26 | 182 | 53 |

### harness auto-memory (123 files, item = file)

| file | items | words | sourced | url | fit_fact | fit_record |
|---|---|---|---|---|---|---|
| feedback_* (63 files) | 63 | 12686 | 56 | 1 | 0 | 0 |
| project_* (59 files) | 59 | 22486 | 56 | 8 | 0 | 0 |
| reference_* (1 files) | 1 | 60 | 1 | 0 | 0 | 0 |
| **total** | 123 | 35232 | 113 | 9 | 0 | 0 |

All sources: 781 items, 138710 words.

## What would fail the kit today

- **Shape: everything.** No source is YAML; every item is prose. A conversion is a rewrite.
- **Caps:** 182 of 781 items fit the 42-word fact cap; 53 fit the 100-char record cap. Most
  items are paragraphs. Fitting means compressing, not reformatting.
- **Sources:** 561 of 781 items carry some address (sha, issue, date, path, ruling). Under
  the kit's grammar most of them would be a valid `ref` once pulled out of the prose.
- **Inline URLs:** 35 items carry a URL inline (kit wants `urls/<name>`).
- **Scratchpad caps:** the live scratchpads already hold a "current" block; byrd (165 items,
  7.4k words) and bentham (60 items, 11.9k words) are far over any total-row cap.

## Is the kit a fit?

Yes. 139k words of memory, 47% of it (64.6k words) in two files: `team-lead-archive.md`
(read by nobody) and `architecture-decisions.md` (25.5k words, which perotin.md tells
Pérotin to read whole at start), and an every-session index
(`MEMORY.md`, 121 lines) that grows by one line per lesson without a cap. The kit's
split by read-time is the thing this home lacks. The cost is the rewrite: the 540 items not
classed `history` (01-map.md) need judgment, not a script.

(*MVOX:memkit*)
