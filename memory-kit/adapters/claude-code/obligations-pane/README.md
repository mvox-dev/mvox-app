# obligations-pane

A Claude Code side pane (a function-hooks mod) that shows a memory-kit home's obligations
tier: `memory/obligations.yaml`, soonest expiry first. Built against Claude Code 2.1.296's
plugin API (early access; the API moves between releases).

## What it shows

- **Header** (sticky, dark on the pastel): local date and time to the minute, bold, then the
  counts `N expired · M due ≤7d`, then the scroll position `i/n`.
  - Expired means `expires` is before today.
  - Due means `expires` falls between today and today + 7 days, both ends included.
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
  - `check` and `since` are not shown, to keep rows light.
- **Footer** (sticky, under one `─` rule across the pane, no frame): one line for the session's main agent: the name in 10 columns (longer
  names get 9 chars + `…`), a colour-coded model letter, and the context weight such as
  `127k/1M`. The letters are F = Fable, O = Opus, S = Sonnet, H = Haiku, and a dim `·` when the model is unknown.
  One more line per live subagent or teammate follows, in the same name and model columns,
  then its context load (dimmed unless running). The load is the latest model step's input,
  cache read, cache write and output tokens added together. It reads `84k/1M` when the agent
  runs on the main loop's model, whose window the session reports, and `84k` alone otherwise:
  windows are never guessed. An agent with no step seen yet shows a dim `·` and no load.
- **Footer figures are never cut.** The pane knows its width from the harness
  (`e.props.bodyColumns`). The footer subtracts its padding (one column each side) and shows `used/window`
  only when the whole line fits, otherwise `used` alone. Its lines wrap rather than truncate, so
  at extreme widths a figure moves to the next row instead of getting an ellipsis.
- **Scrolling**: the mouse wheel over the pane steps strictly one obligation per event, in the
  direction of the tick. Further events are ignored for 150 ms after a step, so a trackpad or
  fast-wheel burst moves one item. The index is clamped to the list. The `k` and `j` hotkeys step one while the
  pane has the keyboard. They live on two Buttons inside a Box that is not displayed.
- **Refresh**: every 20 s, which also moves the clock, and at the end of every turn. The mod
  API has no file watch, so the file is re-read each time.
- **Empty states**: a missing file says `no obligations file here (<path>)`. An empty list says
  `no obligations`. A file the parser rejects says `obligations.yaml unreadable: line N: <why>`.

Width: the harness decides. Unasked, the pane opens docked only on a wide terminal (144
columns, 110 once asked), otherwise it waits. `/obligations` opens it at any width.

## Data source

- `<cwd>/<memory_dir>/obligations.yaml`, where `<cwd>` is the session's working directory.
  `memory_dir` comes from `<cwd>/memory-kit.conf` and defaults to `memory`. One install
  therefore serves every kit home.
- Shape: `memory-kit/types/memory-obligations.ts`, a list of
  `{obligation, actor, since, check, expires, ref}`.
- Links: `memory/urls/<name>` holds one URL on line 1 (`memory-kit/types/memory-urls.ts`). The
  pane reads these files and never writes them.
- Parsing uses a small strict parser for exactly this shape, in `hooks/obligations.ts`. The mod
  environment has no bundler and no `node_modules`, so a YAML library is not an option.
  - Accepted: comments, `obligations:` or `obligations: []`, and list items of flat
    `key: value` maps with double-quoted, single-quoted or plain scalars.
  - Rejected, with the line number: anything else, such as unknown keys, duplicate keys,
    block scalars, a non-ISO `since` or `expires`, or a missing `obligation`, `actor` or
    `expires`.

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

The plugin is read from that folder, so a kit upgrade (subtree pull) updates it; run
`/reload-plugins` in a running session. Optional: `/plugin configure obligations-pane@memory-kit`
to set the footer's agent name. `/obligations` opens the pane at any width.

Or for one session only: `claude --plugin-dir ./memory-kit/adapters/claude-code/obligations-pane`.

## Develop

```sh
claude plugin validate .
claude plugin test .          # tests/*.test.ts
tsc -p .                      # once Claude Code has laid .claude-plugin/types/ (gitignored)
```

`tsc -p .` needs the type declarations, which Claude Code writes into
`.claude-plugin/types/` when it loads the mod from a watched folder. Before that, type-check
with a tsconfig kept outside the folder whose `include` names the `claude-code.d.ts` that the
plugin-authoring skill writes, plus `hooks`, `types` and `tests`.

## Capture

The pane over the workshop's real `memory/obligations.yaml` at 56 columns on 2026-10-14
01:14 EEST, with one teammate running. The capture is a text approximation of the drawn tree.
Colours are not shown: the background is pastel yellow, the header is dark, Mihkel is pink,
the Prusa actor gets a palette colour, and the link is dark blue.

```text
 2026-10-14 01:14  0 expired · 1 due ≤7d           1/6

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
