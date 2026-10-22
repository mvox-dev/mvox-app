# lint

`memory-lint.sh [path] [--gate|--report] [--shipped-rules]`

Reads `caps.yaml`; needs python3 + PyYAML and nothing else. Fails closed (exit 2) when PyYAML
is missing: a lint that skips checks is worse than no lint.

- `--gate` exits 1 on any failure. Default for a fresh home.
- `--report` always exits 0. For a home still clearing adoption debt.
- Neither: the mode comes from `memory-kit.conf` (`mode: gate | gauge`), default gate.

**A pointer conf** (kit #18). If the path's `memory-kit.conf` says `kit_home: <path>` (absolute,
or relative to that conf's folder), the lint runs on the home it names: that home's conf,
`memory_dir` and mode.
- It follows the pointer one hop, never chained. The target's own conf may not point on, so a
  loop is refused too.
- A pointer-only conf passes when its home passes. The pointer conf's other keys are ignored, and
  the lint lists them as a note.
- A broken pointer fails in every mode: the target has no conf, or the pointer chains. The rules
  live in `lint/kit_home.py`, which the tools import too.
- A memory-directory path given directly is linted as given, pointer or not.

**Found above** (kit #42). Run with no path, in a folder with no `memory-kit.conf`, the lint takes
the nearest conf above it (as git finds `.git`) and says so: "`<folder>` has no memory-kit.conf;
using the nearest one above it, in `<home>`". A path named on the command line is taken as given,
so a fixture inside a vendored kit is linted as itself. `tools/obligations-due.py` and
`tools/kit-update.py` do the same with no folder named.

**A gate must pass on the tree it is introduced to.** A lint that fails on day one teaches
`--no-verify`.

## What is a failure and what is a note

Failures are shape: a cap exceeded, a ref outside the grammar, a missing or unknown key, a
bad date, an inline URL, a lesson indexed with no file or on disk with no index line, a lesson
summary cut by an unquoted ` #` (YAML reads the rest of the line as a comment, so the generated
index agrees with the cut value; only the raw front matter shows it), an obligation's `owed_to`
that is the actor, "us" or "we" (kit #29: owed to no one else, it is a to-do).

**A duplicate key is a failure** (kit #54), at any depth, in every tier file and lesson front
matter: two top-level `keys:` blocks, or one row with `check:` twice. Plain YAML keeps only the
last one, silently, while the memory pane refuses the file; so one file read as two. The FAIL
line names the key and both lines: `duplicate key 'keys' on line 31 (first on line 7)`. The
tools load through the same strict loader, `lint/strict_yaml.py` (kit #55): `lesson-index.py`
(front matter, and the index under `--check` and `--from-index`) and `obligations-due.py` stop
with the same words, so a tool run on its own never reads a file the gate refuses.

**So is a key given twice in `memory-kit.conf`** (kit #55). A top-level `memory_dir:` twice was
read two ways: YAML kept the last copy, the plugins' line readers the first, so the lint and the
memory pane read different memory directories. `lint/kit_home.py` refuses it, in the start
folder's conf or the one a pointer names, for the lint, the tools and the plugins' copy alike:
`duplicate key 'memory_dir' on line 5 (first on line 3); the plugins would take the first and the
lint the last, so keep only one`. The lint loads the conf as it loads a tier, so a key given twice
deeper (a doorbell with `path:` twice) fails too. Either fails in every mode, exit 2, as a broken
pointer does.

Notes never fail a gate. They are the honest gaps the kit wants counted rather than hidden:

| note | why it is not a failure |
|------|------------------------|
| blank `ref` | failing blanks buys fabricated refs, and a fabricated ref survives a sweep |
| blank `refute` | some claims genuinely rest on trust; the count is the point |
| blank `check` on an obligation | some waiting has no observable signal |
| blank `revoke` on a grant | the tier's own alarm, not a schema error |
| an expired obligation | the tier working: run the check, then re-state or resolve |
| an obligation with no `owed_to` | rows from before the field must not close an upgraded home's gate; the count shows how many may be to-dos |
| `enforcement: recognition` | counted so a corpus that fires nothing is visible |

`run-fixtures.sh` is the conformance test -- see `fixtures/README.md`.
