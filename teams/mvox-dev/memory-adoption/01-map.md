# 01 — Map (Phase 1). Nothing converted.

Item-level ledger: `01-items.tsv` (781 rows: id, source file, tier, note). Items were
classified by six Sonnet readers against one spec, then checked: every id once, every tier
from the vocabulary. Table regenerates with `python3 map.py 01-items.tsv`.

Tier vocabulary beyond the kit's own: `ruling` (dated PO/Gama decision), `longform`
(reference prose, outside the kit), `history` (finished-work log, git holds it), `superseded`
(overturned; replacement named in the note), `dup`, `header` (file preamble).

## Source → tier → count

| source | current | staging | fact | ruling | rule | lesson | url | longform | history | superseded | dup | header | nofit | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| architecture-decisions.md |  |  | 5 | 14 | 17 | 25 |  | 6 | 6 | 18 |  |  |  | 91 |
| auto-memory feedback_* |  |  |  | 18 | 28 | 15 |  |  |  | 1 | 1 |  |  | 63 |
| auto-memory project_* | 2 |  | 20 | 9 |  | 16 |  | 10 |  | 2 |  |  |  | 59 |
| auto-memory reference_* |  |  |  |  |  |  | 1 |  |  |  |  |  |  | 1 |
| bentham.md |  | 5 | 2 | 3 | 3 | 44 |  |  | 1 |  | 1 |  | 1 | 60 |
| byrd.md | 1 |  | 15 | 1 | 3 | 92 |  |  | 52 | 1 |  |  |  | 165 |
| chore-72-state.md |  |  |  |  |  |  |  |  | 7 |  |  |  |  | 7 |
| comenius.md | 1 |  |  |  |  | 34 |  |  | 38 |  | 2 | 1 |  | 76 |
| finn.md | 1 |  | 5 |  | 2 | 2 |  |  | 1 | 1 |  |  |  | 12 |
| i18n-conventions.md | 1 |  |  |  | 9 | 2 |  | 14 |  |  |  |  |  | 26 |
| josquin.md |  |  |  |  |  | 10 | 1 |  |  |  |  | 1 |  | 12 |
| perotin.md | 1 |  | 2 |  | 1 | 2 |  |  |  |  |  | 1 |  | 7 |
| session-mvox19-pickup-log.md |  |  |  | 5 | 1 | 1 |  |  | 18 | 1 |  |  |  | 26 |
| tallis.md |  |  | 2 |  |  | 9 |  |  | 1 | 2 |  | 2 |  | 16 |
| task-list-snapshot.md | 1 |  |  |  |  |  |  |  |  |  |  |  |  | 1 |
| team-lead-archive.md |  |  | 1 |  | 1 | 15 |  | 1 | 109 | 5 |  |  |  | 132 |
| team-lead.md | 1 |  |  |  |  |  |  |  | 1 |  |  | 1 |  | 3 |
| test-gaps.md | 1 |  |  |  |  |  |  |  |  |  |  | 1 |  | 2 |
| victoria.md | 6 |  | 3 | 1 |  | 4 |  |  | 7 |  |  | 1 |  | 22 |
| **total** | **16** | **5** | **55** | **51** | **65** | **271** | **2** | **31** | **241** | **31** | **4** | **8** | **1** | **781** |

Not itemised (whole-file units):

| source | count | proposed |
|---|---:|---|
| `memory/pipeline-args/*.json` | 89 | history — workflow inputs, last 2026-09-14; ruled-dead list |
| `memory/research/*.json` | 53 | history — research outputs of those runs; ruled-dead list |
| auto-memory `MEMORY.md` | 1 | derived index; becomes a pointer to the kit home at cutover |

Arithmetic: 781 items + 142 JSON + 1 index = 924 units. Each lands in exactly one row above.

## Proposed mapping (for the ruling)

1. **Scratchpads → `memory/<name>.yaml`**: team-lead, bentham, finn, josquin, perotin, byrd,
   comenius, tallis, victoria. `current` items → `current`; `staging` → `staging`. Live
   blocks only; every other item leaves for its tier.
2. **`task-list-snapshot.md` folds into `team-lead.yaml` `current`** — it already names
   team-lead.md as its source of truth. Startup Phase 4 restores from there.
3. **Facts (55) → `facts/<subject>.yaml`**, subjects by topic (entu-platform, repo, ci,
   deploy, comms, …). Each needs a refute address; blanks are counted.
4. **Rulings (51) → `facts/rulings-<area>.yaml`**, `ref: mihkel:<date>` (or `gama:<date>`),
   `refute: "=ref"`. The kit has no rulings tier (does-not-fit #1); facts is the nearest
   shape. Reversal = the row is replaced by one naming what replaced it.
5. **Rules (65) → Phase 4 candidates** with the standing-rule sources (brief §4). Cap 20.
6. **Lessons (271) → `lessons/<slug>.md` + generated index.** Phase 3 culls first: 135 of
   them sit in byrd/comenius/tallis (last written 2026-08/09; roles since folded into Josquin).
7. **Obligations**: none classified, but `team-lead#2` carries one (#890 waits on Mihkel's
   per-run word). Conversion pulls such rows into `obligations.yaml` with actor + expiry.
8. **URLs (2)**: both are paths, not URLs (does-not-fit #4) → facts.
9. **Longform (31 items, 2 whole files) → `teams/mvox-dev/docs/`**:
   `architecture-decisions.md`, `i18n-conventions.md` move out of `memory/` unchanged. Their
   rule candidates feed Phase 4; nothing else is extracted (they stay the ruling log and the
   conventions doc). The 10 auto-memory longform items (polyphony-era design notes) go to
   Phase 3: docs, or ruled dead.
10. **History (241) + superseded (31) + dup (4) → `03-ruled-dead.md` candidates** (shown,
    not deleted). Includes all of `team-lead-archive.md` except its 15 lessons, 1 fact,
    1 rule, 1 longform item, which Phase 3 extracts first.
11. **`test-gaps.md` → team-owned list in a subdirectory** (`memory/lists/test-gaps.yaml`?)
    or into `obligations`/issues — Phase 3 question; it is 2026-05 era and partly obsolete.
12. **Headers (8)** become each new file's YAML header comment.
13. **Harness boundary**: auto-memory files move to a fallback dir beside it at cutover
    (not deleted); `MEMORY.md` shrinks to one pointer; recorded as a fact.

## Does not fit — quoted

1. **Rulings (51 items).** e.g. `feedback_one_authorization_per_job`: "Mihkel 2026-09-22:
   one live-run word covers aborts, resumes, cleanup". The kit's genus table names a
   *ruling* genus but ships no tier for it. Best guess: a facts file with `=ref`.
2. **Longform (31 items + 2 files).** e.g. architecture-decisions.md "PO standing rules"
   section. Outside the kit by design; the boundary goes in as a fact.
3. **Pipeline artefacts (142 JSON).** `pipeline-args/args-248.json` etc. Not memory at all:
   machine inputs/outputs of workflow runs that parked themselves in the memory dir.
4. **Pointers to a path, not a URL (2).** `reference_line_report`: "lives on po-team's box:
   `~/po-team/tools/line-report.py` … send gama@po-team a request". `josquin#12`: "Mutation
   runners and split tools: ~/workspace/scratchpad/{611,…}/". `urls/` needs a scheme.
5. **A pointer note (1).** `bentham#30`: "The binding text is the 'PO standing rules'
   section of `architecture-decisions.md`. Read it there; never keep a second copy here."
   Best guess: a rule ("rules live in X") — or it dies when rules.yaml exists.
6. **File preambles (8).** e.g. `josquin#1`: "Only Josquin writes here. History lives in git;
   this keeps what the next issue needs." The kit has no owner/sole-writer field.
7. **A team-owned gap list with a format of its own.** `test-gaps#1`: "Tallis appends;
   Victoria triages into issues. Format: `[GAP] <area> — <what's missing> — <risk> — <date>`".
8. **A derived index (1).** auto-memory `MEMORY.md`: one line per memory, loaded every
   session by the harness. The kit's lessons index is the same idea, generated.

## GATE 1 — ruling

_Pending._

(*MVOX:memkit*)
