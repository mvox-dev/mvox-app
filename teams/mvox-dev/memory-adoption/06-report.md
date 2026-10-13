# 06 — Experience report: mvox-dev adopts memory-kit (DRAFT)

Home: mvox-dev, a ten-seat AI dev team (team lead Palestrina, PO Mihkel) on github.com/mvox-dev/mvox-app.
Kit: v0.1.0-alpha.2, adopted 2026-10-14 (PR #901); upgraded to v0.1.0-alpha.3 the same day.
Executor: memkit (one agent) with Sonnet/Opus subagents; gates ruled by Palestrina, delegated by Mihkel.
Status: draft. GATE 3 and the events that exercise the tree (05-debt.md) are still ahead;
the "proving" section is filled in after them. Filed on the kit tracker after GATE 3.

## What the gauge found

- Two sources: 16 markdown memory files plus 142 workflow JSON files in the team's memory dir,
  and the lead's harness auto-memory (123 files plus an index). 923 units, 139k words.
- The lint over the existing home said `clean`. It read nothing: the home had no `*.yaml` and no
  tier directories. A first-time home sees a pass that is really "nothing found".
  **Ask:** `--report` should say "no tier files found" when it lints zero files.
- 182 of 781 items fit the 42-word fact cap; 53 fit the 100-character record cap. Most items were
  paragraphs, so converting them meant rewriting.

## What the mapping found

| tier | items |
|---|---:|
| lesson | 271 |
| history (finished-work logs, git holds them) | 241 |
| rule | 65 |
| fact | 55 |
| ruling | 51 |
| longform | 31 |
| superseded | 31 |
| current / staging | 16 / 5 |
| other (dup, header, url, nofit) | 15 |

Final state (03-state.tsv): converted 202, dead 549, moved out to docs 127, rule-class 45 →
GATE 2 destinations. Nothing deleted yet.

## What fit no tier — quoted

1. **Rulings (51 items). Top finding.** e.g. "Mihkel 2026-09-22: one live-run word covers
   aborts, resumes, cleanup." The kit's genus lesson names a *ruling* genus (rots only when
   re-decided; on reversal keep one dated line), but ships no tier for it. We put them in
   `facts/rulings-<area>.yaml` with `ref: <person>:<date>` and `refute: "=ref"`. It works, but
   rulings then sit in the fact sweep they should be exempt from, and "refuted is deleted"
   contradicts "keep the reversal". 71 ruling rows in 6 files (of 172 facts in 24 files);
   rulings-process.yaml is the largest at 24 of 30.
2. **Long-form (31 items + 2 whole files + 10 design notes).** Outside the kit by design; we
   moved them to `teams/mvox-dev/docs/` and wrote the boundary as a fact. Fine as the README says.
3. **Machine artefacts in the memory dir (142 JSON).** Workflow inputs/outputs that had parked
   themselves in memory. Not memory at all; ruled dead.
4. **Pointers to a path, not a URL (2).** "lives on po-team's box: `~/po-team/tools/line-report.py`".
   `urls/` needs a scheme; we made them facts.
5. **File preambles (8).** "Only Josquin writes here." The kit has no owner / sole-writer field;
   they became YAML header comments.
6. **A team-owned list with its own format** (test gaps, appended by one role, triaged by
   another). Ruled dead here, but a team home will meet this shape again; every top-level
   `*.yaml` is linted as a scratchpad, so such a list has to live in a subdirectory.
7. **A derived index (the harness auto-memory index).** Became one pointer line.

## Ref grammar gaps

- **No `sha:path` form.** After cutover, 64 refs pointed at memory files that GATE 3 will
  delete. "Git is the archive" needs "this file at that commit". `sha:path` fails the grammar
  (`:` is not a path character), so each became `urls/mem-<name>-<sha>` holding a blob URL.
  **Ask:** add `<sha>:<path>` to the ref grammar.
- **Sources outside any repo.** One standing rule lives only in the user-level instruction file
  (outside every repo); no ref form fits, so it stays blank (ruled).

## Where conversion needed judgment, and how much

- 202 of 923 units needed a human ruling beyond the mapping; 3 batches plus 2 gates.
  Item-by-item with the human (Phase 3 as written) would not have fit: 188 of them were
  screened by subagents against the repo (does this still hold? `ls`, `grep`, `git log`) and
  the human accepted the screen as a whole (141 dead, 47 keep).
- Quoting each needs-judgment item whole (Phase 2) would have been ~25k words; we quoted ids
  plus the question and kept a script that regenerates any body.
- Phase 4 found 266 distinct norms across the instruction files and memory, against a cap of
  20 rows. 13 rows for everyone and 7 for the lead fit; role-scoped norms stayed in the role
  prompts each role already reads.
- **Our own miss, worth a line in ADOPTION Phase 4:** 29 norms were marked "stays where it is
  already read", but their only source was a memory item headed for the fallback. "Stays"
  would have dropped them silently; review caught it. **Ask:** Phase 4 should require that a
  demotion target actually contains the text before it counts as a destination.

## What the repo's own gates hit

- The kit's `types/*.ts` carry their canon in comments; this repo's comment rules (≤ 10%
  comments, ≤ 3-line blocks) failed on the vendored subtree. We exclude `memory-kit/` from that
  check. A content fence (no live mention of a retired db name) flagged the adoption record,
  which quotes source ids. Consumers with house linters should expect both.
- `pip` was absent on the host; PyYAML went in via `uv pip install --target <user site>`.
  CI installs it if missing before running the lint on every run, notes-only PRs included.

## Distribution: squash merges drop the subtree metadata

The repo squash-merges every PR. `git subtree pull` then refuses: "'memory-kit' was never
added" — the squash commit carries no `git-subtree-dir:` line. Our upgrade to alpha.3 removed
`memory-kit/` and re-added it with `git subtree add --squash` at the new tag (same tree
change). **Ask:** UPGRADE.md should name this for squash-merge homes, or `sync.sh` should do it.

## Caps, measured on the converted tree

| cap | limit | max seen | note |
|---|---:|---:|---|
| facts per file | 30 | 24 | fine; one subject file per topic, 24 files |
| fact words | 42 | 32 | median 22; the cap never bit after rewriting |
| record chars | 100 | 99 | 7 of 29 records at ≥ 95: the cap shapes the writing, as meant |
| rule chars | 100 | 94 | fine |
| rules rows | 20 | 20 | full on day one; 246 norms live elsewhere (see Phase 4) |
| scratchpad current | 15 | 17 → 13 | the lead's rows went over the first time GATE 3 events were added; trimming finished rows was the right fix |
| lesson summary | 120 | 105 | fine |

Lessons: 123 indexed, 119 recognition-only. Uncapped bodies were right; the count is the
cost of turning a team's scratchpads into situational know-how.

## What the proving events broke or revealed

_To fill after GATE 3: cold start, seam checkpoint, fresh implementer spawn, reviewer write,
lesson added by someone other than the adopting agent (05-debt.md)._

(*MVOX:memkit*)
