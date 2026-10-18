# obligations-pane

A Claude Code side pane (a function-hooks mod) that shows a memory-kit home's obligations
tier: `memory/obligations.yaml`, soonest expiry first. Built against Claude Code 2.1.296's
plugin API (early access; the API moves between releases).

## What it shows

- **Header** (sticky, dark on the pastel), bold: the home's kit version, then the counts
  `N expired · M due ≤7d`, then the scroll position `i/n`. For example
  `memory-kit 0.1.0-alpha.5  0 expired · 1 due ≤7d  1/6` (since 0.3.0, kit #4; it showed the
  date and time before).
  - The version is line 1 of `<home>/memory-kit/VERSION`, the home's pinned kit, not the pane's
    own version. The home is the folder that holds the memory directory (for a `memoryDir`
    session that runs outside it), else `<cwd>`: the first of the two with a VERSION. Without
    one the slot is empty: never a guess.
  - When upstream has a newer release: `memory-kit 0.1.0-alpha.5 · alpha.6 out`. A newer
    pre-release of the same version shows its pre-release part alone; a different
    major, minor or patch shows the whole version, as `· 0.2.0 out` (kit #7, see Release check).
  - Expired means `expires` is before today.
  - Due means `expires` falls between today and today + 7 days, both ends included. Today is the
    local date, which the header no longer shows.
- **Body**: one row per obligation, ordered by `expires` (expired first), ties by `since`,
  then file order.
  - The due date comes first, bold and black. An expired date also gets a salmon background.
  - The actor follows, bold, in a colour that is stable per party: a hash of the lower-cased
    name picks from a palette of dark colours that read on the pastel. "Mihkel" has a fixed
    colour of his own. A long actor is capped at 20 columns (19 chars + `…`), so the task text
    starts on the first line.
  - The obligation text comes last.
  - Every `urls/<name>` in the text becomes a dark-blue underlined link (OSC 8 in the
    terminal; Ghostty clicks it). Links cited only in `check` or `ref` trail the text.
  - A `urls/<name>` with no file, or with an unusable one, is drawn struck through and grey.
  - Tickets (a Jira key, an issue number) link the same way: give the ticket its own URL file,
    e.g. `memory/urls/veo-214`, and cite `urls/veo-214`. The pane recognises no ticket patterns
    on purpose; see the kit lesson `link-a-ticket-with-a-url-file` (#6).
  - A row with `owed_to` (kit #29) reads `actor -> owed_to: text`, as `tools/obligations-due.py`
    prints it; the party owed is drawn as an actor is (bold, its own colour, 20 columns). A row
    without one reads `actor text`, as before.
  - `check` and `since` are not shown, to keep rows light.
- **Footer** (sticky, under one `─` rule across the pane, no frame): one line for the session's main agent: the name in 10 columns (longer
  names get 9 chars + `…`), a colour-coded model letter, and the context weight such as
  `127k/1M`. The letters are F = Fable, O = Opus, S = Sonnet, H = Haiku, and a dim `·` when the model is unknown.
  One more line per live subagent or teammate follows, in the same name and model columns,
  then its context load (dimmed unless running). The load is the latest model step's input side:
  input, cache read and cache write tokens added together, output left out, as Claude Code
  computes the status line's `used_percentage` (since 0.6.0; output was added before). It reads `84k/1M` when the agent
  runs on the main loop's model, whose window the session reports, and `84k` alone otherwise:
  windows are never guessed. An agent with no step seen yet shows a dim `·` and no load.
  One more line per running workflow follows (since 0.6.0): its name in the name column, a `≡`
  where the model letter stands, the current phase, and agents done/started, for example
  `pane-live… ≡ Finish 2/3`. The line shows while one of the run's agents works and goes when
  the last finishes. `$.agent.list()` leaves a workflow's agents out, so the pane counts them
  itself: `agent.spawn` tags each with its run id (`e.workflow.runId`) and `turn.complete` names
  the one that finished. "Started" counts the agents started so far: a run announces no total.
  - The phase is read from the run's journal,
    `<config>/projects/<cwd slug>/<session id>/subagents/workflows/<run id>/journal.jsonl`
    (the `phase` of its last `started` entry). That file is Claude Code's own and undocumented:
    when it cannot be read, the label of the latest started agent gives the phase by convention,
    the part before its first colon (`Review:bugs` -> `Review`); a label without a colon gives none.
  - The name is the saved script's, `<session dir>/workflows/scripts/<name>-<run id>.js`. A run
    started again from a saved script keeps the first run's file name, so it shows its run id.
- **Footer figures are never cut.** The pane knows its width from the harness
  (`e.props.bodyColumns`). The footer subtracts its padding (one column each side) and shows `used/window`
  only when the whole line fits, otherwise `used` alone. Its lines wrap rather than truncate, so
  at extreme widths a figure moves to the next row instead of getting an ellipsis.
- **Scrolling**: the mouse wheel over the pane steps strictly one obligation per event, in the
  direction of the tick. Further events are ignored for 150 ms after a step, so a trackpad or
  fast-wheel burst moves one item. The index is clamped to the list. The `k` and `j` hotkeys step one while the
  pane has the keyboard. They live on two Buttons inside a Box that is not displayed.
- **Refresh**: every 20 s and at the end of every turn. The mod API has no file watch, so the
  file and VERSION are re-read each time. Each refresh also runs the release check, which asks
  the network at most once every 6 h.
- **Empty states**: a missing file says `no obligations file here (<path>)`. An empty list says
  `no obligations`. A file the parser rejects says `obligations.yaml unreadable: line N: <why>`.

Width: the harness decides. Unasked, the pane opens docked only on a wide terminal (144
columns, 110 once asked), otherwise it waits. `/obligations` opens it at any width.

## Data source

- `<memory dir>/obligations.yaml`. The memory directory is, in order:
  0. a `kit_home` pointer in `<cwd>/memory-kit.conf`: `<home>/<memory_dir>` of the home it names
     (since kit #18; see "A session outside its home"). It wins over the option.
  1. the `memoryDir` option, when set. A relative path resolves against `<cwd>`. Absolute is
     POSIX (`/...`), a drive letter (`C:\...` or `C:/...`) or UNC (`\\server\share`), since
     0.3.0 (kit #8); the same holds for `memory_dir`. For a lead
     session that runs outside its home (a team folder, a sibling repo).
  2. `<cwd>/<memory_dir>`, with `memory_dir` read from `<cwd>/memory-kit.conf`.
  3. `<cwd>/memory`.

  `<cwd>` is the directory the session started in, not where it is now (since 0.2.1, kit issue
  #3). A shell `cd` into another repo mid-session does not switch the ledger. The start directory
  is kept in `$.state`, so a mod reload (which fires `session.start` again, with the directory
  the session is in by then) keeps it too. Only when no start was seen does the pane fall back
  to `$.session.cwd()`.

  Left empty, one install therefore serves every kit home. The value is stored in settings under
  `pluginConfigs`; **set in the user's settings, it points every session on the machine at that
  one home.** For a session that starts outside its home, use a `kit_home` pointer conf in its
  start folder instead (kit #18): the lint and the tools follow it too, so it no longer makes
  that folder look like a home.
- Shape: `memory-kit/types/memory-obligations.ts`, a list of
  `{obligation, actor, since, check, expires, ref}`.
- Links: `memory/urls/<name>` holds one URL on line 1 (`memory-kit/types/memory-urls.ts`). The
  pane reads these files and never writes them.
- Parsing uses a small strict parser for exactly this shape, in `hooks/obligations.ts`. The mod
  environment has no bundler and no `node_modules`, so a YAML library is not an option.
  - Accepted: comments, `obligations:` or `obligations: []`, and list items of flat
    `key: value` maps with double-quoted, single-quoted or plain scalars.
  - The items may sit at column 0 under `obligations:`, as `yaml.safe_dump` writes them, or be
    indented (since 0.3.0, kit #5). One file uses one indent throughout.
  - A value may continue on lines indented deeper than its key and folds as YAML folds it.
    Single quotes double a quote (`''`). Double quotes take YAML's escapes, `\x`, `\u`, `\U`
    and an escaped line end included. A plain `null` or `~` is empty.
  - In short: whatever `yaml.safe_dump(data, sort_keys=False)` writes, with or without
    `allow_unicode`, parses to what PyYAML reads back. The test fixture is that real output
    (`tests/fixtures/make-safe-dump.py`).
  - Rejected, with the line number: anything else, such as unknown keys, duplicate keys,
    block scalars, flow collections, nested maps, a non-ISO `since` or `expires`, or a missing
    `obligation`, `actor` or `expires`.
  - The proposed wording for the kit's `types/memory-obligations.ts` is in
    `PROPOSED-types-doc.md`, for upstream to apply.

## Release check

Since 0.3.0 (kit #7), the pane notices a newer kit release by itself.

- **Source**: the Forgejo tags API, anonymous, through `$.http.fetch`:
  `https://codeberg.org/api/v1/repos/<owner>/<repo>/tags?limit=50`. That is the newest 50 tags,
  newest first.
- **Upstream**: `mitselek/memory-kit` unless the home's `memory-kit.conf` (the home whose
  VERSION the header shows) has an `upstream:` key. Its value is `owner/repo` on Codeberg, e.g. `upstream: someone/memory-kit`. Any other
  value, a full URL included, makes no request and writes one debug line.
- **Which tags count**: release tags only, `v<major>.<minor>.<patch>` with an optional
  `-alpha.N`, `-beta.N` or `-rc.N`. They compare by semver precedence (alpha.10 > alpha.9,
  alpha < beta < rc < the release). Other tags are ignored.
- **Interval**: at most one request per upstream every 6 hours. The result is cached in
  `$.store` under `upstream` (`url -> { checkedAt, latest }`). The store is the plugin's own and
  shared by every session, so ten open sessions make one request.
- **No VERSION file**: no request, no comparison, no note.
- **Never waits on the network**: no hook awaits the check; session start and turn end return
  once the local refresh is done. `$.http.fetch` has no timeout of its own, so a request not
  answered in 10 s (on `$.clock.after`) is a failed check.
- **Failure is silent**: a refused request, a timeout, an error status or an answer that is not
  a tags list keeps the last known result, or shows nothing. It writes one `debug` log line and
  never draws an error. A failure counts as a check, so the next try comes 6 h later.
- **Off switch**: `checkUpdates: false` makes no request at all and shows no note.
- **Read-only**: the pane never pulls or upgrades anything. Upgrading stays `UPGRADE.md`, run by
  the home's assistant.

## A session outside its home: `kit_home` (kit #18)

**User-scope options apply to every session on the machine.** That covers `memoryDir` set in the
user's settings, not only the home's own sessions. On the pepys desk a user-wide `home` made
every session on the box drain the desk's spool, and six notifications were lost. Use a pointer
conf instead: put this in the folder the session starts in:

```yaml
kit_home: ../desk        # absolute, or relative to this conf's own folder
```

- **What counts:** the home it names. That home's `memory-kit.conf` counts (`memory_dir`, `upstream:`), with paths
  relative to that home, and so does its `memory-kit/VERSION`. Other keys left in the pointer
  conf are ignored.
- **Precedence:** the start folder's pointer first. It wins over the user-scope `memoryDir` option. Then
  the option, then the start folder itself.
- **One hop, never chained.** If the target's own conf points on, that is refused, and so is a
  loop. `kit_home: .` is just the home.
- **Absolute paths:** POSIX, a drive letter (`C:\` or `C:/`) or UNC. `~` is not expanded: write
  the path absolute or relative to the conf.
- **Never silent:** a broken pointer fills the pane with "kit_home pointer broken: <why>", and the pane opens itself to show it, never the start folder's ledger instead. A pointed home without `memory-kit/VERSION` shows `memory-kit ?` in the header and asks upstream nothing.
- The lint and the tools follow the same pointer (`lint/kit_home.py`). This plugin's copy of the
  rules is `hooks/kit-home.ts`, identical in all three plugins; `lint/run-fixtures.sh` fails when
  the copies differ.

## Read-only

The pane never writes: not obligations, not `urls/`. Mihkel ruled on 2026-10-14 that it stays
read-only for good. Resolving or advancing an obligation happens in the file, by whoever owns it.

## Install

**From the kit** (any home that vendors memory-kit at `memory-kit/`), in a terminal at the
home's root:

```sh
claude plugin marketplace add ./memory-kit/adapters/claude-code
claude plugin install obligations-pane@memory-kit
```

A kit upgrade (subtree pull) does not update the installed plugin: the harness keeps its own
copy from the install (kit #23). After a pull that changed it, `claude plugin marketplace update
memory-kit`, `claude plugin update obligations-pane@memory-kit`, then `/reload-plugins` in a
running session; `tools/kit-update.py` runs the first two itself when `claude` is on PATH (#37).

**Scope.** This installs at user scope: every session on the machine loads the plugin. What it
does in a folder that is not a kit home, and the project-scope alternative:
[Install scope](../README.md#install-scope-kit-35).

Optional: `/plugin configure obligations-pane@memory-kit`
to set the footer's agent name. `/obligations` opens the pane at any width.

Or for one session only: `claude --plugin-dir ./memory-kit/adapters/claude-code/obligations-pane`.

Options (`userConfig`):

- `agentName` is the footer name of the main agent. Left empty, the footer uses the working
  directory's name. A home's own `agent_name:` in its `memory-kit.conf` wins over it (gh#4):
  plugin options are read from user settings only, so on a box with several homes each one
  names itself there.
- `memoryDir` points the pane at a home's memory directory (see Data source). **Set user-wide, it
  applies to every session on the machine**: prefer a `kit_home` pointer conf, which also wins
  over this option.
- `autoOpen` (default on) opens the pane at session start, but only where an obligations file
  exists.
- `checkUpdates` (default on) runs the release check (see Release check). Off, the pane makes
  no network request at all.

One key in the home's `memory-kit.conf` is read besides `memory_dir`: `upstream: owner/repo`
(see Release check). The lint ignores keys it does not know.

## Develop

```sh
claude plugin validate .
claude plugin test .          # tests/*.test.ts; no test reaches the network
python3 tests/fixtures/make-safe-dump.py   # regenerates the yaml.safe_dump fixture (PyYAML)
tsc -p .                      # once Claude Code has laid .claude-plugin/types/ (gitignored)
```

`tsc -p .` needs the type declarations, which Claude Code writes into
`.claude-plugin/types/` when it loads the mod from a watched folder. Before that, type-check
with a tsconfig kept outside the folder whose `include` names the `claude-code.d.ts` that the
plugin-authoring skill writes, plus `hooks`, `types` and `tests`.

For live testing in a session, link a working copy into the session's dev-mods folder. Claude
Code then asks once whether to enable hot reloading for that session:

```sh
ln -s <working copy>/obligations-pane ~/.claude/dev-mods/<session-id>/obligations-pane
```

## Capture

The pane over the workshop's real `memory/obligations.yaml` at 56 columns on 2026-10-14
01:14 EEST, with one teammate running; the header line is redrawn in the 0.3.0 format. The
capture is a text approximation of the drawn tree. Colours are not shown: the background is
pastel yellow, the header is dark, Mihkel is pink, the Prusa actor gets a palette colour, and
the link is dark blue.

```text
 memory-kit 0.1.0-alpha.5  0 expired · 1 due ≤7d    1/6

 2026-10-21 Mihkel Start print M3T06 on keldri (on the
 printer since 2026-10-13 07:28, not started).

 2026-10-28 Mihkel Inspection of M3T02 (queue entry 10:
 2-strand outer skin above z 3.0, floor centre links).

 2026-10-28 Mihkel M3T04 findings still open (entry
 13): layer 1 and stepped top, floor joins, strength by
 hand.

 2026-10-28 Mihkel Findings for M3T06: columns, slip
 seam, kink blobs, inner-skin fan (queue entry 15
 checklist).

 2026-10-28 Mihkel Rule GATE 3 of the memory-kit
 adoption (deletions) once a cold start has run on the
 new tree.

 2026-12-31 Prusa (prusa3d/Prus… Explain why the INDX
 start gcode retracts an extra 0.04 mm (asked on their
 settings repo). prusa-start-ooze-issue
────────────────────────────────────────────────────────
 workshop   O 127k/1M
 obligatio… O
```

## API notes (2.1.296, against the shipped `.d.ts`)

In short: `$.agent.list()` has no `model` and excludes the main loop, and `Link` has no colour prop.

- `$.agent.list()` lists subagents and teammates only, not the main loop, and its rows carry no
  `model`.
  - The main agent's model comes from `$.session.model()`.
  - A subagent's model is the one its latest `turn.step` usage reports, falling back to the
    model its `agent.spawn` resolved. Agents spawned before the mod loaded show a dim `·` until
    their next step.
- `$.session.usage()` with no arguments is free and gives `context.tokens` and
  `context.window` for the main loop only.
- A subagent's load comes from `turn.step`: a streaming event, so the hook is an async generator.
  It does `yield* next(e)`, records `result.usage` under `e.agentId` (absent on the main loop),
  and returns the result unchanged.
- In `claude plugin test`, `$.turn.step(...)`'s `.result` came back undefined. The test reads the
  generator's own return value instead.
- `Link` has no colour prop. The dark blue comes from a `Text` child inside the `Link`, since a
  `Link`'s children may be inline elements.
- A `Pane` reads `e.props.scroll.bodyRows` for its height. The engine scrolls a focused pane's
  body with the arrow keys.
- `ui.scroll` (matcher `{ component: 'Pane', requestId }`) fires before the window moves, for
  the wheel and the scroll keys. The hook steps the index by `sign(e.by)` and answers `{}` without
  `next(e)`, so the engine's window stays and the header and footer stay fixed. The `$.state`
  write redraws the pane, so no `$.ui.invalidate` is needed.
- A function that receives `$` must be declared at the module's top level. `claude plugin
  validate` refuses `$` passed to a closure.
