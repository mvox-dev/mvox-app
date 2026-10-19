# Changelog

## v0.1.0-alpha.19 -- 2026-10-19 -- the memory pane, and the home found from above

Plugin versions this release: obligations-pane 0.7.0, watch 0.6.0, kit-update 0.3.2.

No data step.

- **The memory pane** (kit #43, designed by Mihkel and the desk): the obligations pane gets a tab
  row, `[Obligations][N][C][R][L][F][K][S]`, one read-only tab per tier: Next (the scratchpad),
  Commitments, Rules, Lessons (newest first, a link to each lesson's file, a filter chip row),
  Facts (by subject, unverified for 91 days dim), Keys (a blank revoke is a finding) and Secrets
  (the README's labelled lines and the encrypted files by name and date, never a byte of one; a
  non-compliant home is a red banner). Obligations renders as before. The open tab is remembered
  per home in the plugin's own store; the pane still writes nothing into the home. `/obligations`
  opens the Obligations tab, `/memory-pane` the open one (`/memory` is Claude Code's built-in).
  The plugin keeps its id, `obligations-pane@memory-kit`.
- **A start folder without `memory-kit.conf` looks upward** (kit #42) for the nearest one, as git
  finds `.git`: a session started in a subfolder or a git worktree of a home finds the home. The
  plugins always do; the lint and the tools when no folder is named. The pane, `/watch` and
  `/kit-update` say where they looked.
- **The start folder is the session's root** (kit #45): an install or enable mid-session fired
  `session.start` with the shell's folder after any `cd`, which became the home.
- **One spool, one bookmark** (kit #46): the watch keys its bookkeeping by a normalized path
  (Windows paths case-folded), so a file reached under two spellings rings once; the `home` option
  is normalized as a pointer is.
- **`watch_idle_repeat: true`** (kit #47): the idle report recurs after each further interval while
  the session stays idle, a prompt-cache keep-alive; a human prompt still arms it first.
- **Idle compaction** (adapters README): Claude Code 2.1.290+ compacts a conversation over 200k
  tokens after about 54 idle minutes. A home that retires instead of compacting turns it off with
  `"idleCompaction": false` in the user's settings; the README says how to tell one in a transcript.
- watch: `plugin.json` and `spool-poll.py` name `watch_files`, not the retired `watch_sources` (kit #44).
- **Checked:** 150 pane, 80 watch and 68 kit-update tests, 50 Python and 48 fixture checks; every
  tab drawn live in a throwaway session on a scratch home.
- **The household runs it first.**

## v0.1.0-alpha.18 -- 2026-10-18 -- the pane names its home and lists workflows

Plugin versions this release: obligations-pane 0.6.0 (watch 0.5.0 and kit-update 0.3.1 unchanged).

No data step.

- **The home names its main agent** (gh#4): `agent_name:` in the home's `memory-kit.conf` wins
  over the pane's `agentName` option, which wins over the folder's name. Plugin options are read
  from user settings only, so a box with several homes could not name each one; the conf can.
- **Running workflows in the footer:** one line per run -- name, current phase, agents
  done/started (e.g. "pane-live = Finish 2/3"); cleared when the run completes.
- **Subagent load counts the input side only**, as Claude Code's `used_percentage` does, so
  every figure in the footer means the same.
- watch README: a consumer must take everything a ring announced, or retry (esl-suvekool 16.10).
- **Checked:** 113 pane, 64 watch and 57 kit-update tests; the workflow line live in a session.
- **The household runs it first.**

## v0.1.0-alpha.17 -- 2026-10-16 -- the watch becomes a doorbell

Plugin versions this release: watch 0.5.0, obligations-pane 0.5.1, kit-update 0.3.1.

**A data step, in `memory-kit.conf` only** (UPGRADE.md alpha.16 -> alpha.17): the first since
alpha.2. Nothing in a home's memory changes; `kit-update.py` refuses the pull, so it is done by
hand.

- **The watch is information only** (kit #9, reshaped with Mihkel 2026-10-16). It never reads a
  file's meaning, never drains, moves or archives anything, and never says what a signal means;
  that is the home's own rule.
  - **Doorbells** (`watch_files`): each entry has `label` (empty: the file's name), `path`,
    `instruction` (home-authored text the ring carries verbatim) and `inject` (ring with the new
    lines). A ring is **growth**: created at 0 bytes, shrinking, truncating and deleting only move
    the bookmark; delete-then-write rings. All of one poll's rings are one prompt; a refused ring
    rolls back and rings again later.
  - **Consuming is the home's**: read, then delete or empty -- either re-arms the bell. A spool
    with `inject: true` needs no consuming; the bookmark advances.
  - **Session reports**: `watch_idle_minutes` (armed by a human prompt, once per working stretch;
    quotes `watch_retire_step` if declared) and `watch_context_percent` (marks of the window, once
    each per session, against `$.session.usage()`).
  - **Gone:** `watch_sources` and its `hub`/`lines` formats, `unread`/`courier` modifiers and
    archives; the platform mv/rm layer and its Windows PowerShell path; the one-drain-per-home
    claim; checkpoint-and-retire (`retireOnIdle`, the growth guard, the brake). A conf still
    declaring `watch_sources`, and a set `retireOnIdle`, each get one notice. 2658 lines out,
    838 in.
  - `/watch` lists each doorbell (label, path, inject, instruction), every problem in the
    declaration, and the sensor marks.
- **Checked:** 64 watch tests (rewritten), 99 pane tests, 48 fixtures; then live in a throwaway
  home on Claude Code 2.1.301, eight checks (plain bell, re-ring after consuming, inject, two
  bells in one poll, the four no-ring cases, delete-then-write, a context mark after a live conf
  edit, the idle report once). `--plugin-dir` replaces an installed watch of the same name for
  that session rather than loading both.
- **The household runs it first**, with its hub inbox as a plain doorbell consumed by
  `scripts/hub-consume.sh` and its issue spool as an injecting one.

## v0.1.0-alpha.16 -- 2026-10-15 -- Python 3.9, plugin updates run, install scope, poller survey

Plugin versions this release: watch 0.4.0, obligations-pane 0.5.1, kit-update 0.3.1.

- **Python 3.9: the tools write without `Path.write_text(newline=)`** (#34, mac-sysops). That
  keyword is Python 3.10+, so on macOS's system Python 3.9.6 `tools/lesson-index.py` crashed at
  both its writes (the index, and front matter under `--from-index`): a 3.9 home could not
  regenerate its lesson index. `tools/extract-caps.py` crashed the same way (release side).
  - Both now write through `open(..., encoding="utf-8", newline="\n")`: UTF-8 and LF on every
    platform, as before.
  - `tools/write-paths-test.py` runs each write for real into a temporary folder (UTF-8, LF, the
    index then `--check`s current), and scans the kit's Python for `write_text(...newline=`, which
    a newer python3 would accept. `lint/run-fixtures.sh` runs it, so a 3.9 home's fixture run now
    catches this; before, it passed 35/0 there while the tools crashed.
  - **Correction to alpha.15:** its note listed macOS with Python 3.9.6 as a tested platform on the
    strength of the 35/35 fixtures. That held for the lint only.
  - Checked on CPython 3.9.24 (fetched by uv, on Linux; not macOS): the failing tests first, then
    the fixture run, `write-paths-test.py`, `kit-update-test.py` and `spool-poll-test.py`, all
    passing. README's tooling line now says Python 3.9 or newer.
- **kit-update.py runs the plugin updates itself** (#37, po-team, Mihkel's proposal). po-team's
  marketplace is a Directory source inside the subtree, and Claude Code never re-copies from it
  unasked, so after the alpha.15 pull its plugins were still old; the tool printed the steps
  (#23) and a person had to run them.
  - After a pull that changed `memory-kit/adapters/`, with `claude` on PATH, the tool runs, in the
    home: `claude plugin list --json`, then `claude plugin marketplace update memory-kit`, then
    `claude plugin update <p>@memory-kit` for each changed plugin the list shows installed. It
    says each step (`ran: ...`), names changed plugins not installed, and ends with
    `now /reload-plugins in every session of this home`. No memory-kit plugin installed: it says
    so and runs nothing more.
  - **This widens its reach** from the home's repo to the harness's plugin state, user-level for a
    user-scope install; the docstring's "what it does, and what it never does" says so. It never
    installs, uninstalls, enables or configures a plugin, never adds a marketplace, and passes no
    `-y`.
  - `claude` not on PATH, or a list it cannot read: the steps are printed as in alpha.15 (#23). A
    failed marketplace update stops there and prints the rest; a failed plugin update is named
    and the others still run. Either way the kit update stands, exit 0 (#32's codes unchanged).
    Each call is bounded at 120 s.
  - Tests (`tools/kit-update-test.py`, 10 more) never run the real `claude`: PATH holds only a test
    folder, with or without a fake `claude`; one test runs that fake for real and checks its
    calls and their working folder.
- **Install scope, documented** (#35, the household after mac-sysops). A plugin installs at user
  scope by default, so it loads in every session on the machine. `adapters/claude-code/README.md`
  (new) has an "Install scope" section, and each plugin README's Install points at it:
  - **Outside a kit home** (no `memory-kit.conf` in the start folder), tested first: kit-update
    gives one notice per session (#31); the pane and the watch are silent. The pane does not
    open, asks nothing upstream and logs nothing; the watch delivers, writes, claims and runs
    nothing, and says nothing, also with `retireOnIdle` on (one debug line). Both still register
    their slash command and read the start folder's conf on their timers. User-scope options
    (`memoryDir`, `home`) end that silence. Tests: 3 in the watch, 3 in the pane; the behaviour
    held already, no code changed.
  - **Project scope** as the alternative, from the folder the home's sessions start in (with a
    `kit_home` pointer, that is the start folder, not the home). Not run here: the kit's tests do
    not install.
  - **The trap seen 14.10:** `claude plugin marketplace add --scope local` also rewrote the
    user-level marketplace entry. Said in the section; not filed with the harness.
  - The pane README said a subtree pull updates the installed plugin; #23 showed it does not.
    Corrected.

- **The spool poller: Windows without a console flash, a heartbeat, a reminder, JSON input** (#39,
  Pepys's survey of five seats' Lelle pollers). `adapters/claude-code/watch/spool/spool-poll.py`:
  - **Windows: `CREATE_NO_WINDOW`** for the poller `--keep-alive` starts (with
    `CREATE_NEW_PROCESS_GROUP`, and breakaway from the hook's job where allowed) and for each
    peek. It was `DETACHED_PROCESS`, which flashed a console every poll on the desk and
    framework-research. Tested by the flags passed, with a mock: this box is Linux. The desk
    will check that the poller outlives the session on Windows.
  - **Liveness heartbeat.** Each successful run writes `.<stem>.alive` beside the spool (UTC time,
    pid, interval, timeout); stale is older than two intervals and a timeout. New `--status`
    (needs only `--spool`): the lock's pid, the last successful poll and its age, stale or not;
    exit 0 running and fresh, 1 otherwise. `--keep-alive` prints one line when the running
    poller is stale, and dates the outage when it starts one.
  - **`--remind N`** (minutes, off by default): one `waiting: id=... age=... -- <line>` per id still
    in the peek N minutes after the poller first saw it. The age runs from the hub's deposit
    stamp (`--deposited`, a template, default `{deposited}`; ISO 8601), else from first sight.
  - **`--json`** in place of `--match`: the output's first JSON value, a list of objects with `id`,
    one item each; `--line` reads fields by index (`{entry[summary]}`), a missing one empty. A
    list it cannot read is a failed run (a `health:` line), never a quiet zero.
  - **The README states the ack rule**: ack by id only what you read; plain `recv` acks everything
    waiting. `recv --ack <ids>` belongs to evr-mail's owner.
  - Tests: `spool-poll-test.py` 16 -> 37, one of them a live detached poller's heartbeat and
    `--status`.

- **README**: the context-weight table regenerated with `tools/weigh.py` (its figures were stale: 680
  tokens per session, now 704; types 13 files, 5 lessons, 4 url files). The roadmap says six homes,
  and that alpha.15 shipped `owed_to` and the commitments tier ahead of 0.2, both additive. The
  layout names `write-paths-test.py` and the adapters README.

## v0.1.0-alpha.15 -- 2026-10-15 -- who is owed, standing commitments, kit-update fixes

Plugin versions this release: watch 0.3.1, obligations-pane 0.5.0, kit-update 0.3.0.
Tested platforms add macOS with the system Python 3.9.6 (mac-sysops: 35/35 fixtures at alpha.14).
*Corrected in alpha.16 (#34):* that held for the lint only. The fixtures do not run the tools' writes,
and `tools/lesson-index.py` and `tools/extract-caps.py` crash on 3.9.

- **Obligations name who is owed: `owed_to`** (#29, po-team; ruled by the household). An
  obligation has a counterparty who is waiting and would notice if it lapsed; that is why it rots
  when the counterparty acts. po-team's 16 rows held 3 obligations, 6 to-dos and 7 watches.
  - The rule: `owed_to` names someone other than the actor, and never "us" or "we". What the
    assistant owes the human is an obligation (`owed_to: <human>`); what someone owes themself
    is a to-do.
  - **To-dos are not a kit tier.** They go in the home's own work queue (a backlog file;
    scratchpad `current` for what is next). The types, ADOPTION, the skeleton's obligations file
    and the lesson `obligations-are-not-facts` say so.
  - A minor upgrade is a pull, so a row without `owed_to` never fails: the lint counts it
    (`obligations with no owed_to`) and notes it. A row with one is gated: `owed_to` equal to the
    actor, or "us" or "we" (the exact word, trimmed, any case), fails. Fixtures
    `valid/obligations-owed-to`, `invalid/obligation-owed-to-actor`, `invalid/obligation-owed-to-us`,
    `invalid/obligation-owed-to-we`.
  - `tools/obligations-due.py` prints `actor -> owed_to:` on a row that has it.
  - The obligations pane reads `owed_to` (its parser refused unknown keys, so a row with one made
    the whole file unreadable) and shows it as the tool prints it: `actor -> owed_to: text`, the
    party owed bold in its own colour. A row without one looks as before.
- **A commitments tier, optional** (#30, po-team; ruled by the household). Some things never
  leave the table: a promise ("answer the board's email within 3 days") or a watch ("if a second
  collective is provisioned, re-check the park"). Each time its trigger happens it creates an
  obligation, which goes to `obligations.yaml` and is deleted when resolved. Until now these sat
  in obligations with an invented expiry (#27), or in rules and prose.
  - `memory/commitments.yaml`, `types/memory-commitments.ts`. A row: `trigger`, `obligation`
    (what is then owed), `actor`, `owed_to`, `within` (how long, in words), `ref`. No `expires`:
    it never expires; only a ruling retires it.
  - **A home opts in by creating the file**; without it nothing changes. The skeleton does not
    ship one.
  - Gated whole, since no row predates the tier: every field but `ref` is required, `owed_to`
    follows the #29 rule (never the actor, "us" or "we"), `trigger` and `obligation` share the
    obligation cap (120 chars). Fixtures `valid/commitments`, `invalid/commitment-missing-owed-to`,
    `invalid/commitment-owed-to-actor`, `invalid/commitment-has-expires`,
    `invalid/commitment-missing-within`.
  - The lint used to read any other top-level `<name>.yaml` as a scratchpad, `commitments.yaml`
    included; it now reads that name as this tier, unless the file is scratchpad-shaped
    (`current`/`staging`, no `commitments` key), so a home's scratchpad of that name still
    passes. Fixture `valid/commitments-named-scratchpad`.
  - Not read by the obligations pane or `obligations-due.py`: a commitment has no date.
- **The lint banner names VERSION; a stale caps.yaml fails the fixture run** (#26, mvox and the
  workshop). alpha.14 shipped caps.yaml still at alpha.13, so every lint banner said alpha.13.
  - The banner reads the kit's `VERSION`, the one place the version lives (caps.yaml's copy only
    for a kit without one).
  - `lint/run-fixtures.sh` now runs `tools/extract-caps.py --check` and checks the banner: a
    release that bumps VERSION without regenerating caps.yaml fails it. **Release step:** after
    bumping VERSION, run `python3 tools/extract-caps.py`.
  - caps.yaml regenerated (version line only).
- **kit-update.py refuses an unknown option** (#32, the workshop). It kept only the arguments
  not starting with `--` and looked for `--dry-run`, so any other flag was dropped: `--help` ran a
  real update, and a typo'd `--dry-rn` would too. Now `--help` (or `-h`) prints the usage and runs
  nothing; any other option, or a second home, is bad usage: exit 2, nothing run.
- **kit-update.py no longer refuses a home for untracked files outside the kit** (#25, mvox). An
  untracked `scratchpad/` folder refused the update as "uncommitted changes". The undo is a
  `reset --hard`, which leaves untracked files alone, and the pull writes only under
  `memory-kit/`. Now a tracked change anywhere still refuses, and so does an untracked file under
  `memory-kit/` (the pull writes there, and the lint reads the kit); an untracked file elsewhere
  does not. The refusal names the files (five, then a count).
- **kit-update.py names the plugin-update steps** (#23, po-team). A subtree pull never updates an
  installed plugin (the harness keeps its own copy from the install), so po-team's pane stayed at
  0.1.0 through `/reload-plugins`. When the pull changed anything under `adapters/`, the tool now
  names the changed plugins and the sequence, as UPGRADE.md does: `claude plugin marketplace
  update memory-kit`, `claude plugin update <plugin>@memory-kit` for each changed one the home
  has installed, then `/reload-plugins` in every session of the home. It names them; it does not
  run them.
- **kit-update says when the start folder has no memory-kit.conf** (#31, the workshop). With no
  conf (and no pointer), the plugin read the channel as pinned and the version as missing and
  returned without a word: 13 hours of silence that looked like "nothing newer". Now it is one
  visible notice, and `/kit-update` shows it: "<folder> has no memory-kit.conf, so it is not a kit
  home; if the home is elsewhere, put kit_home: <path> in a memory-kit.conf here. kit-update checks
  nothing until it has one." `tools/kit-update.py` says the same, exit 2. The notice text is
  shared: `noConfNotice` in each plugin's identical `hooks/kit-home.ts`, `no_conf_notice` in
  `lint/kit_home.py`, tested to the same string.

## v0.1.0-alpha.14 -- 2026-10-14 -- the pointer home, one drain per home, ultrareview fixes

Plugin versions this release: watch 0.3.0, obligations-pane 0.4.0, kit-update 0.2.0.
The kit_home pointer was checked live before release: a pointer-only start folder, the watch
draining through it in under 5 s, the pane showing the pointed home's VERSION and rows, and a
bad source format or obligations key reported in-session, never swallowed.

Known trap, found in that live test: **two enabled plugins with the same name (e.g. a released
and a branch copy from differently named marketplaces) collide silently** -- only the user-scope
copy's mods run. Disable one copy before testing the other.

- **`kit_home:` in memory-kit.conf names the kit home** (#18, from the pepys desk).
  - A folder that is not the home holds a pointer conf, `kit_home: ../desk` (absolute, or relative
    to that conf's folder), instead of setting a plugin's `home`/`memoryDir` for every session on
    the machine.
  - The pointer is followed one hop, never chained; a loop is refused, and `kit_home: .` is just
    the home. A target with no `memory-kit.conf`, or a `~` path, is a problem said plainly, never
    a silent fall back.
  - The home's own conf counts: `memory_dir` (relative to the home), `update:`, `upstream:`,
    `watch_sources`, mode. The pointer conf's other keys are ignored and reported.
  - The lint, `tools/kit-update.py` and `tools/obligations-due.py` follow it (`lint/kit_home.py`).
    A pointer-only conf passes the lint when its home does. Fixtures `valid/kit-home-pointer`,
    `invalid/kit-home-chained`, `invalid/kit-home-no-conf`. `lesson-index.py` takes a memory
    directory, not a home, so it has nothing to follow.
  - All three plugins follow it the same way (`hooks/kit-home.ts`, one identical copy each; the
    fixture run fails when the copies differ). The start folder's pointer wins over the user-scope
    `home` (watch, kit-update) and `memoryDir` (pane), which the READMEs now say apply to every
    session on the machine. A broken pointer is visible in each: a notice (watch, kit-update),
    the pane's body (pane). A pointed home without VERSION shows `memory-kit ?` (pane), or is a
    notice (kit-update). Keys left in a pointer conf that a plugin reads are reported as ignored.
- **The watch delivers one prompt per poll** (#17, context load). Every delivered prompt is a
  turn carrying the session's whole context, so a burst of N items used to cost N full turns.
  What one poll drained now goes as one prompt: a single item as before, several one per line
  under `[watch] N items, oldest first:`, at most 20 to a prompt. Custody is unchanged: the batch
  leaves its pending files only once the submit was accepted; a refusal keeps it whole; a crash
  can repeat one batch, never lose one. The README now states the cost of every delivered
  prompt plainly.
- **One drain per home** (#17, FR's warning). Two guards:
  - The `home` option counts only for a session started inside that home. It applies to every
    session on the machine, so it no longer makes them all drain one home's sources. A session
    outside the home gets one notice naming the `kit_home` pointer. Behaviour change: a home
    watched from another folder through the option alone now needs the pointer.
  - One session per home through a `$.store` claim (`drain:<home>`), as kit-update claims a
    release. The claim is read back at once (the last writer wins), refreshed every poll tick
    (also while a delivery waits for a busy turn), let go at `session.end`, and taken over when
    60 s stale. Other sessions in the home deliver nothing from it and get one notice naming the
    holder. `/watch` says who drains.
  - Checked live: the store is shared across processes, and the takeover works when the holder
    exits.
- **A remote hub feeds the watch through a peek-only spool poller** (#16, the fleet's Lelle
  pattern). New `adapters/claude-code/watch/spool/spool-poll.py` (stdlib only), generic over the
  command:
  - It runs a peek-only command every 30 s and appends one line per new item to a spool, which
    the home declares as a `lines` source. The command is e.g. `evr-mail recv --peek`; items are
    matched by a regex with a named `id` group, and the line is written from a template.
  - It keeps a seen-id set (the last 500), and writes one `health:` line after 3 failures in a row,
    then at most one per 30 min, then `health: recovered`.
  - One poller per spool, through a lock beside it (the `flock` lock).
  - `--keep-alive` is for a SessionStart hook: it starts one detached poller unless one runs, and
    returns at once. It needs no `flock`/`setsid` commands; the Windows path is untested.
  - The README documents the pattern, the hook, and that custody stays with the session's own
    `recv`.
  - Tests: `spool-poll-test.py` (unittest, no network; it starts a real detached poller with a
    fake peek and stops it again). Checked live: the SessionStart hook fired, one poller ran for
    two sessions and outlived the first, and three mails arrived as one prompt.

Fixes from the ultrareview of main at v0.1.0-alpha.13 (to ship in alpha.14):

- **Lesson summary cut by ` #`** (finding 2). `link-a-ticket-with-a-url-file.md`'s unquoted
  summary held ` #123)`, which YAML reads as a comment, so the index carried "Make a ticket key
  (Jira VEO-214, issue". The summary is quoted and the index regenerated. New lint check: a lesson
  summary whose plain value holds ` #` fails, read from the raw front matter (the parsed value has
  already lost it). Fixture `invalid/lesson-unquoted-hash`. Only `summary`: the short fields may
  carry a deliberate trailing comment, which raw text cannot tell from a cut value.
- **kit-update.py checks the hop from the home's own version** (finding 1). The step path was
  built from upstream tags alone, so a home whose own tag is gone upstream skipped the check of
  its first hop, and with one release left, every check. The path now always starts at the
  home's current version; a missing UPGRADE.md entry for any hop refuses. New:
  `tools/kit-update-test.py` (stdlib unittest, a fake `subprocess.run`, no network, no git).
- **kit-update.py says when its undo fails** (finding 4). After a failed pull or lint gate, the
  `git reset --hard` back to the start was not checked, and the tool always said "undone". Now
  a failed reset says the tree may be partly pulled and how to recover (a stale `index.lock`,
  then `git reset --hard <start>`), and exits **3**, a code of its own.
- **kit-update.py bounds its network calls** (finding 5). `git fetch` and `git subtree pull` had
  no timeout and could hang on a stalled remote. Both now stop at 300 s (`NETWORK_TIMEOUT`): a
  timeout is a failure; a timed-out pull goes through the undo, and a timed-out fetch changes
  nothing. git never waits on a credential prompt (`GIT_TERMINAL_PROMPT=0`).
- **The kit-update plugin decides as the script does** (finding 3). Its auto/manual check
  required only an UPGRADE.md entry ending at the target, so it could promise a run the script
  then refused. It now walks the script's path (the home's version, always, then every release
  tag up to the target) and needs an entry beginning "no data step" for each hop; otherwise
  "manual upgrade needed (UPGRADE.md has no entry for A -> B)". The plugin's version is unchanged
  (0.1.0); the household versions it with the release.

## v0.1.0-alpha.13 -- 2026-10-14 -- kit updates: channels, the tool, the plugin

- **New adapter: `adapters/claude-code/kit-update/`, kit-update 0.1.0** (#15 part 3; built by the
  workshop's agent, 35/35 tests). A third plugin in the `memory-kit` marketplace. Every
  `checkMinutes` (default 60) it checks upstream for a newer release on the home's channel and
  prompts the session once per release, across all the home's sessions (a `$.store` claim, proven
  live with two sessions). A release with a data step or a new major gets "manual upgrade needed".
  The prompt defers to the home's UPGRADE.md and push rules and authorizes nothing. It never runs
  git and writes no files. `/kit-update` shows the channel, versions, last check and prompt state.
- **Tool: `tools/kit-update.py`** (#15, parts 1-2). A home's `memory-kit.conf` names a channel,
  `update: pinned` (default), `verified` or `latest`. The tool moves the vendored kit to the newest
  release that channel allows: it refuses a dirty tree, a home already failing its lint, a new
  major, and any step whose UPGRADE.md entry is not "no data step". It pulls, runs the lint gate,
  undoes the pull on failure, commits locally, and **never pushes**. `--dry-run` shows the plan.
- **Verified markers:** a tag `verified/v<version>` marks a release the household has passed
  (the kit rule: adopt first, then announce). The first is `verified/v0.1.0-alpha.12`.

- **Lesson: link a ticket with a URL file** (#6, item 1). A Jira key or issue number becomes a
  clickable pane link and a checkable ref by getting its own `urls/<key>` file. Solved by
  convention, not code: the kit stays tracker-neutral (PO, 2026-10-14). The pane README points to it.
- The kit's lesson index is regenerated by `tools/lesson-index.py`; its old header named a tool
  that was never written.

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
