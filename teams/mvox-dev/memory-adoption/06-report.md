# 06 — Experience report: mvox-dev adopts memory-kit

Home: mvox-dev, a ten-seat AI dev team (team lead Palestrina, PO Mihkel) on github.com/mvox-dev/mvox-app.
Kit: v0.1.0-alpha.2, adopted 2026-10-14 (PR #901); upgraded the same day to alpha.3, later to
alpha.14 and, on 2026-10-15, to alpha.15 (PR #923).
Executor: memkit (one agent) with Sonnet/Opus subagents; gates ruled by Palestrina, delegated by Mihkel.
Status: filed 2026-10-15 at the PO's request, before GATE 3. Three of the five proving events
in 05-debt.md have run; two have not (see the last section). Fallback files are still kept.

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

The repo squash-merges every PR. `git subtree pull` then refused: "'memory-kit' was never
added" — the squash commit carries no `git-subtree-dir:` line. Our upgrade to alpha.3 removed
`memory-kit/` and re-added it with `git subtree add --squash` at the new tag. Our ask (name it
for squash-merge homes) is met: UPGRADE.md "Always" now says to merge kit PRs with a merge
commit and gives the repair. Kit PRs here merge that way since (#913, #923).

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

1. **Cold start** (`/mvox-wake`, 2026-10-14) — ran. The lead read `rules.yaml` and
   `team-lead.yaml` and knew where work stood from `current` alone. The second half of the
   event, "restore the task list from `current`", could not run: this CLI build has no
   task-create tool, so `current` is the only carrier of state across a restart. The first row
   written after the start was 115 characters; the local lint gate refused it (cap 100) and the
   rewrite was shorter and clearer.
2. **Seam checkpoint** — ran. PR #924 regenerated `current`, touched only memory, and CI took the
   notes-only path: memory lint ran and passed, the test suite was skipped (7 s).
3. **Fresh implementer writes its scratchpad** — ran twice. josquin-914 and josquin-917 each
   wrote `josquin.yaml` rows (two GOTCHAs from #917: a tool missing from the repo, and a fixture
   shape a new gate needed). Both rode the feature PR's squash. **Revealed:** a house rule
   older than the kit says memory files in a feature diff are dropped from the squash; the
   reviewer flagged it. A home with review rules about memory files needs to decide where an
   agent's own memory writes land; ours now lets an implementer's own file ride its feature
   PR. **Ask:** ADOPTION could name this as a question for team homes.
4. **Reviewer writes its scratchpad** — not yet. Bentham reviewed two waves (#914 YELLOW,
   #917 GREEN) and wrote nothing, by its own rule: it records a verdict only when it would
   change a future review. The tier worked as designed; the event list assumed every review
   writes. We count this event as waiting, not failed.
5. **A lesson added by someone other than the adopting agent** — not yet. No lesson came up
   in the first two waves that the scratchpads did not hold.

Also seen:
- **Upgrades** (alpha.14 → alpha.15): `kit-update.py` refused on a tracked, modified memory
  file in the shared tree; the #25 fix covers untracked files only. Running it in a fresh
  worktree from `origin/main` was clean, and it printed the plugin update steps (#23).
- **Hub mail:** the first PO message after the start arrived through the watch plugin as a
  `[hub mail]` prompt; later ones came as direct messages from the sending team's courier
  session. Nobody drained the inbox by hand.
- **Caps** bit once (event 1) and shaped every row written since; no cap was wrong.

(*MVOX:memkit*) — proving section and status (*MVOX:Palestrina*)
