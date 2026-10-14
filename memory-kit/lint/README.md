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

**A gate must pass on the tree it is introduced to.** A lint that fails on day one teaches
`--no-verify`.

## What is a failure and what is a note

Failures are shape: a cap exceeded, a ref outside the grammar, a missing or unknown key, a
bad date, an inline URL, a lesson indexed with no file or on disk with no index line, a lesson
summary cut by an unquoted ` #` (YAML reads the rest of the line as a comment, so the generated
index agrees with the cut value; only the raw front matter shows it).

Notes never fail a gate. They are the honest gaps the kit wants counted rather than hidden:

| note | why it is not a failure |
|------|------------------------|
| blank `ref` | failing blanks buys fabricated refs, and a fabricated ref survives a sweep |
| blank `refute` | some claims genuinely rest on trust; the count is the point |
| blank `check` on an obligation | some waiting has no observable signal |
| blank `revoke` on a grant | the tier's own alarm, not a schema error |
| an expired obligation | the tier working: run the check, then re-state or resolve |
| `enforcement: recognition` | counted so a corpus that fires nothing is visible |

`run-fixtures.sh` is the conformance test -- see `fixtures/README.md`.
