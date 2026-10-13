# Changelog

## Unreleased

## v0.1.0-alpha.4 -- 2026-10-14 -- the lint and the pane find a home from outside it

Reported by the po-team home (Henry), whose lead session runs outside its memory repo.

- **Fix: the lint honours `memory_dir`.** It read `memory-kit.conf` for the mode only and always
  linted `<home>/memory`. It now reads `memory_dir` from `<home>/memory-kit.conf`; a path that
  ends in `memory` is still taken as the memory directory itself. Fixture:
  `valid/conf-memory-dir`.
- **Fix: a missing memory directory fails in every mode.** Under `--report` it printed "no such
  memory directory" and exited 0, so a wrong path passed silently. It now exits 2 in gate and
  report mode alike. Fixture: `invalid/missing-memory-dir`; `run-fixtures.sh` also runs it
  under `--report`.
- **Pane 0.2.0: `memoryDir` option.** A path to the memory directory, for a session that runs
  outside its home; relative paths resolve against the working directory. Empty keeps the old
  lookup (`<cwd>/memory-kit.conf`, then `<cwd>/memory`). 44/44 tests.
- **ADOPTION Phase 5: where the gate and the pane look**, and why a second `memory-kit.conf`
  outside the home is wrong (it claims that folder is a home).
- **Skeleton scratchpad:** the comments no longer contain `current:` or `staging:`, so a tool
  editing the keys by string replace cannot hit a comment.

## v0.1.0-alpha.3 -- 2026-10-14 -- first adapter: Claude Code obligations pane

- **First adapter tool: `adapters/claude-code/obligations-pane/`** -- a read-only Claude Code
  side pane over `memory/obligations.yaml`: due-date order, expired/due-in-7-days counts, stable
  per-actor colours, `urls/` refs as clickable links, footer with agent names, model letters and
  context weight -- per subagent too, from each loop's latest turn.step usage; refresh every 20 s; mouse-wheel scrolling, one item per burst (150 ms throttle), header and footer fixed. Spec by the PO (Mihkel), built by the workshop home
  (Paertel), proven there first: validate clean, 30/30 tests. API facts it found are in its README.
- README: adapters may carry harness-bound tools in `adapters/<harness>/<tool>/`.
- `adapters/claude-code/` is a plugin marketplace (folder source): a home installs the pane with
  `claude plugin marketplace add ./memory-kit/adapters/claude-code` and
  `claude plugin install obligations-pane@memory-kit`; a subtree pull updates it in place.
- Pane, final shape (PO-accepted 14.10): footer separated by one rule (no frame), mouse-wheel
  scrolling one item per burst, per-subagent context load, figures never truncated. 40/40 tests.

## v0.1.0-alpha.2 -- 2026-10-13 -- lessons index generator; event-gated cutover

Proven first in the household (Passepartout, adopted 2026-10-13); answers GitHub #1 (hr2).

- **Lessons carry their index fields in YAML front matter** (`LessonFrontMatter` in
  `types/memory-lessons.ts`); `tools/lesson-index.py` generates `index.yaml` from it, and
  `--check` reports a stale index. **Shape change:** a lesson file without front matter now fails.
- **The lint catches index drift:** it compared only slug sets, so an index whose summaries had
  drifted from the files passed. It now fails a lesson with no front matter and an index row
  that differs from it. Fixtures: `invalid/lesson-no-front-matter`, `invalid/lesson-index-stale`;
  `valid/full`'s lesson gains front matter.
- **ADOPTION Phase 5:** cut over on the main line once Phase 5 passes, keep the fallback, and
  gate GATE 3 on named events (a cold start, each scheduled memory routine) instead of a week.

- Ruling 2026-09-23: **long-term knowledge is a deliberate gap the consumer fills.** The kit
  covers operational memory -- what is acted on this session. Articles, research and reference
  material stay outside, because their shape encodes a theory of knowledge management (wiki,
  Obsidian, Zettelkasten, unnamed folder) and the kit does not dictate one. Same treatment as
  harness auto-memory: the consumer names the boundary as a fact rather than leaving it to be
  inferred. Working line: *if it rots it is a fact; if it accumulates it is knowledge.* Parked,
  not refused -- D6 revisits at v0.3 with a `profile:` section if a second consumer wants the
  same shape. README section added; pilot question 6 added to the alpha notes.

## v0.1.0-alpha.1 -- 2026-09-23 -- pilot preview

Feature-incomplete by design. An input channel, not a blessing: proven-first (D5) stands, and
nothing reported against this tag enters the kit without passing through the household first.
Release notes: `RELEASE-0.1.0-alpha.1.md`.

**In:** twelve tier interfaces (`types/`, TypeScript as canon); `caps.yaml` generated from
`types/caps.ts`; the lint in both `memory-lint.sh` and `memory_lint.py` with `--gate` and
`--report`; 3 valid + 19 invalid fixtures and the conformance runner (D2 -- the fixtures are
the contract); the obligations tier; `ADOPTION.md` and `UPGRADE.md` as executable prompts;
`skeleton/`; `tools/weigh.py`.

**Out, and not pending:** `core/`; the shipped `lessons/` content; any migration off a
consumer's own legacy format. Kit migrations are for kit-version upgrades only -- converting a
home's bespoke shape is that home's work, and what generalises is the dry-run discipline in
`UPGRADE.md`.

**Superseded from the charter plan:** no `SPEC.md` and no `schemas/` -- the TypeScript
interfaces became the canon and the rationale moved into lessons, per the 21.09 ruling. D2's
wording still names both; it is stale and will be corrected before 0.1.0.

**Least settled, where pilot feedback is worth most:** the obligations tier; the caps; the
auto-memory boundary; refute-by-genus guidance.

**Finding carried in:** the incident field is 55% of per-session memory cost (`tools/weigh.py`).

**Fixed while cutting this tag:** the kit carried its own version in two places -- the root
`VERSION` file and `KIT_VERSION` in `types/caps.ts` -- which is the hand-carried number the kit
has a lesson against. Found in the kit's own lint banner. `VERSION` is now the single source
(D3 makes it the contract a consumer reads); `tools/extract-caps.py` reads it; `KIT_VERSION` is
deleted. Regeneration verified idempotent.

- Charter (Phase 0), 2026-09-21: rulings recorded, layout targeted, nothing implemented.
- ADOPTION.md and UPGRADE.md added 2026-09-21 as executable prompts. Minor upgrades are pull-only by contract.
- Ruling 2026-09-21: TypeScript interfaces are the canon (the notation FR and ai-locum already use); caps.yaml is generated from types/caps.ts; no JSON Schema in the repo.
- Ruling 2026-09-21: core/ ships universal rules + lessons; capped at 8 rules, each citing its incident, opt-out recorded. Types are generated from the schema, never hand-written.
- Ruling 2026-09-21: the household (Passepartout) drives the kit -- synthesizer and first adopter; FR contributes and reviews.
- Ruling 2026-09-21: tooling is python3 + PyYAML (parsing, schema generation) and awk (caps). No yq, no node.
- Ruling 2026-09-21: the kit is model- and harness-agnostic. Harness mechanisms live in adapters, never in the core.
