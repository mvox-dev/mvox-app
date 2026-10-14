# Changelog

## Unreleased

## v0.1.0-alpha.12 -- 2026-10-14 -- the watch never idles silently

- **Watch 0.2.3** (#14, found at mvox; built by the workshop's agent, 90/90 tests).
  - `watch_sources` may be a block list or a one-line (or multi-line) flow list; quoting and
    trailing commas work. At mvox the flow form had been ignored silently, so the watch idled.
  - Never silent: a declared list it cannot read, and every skipped item, raises one visible
    notice naming the conf. `watch_sources: []` stays quiet on purpose.
  - New `/watch` command: the active sources (format, modifiers, path), the skipped ones with
    reasons, the poll interval and the retire switch.
  - README: `plugin configure --values-stdin` takes strings only.

## v0.1.0-alpha.11 -- 2026-10-14 -- Windows fixes: UTF-8 everywhere, quiet removes

- **Watch 0.2.2: a remove or unlock of a path already gone no longer fails** (#11, found by
  Pepys's desk on Windows 11; built by the workshop's agent, 77/77 tests). Under
  `$ErrorActionPreference='Stop'`, `Remove-Item -ErrorAction SilentlyContinue` exits 1 for a
  missing file; it is now guarded by `Test-Path`. The unlock had the same trap on POSIX
  (`rmdir` -> `rm -d -f`). A call is judged by exit code alone, even with CLIXML on stderr.
- **Fix: the kit's Python names UTF-8 on every read and write** (#13, reported by Pepys's desk
  and framework-research). With no `encoding=`, Windows used the locale code page (cp1257 on
  Estonian Windows) and crashed on the first `õ`. 22 call sites in `lint/` and `tools/`; writes
  also pin `newline="\n"`. `run-fixtures.sh` now fails any file I/O without `encoding="utf-8"`,
  and `valid/non-ascii` keeps a UTF-8 tree in the fixtures. The `-X utf8` / `PYTHONUTF8=1`
  workarounds are no longer needed.

## v0.1.0-alpha.10 -- 2026-10-14 -- the watch shares a team inbox with the harness

- **Watch 0.2.1: shared hub inboxes** (#12, reported by mvox; built by the workshop's agent,
  72/72 tests). In a team session the courier writes into the harness's own teammate inbox. New
  `hub` modifiers `unread` and `courier` make a source shared: the watch takes only unread
  courier mail, leaves teammate entries in place and in order, waits 30 s so the harness goes
  first, and writes under the harness's own lock (`<inbox>.lock`, mkdir). Checked live: the
  harness reads its inbox only while a teammate is running, and empties it after delivering.
  A burst into a team inbox arrives slowly (about one message per 30-40 s), but in full.
- A source without modifiers (a household-style inbox the courier alone writes) is unchanged.

## v0.1.0-alpha.9 -- 2026-10-14 -- the watch on Windows

- **Watch 0.2.0 runs on Windows** (built by the workshop's agent; 58/58 tests). The mod API
  cannot rename or delete files, so the watch runs them on the host: POSIX `mv`/`rm`, or on
  Windows `Move-Item`/`Remove-Item` through Windows PowerShell 5.1 (`-EncodedCommand`, so no
  command-line quoting; `-LiteralPath`; single-quoted literals). The platform is found once: a
  drive-letter or UNC home is Windows, otherwise `uname -s`. An empty poll starts no process.
  `~` falls back to `USERPROFILE`.
- **Unverified on real Windows**: brackets in `-Destination`, the exit code of a failed move,
  `$.fs` on `C:\` paths, finding `powershell.exe`, and speed (one PowerShell process per file
  operation). The watch README's Platforms section lists them for a Windows home to check.

## v0.1.0-alpha.8 -- 2026-10-14 -- the watch polls every 5 s

- **Watch 0.1.1: `pollSeconds` defaults to 5** (#10). The household's flood test (15 hub
  messages from three teams in about a minute) delivered all 15 exactly once, but at 15 s
  every second message first bounced: the hub courier waits only about 10 s for an occupied
  inbox. The hub kept and redelivered them, late and out of order. 5 s (the minimum) matches
  the old hub-drain Monitors. The README says why to keep it there for a `hub` source.
- Known limit: the watch drains with POSIX `mv`/`rm`, so it does not run on Windows yet
  (planned for the next release).

## v0.1.0-alpha.7 -- 2026-10-14 -- the watch

- **New adapter: `adapters/claude-code/watch/`, watch 0.1.0** (#9; built by the workshop's agent,
  48/48 tests). A second plugin in the `memory-kit` marketplace, beside the read-only pane:
  `claude plugin install watch@memory-kit`.
  - **Idle-safe notifications.** Drains the inboxes a home declares in `memory-kit.conf`
    (`watch_sources: "prefix | hub|lines | path [| archive]"`) and delivers each item as a prompt
    once the session is idle, prefixed with its source. A hub-mail Monitor is no longer needed, nor
    is typing into tmux. An item leaves its pending file only once its delivery is accepted: a
    refusal keeps it, backs off (1 to 30 min) and tells the human once; a crash may deliver an item
    twice, never zero times.
  - **Checkpoint and retire on idle**, off by default (`retireOnIdle`). After `idleMinutes` (50)
    idle, with context grown by `growthPercent` (50) since the session began, it asks the session
    to run its close routine and the home's `watch_retire_step`. Five guards against a restart
    loop: human input first, growth not size, one ask per session, a shared brake (2 h apart, 4 a
    day), and the off switch. Each guard's removal fails its own tests.
  - POSIX only for now (draining uses `mv`/`rm`); Windows is not supported yet.
- The marketplace gains a description.

- README: a **Roadmap** section -- the gates for 0.1.0, what 0.2 and 0.3 settle, and draft 1.0
  criteria (PO, 2026-10-14).
- UPGRADE: the pane's option count is 4 from alpha.6 (`checkUpdates`).

## v0.1.0-alpha.6 -- 2026-10-14 -- the pane knows its kit; docs keep their promises

- **Pane 0.3.0** (built by the workshop's pane agent; 81/81 tests):
  - reads obligations files the way `yaml.safe_dump` writes them: list items at column 0, wrapped
    long values, YAML escapes, `null`/`~` as empty (#5). Tested against real PyYAML output.
  - the header shows the home's kit version instead of the date and time (#4).
  - checks upstream for a newer release at most every 6 h and says "· alpha.N out" in the header
    (#7). Anonymous Codeberg tags API, cached across sessions in `$.store`, 10 s time limit, never
    blocks a hook, never pulls. Off with the new `checkUpdates` option; another upstream with
    `upstream: <owner>/<repo>` (Codeberg) in `memory-kit.conf`.
  - Windows absolute paths (`C:\`, `C:/`, UNC) in `memoryDir` or `memory_dir` are no longer
    joined to the working folder (#8). Unverified on real Windows: a Windows home should check it.
- **Docs: the obligations tier is in the core docs** (#2). README D6 and the ADOPTION Phase 1 tier
  list name it; Phase 3's genus test routes waiting-on items to `obligations.yaml`, no longer to
  the scratchpad (which the kit's own lesson forbids), and says `expires` is when you run the
  check, not the other party's deadline.
- **Docs: no promises the kit does not keep** (#2). D2 names `types/` as the machine-readable
  contract; D3 drops `sync.sh` (a home uses `git subtree pull`). The README layout lists what
  ships; `SPEC.md`, `schemas/` and `migrations/` are marked planned. Five shipped rules cited
  missing files (`SPEC.md`, `templates/`) and now cite the `types/` file or skeleton README that
  states them.
- **Lint: files read / files ignored.** The gauge counts the files it read and those it did not,
  and names the first five ignored. A pre-kit home no longer gauges as "clean" (#2; hr2, workshop
  and household finding 1). A note only, never a failure. Fixture: `valid/files-ignored`.
- **Fixtures check the reason, not only the exit code** (household finding 11). Each invalid
  fixture carries an `expect` line; `run-fixtures.sh` fails a fixture with no `expect`, with more
  than one FAIL line, or failing for another reason. This caught
  `invalid/lesson-hooked-without-trigger` failing twice since alpha.2 (it lacked front matter).
- **Tool: `tools/obligations-due.py`** -- the deadline horizon (expired, next N days, later).
  Honours `memory_dir`. Three homes had written it independently (household finding 13).
- UPGRADE: the pane's option count is 3 from alpha.4 (#6).
- **Types: the obligations layout readers accept** (#5), written above `ObligationsFile` in
  `types/memory-obligations.ts`: the subset the pane reads, so a writer finds it where the shape is.
  `yaml.safe_dump(..., sort_keys=False)` output is inside it. Text by the workshop.

## v0.1.0-alpha.5 -- 2026-10-14 -- pane stays on its home; never squash the subtree

- **Pane 0.2.1: reads the home the session started in** (#3). A shell `cd` into another repo
  mid-session used to switch the pane to that repo's ledger. The first `session.start` cwd is
  kept in `$.state` and survives a mod reload. Built by the workshop's pane agent; 46/46 tests.
- The kit's own `memory/obligations.yaml` is empty: both rows (expired 05.10 and 10.10) were
  resolved -- obligations shipped as a tier, and the household adopted on 2026-10-13. A home
  vendoring the kit no longer sees them as its own (household findings 14 and 21).
- UPGRADE: never squash-merge the PR that brings the kit's subtree into a home; the next
  `git subtree pull` refuses. Reported by mvox (2026-10-13).
- The GitHub repo is now a push mirror of Codeberg (sync on every push). Push to Codeberg only;
  anything pushed straight to GitHub is overwritten.

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
