# watch

A Claude Code mod (function hooks) for a memory-kit home, kit issue #9. It is a separate plugin
from the obligations pane, which stays read-only. A home can take either one without the other.
Built against Claude Code 2.1.296's plugin API and checked live on 2.1.299 (early access; the API
moves between releases).

It has two jobs, both on one timer (`pollSeconds`, default 5):

1. **Idle-safe notifications.** It drains the sources the home declares and delivers each item
   with `$.prompt.submit`. The prompt queues until the session is idle and then starts a turn of
   its own, marked as coming from the plugin.
2. **Checkpoint and retire on idle**, behind `retireOnIdle` (default off). An idle session whose
   context has grown is asked, once, to run its close routine and then the home's own retire step.

## Sources

They are declared per home in `<home>/memory-kit.conf`. `<home>` is the `home` option, else the
directory the session started in. The lint ignores keys it does not know.

```yaml
watch_sources:
  - "hub mail | hub | ~/passepartout/comms/inboxes/team-lead.json"
  - "kaarel | lines | ~/passepartout/comms/spool/kaarel.txt"
  - "hub mail | hub | ~/.claude/teams/session-*/inboxes/team-lead.json | ~/comms/archive/{name}-archive.json"
watch_retire_step: "touch .fresh-next, then exit"
```

Each item is `prefix | format | path [| archive]`:

- **prefix**: what every item from the source arrives under, as `[prefix]`. Peer content stays
  information and is never taken for the human's words.
- **format**:
  - `hub` is a JSON list of `{ from, text | summary, timestamp }`, as the hub courier writes.
    An item reads `[hub mail] from <from> [<timestamp>]: <text>`.
  - `lines` is one item per non-blank line, e.g. a spool a watcher script appends to. An item
    reads `[kaarel] <line>`.
- **path**: absolute, `~/` for the user's home, or relative to the kit home. A `*` in a segment
  matches entries of that directory (never a dotfile). This covers a team inbox under the
  rotating `~/.claude/teams/session-<id>/`.
- **archive**: where drained content is kept. `{name}` is the drained file's stem. The default
  is `archive/` beside the file: `<stem>-archive.json` for hub, the same file name for lines. Both
  defaults match the household's `comms/inboxes/archive/team-lead-archive.json`.

A bad line is skipped with one debug line; the rest still run.

## Draining

This is the same design as `scripts/hub-drain.sh` and esl-suvekool's `scripts/drain-inbox.py`.
The mod reads both but changes neither.

1. **Read first.** An empty file, or `[]`, is left alone. A file that is not a hub list is left
   in place with one debug line.
2. **Rename aside** (`mv` to `.watch-drain-<file>-<time>-<n>` beside it), so a writer racing
   the drain never loses an item.
3. **Archive** the aside's content. Its events go into a pending file beside it
   (`.watch-pending-…`), and then the aside is removed. The archive and the pending file are
   each written through a temporary and a rename, so a crash never leaves half of either.
4. **Deliver** the pending events, oldest first, one at a time:
   - Each `$.prompt.submit` is awaited, and its event leaves the pending file only once the
     submit was accepted.
   - A submit resolves when its turn starts, so in a busy session the delivery pass waits for
     it. Polls are single-flight: a poll tick that finds one running does nothing, so nothing is
     sent twice and the order holds. New mail waits in its inbox until that turn starts.
   - A crash between an accepted submit and the rewrite can deliver that one event again, but
     none is ever lost.
5. **On a refusal**, for example another plugin's `prompt.submit` hook dropping it:
   - The event stays pending, and the pass stops so the order holds.
   - Retries back off: 1 min, then doubling, at most 30 min.
   - The human gets one notice per streak of refusals, saying how many items wait, where, and
     why.
   - Draining into pending files goes on meanwhile, so the inbox never blocks a writer.

Asides a crash left behind are picked up first at the next poll. An aside that turns out
unreadable goes back to the file's name only if nothing new is there (`mv -n`); otherwise it
stays aside, never lost.

**Long items.** No event is over 450 characters, because the harness cuts long lines. A longer
item arrives as
`[prefix] <head> (long: N chars, full text in <archive>): <preview>…`.

## Checkpoint and retire on idle

After `idleMinutes` (default 50, before the 1 h prompt-cache expiry) with no prompt, tool call or
turn end, the session may be asked once to checkpoint and retire. The ask needs the context to have
grown by `growthPercent` (default 50) of the window. The prompt asks the session to:

- run its close routine (scratchpad `current`, lint, commit, push);
- carry any question still waiting on the human with its exact wording;
- then run the home's `watch_retire_step`.

The mod never retires a session itself. Without `watch_retire_step` it never asks.

The five guards (PO comment on #9, 2026-10-14). Each has its own tests:

1. **Human input first.** It asks only after a typed, Remote Control or Slack-ping prompt in this
   session. A session the resident loop started, which no human has touched, never retires
   itself.
2. **Growth, not size.** Growth is counted from the context at the first human prompt. If the
   human spoke before any reading, it is counted from the first reading (system prompt, tools,
   that turn). A startup that alone reads past 50% never counts.
3. **One ask per session.** The ask is kept in `$.state`, so a reload does not repeat it. If the
   session is still there an hour later, there is one notice to the human and never a second
   ask.
4. **A cross-session brake.** Asks are counted in `$.store` under `retires`. No ask within 2 h of
   the last one, and at most 4 in 24 h. Past either, there is one notice instead.
5. **Off switch.** `retireOnIdle` is off by default. After the brake trips, the mod asks nothing
   for 24 h, or until a reload.

A notice goes through `$.ui.notify`. Where that shows no text (no channel, as in tmux, or a bare
bell), it also goes to the transcript as a dim line.

## Options (`userConfig`)

- `home`: the kit home whose `memory-kit.conf` declares the sources. Empty: the session's start
  directory.
- `pollSeconds` (5, at least 5): the drain and idle-check interval. It reads local files only.
  For a `hub` source keep it at 5: the hub courier waits only about 10 s for an occupied inbox
  (50 rounds of 0.2 s), so a slower poll makes a burst bounce and arrive late and out of order
  (kit #10; the household flood test, 14.10).
- `retireOnIdle` (off), `idleMinutes` (50), `growthPercent` (50): see above.

## Live findings (2026-10-14, Claude Code 2.1.299, throwaway tmux sessions)

- **`$.prompt.submit` from a timer wakes a session idle at the prompt.** This held before any
  turn and after one (44 s idle). It resolved about 60 ms later, as the turn started. Two
  submits in a row ran as two turns, in order. The model reads it as "The watch plugin sent a
  message: …".
- **`$.session.usage()` while idle** gives the last response's input. Before the first response:
  `context.tokens` and `percent` undefined, `window` 1000000. After a turn: the last response's
  input tokens, unchanged until the next turn (23943 throughout 40 s idle). So guard 2 reads a
  stable figure.
- A prompt the plugin submits does not reach its own `prompt.submit` hook ("re-entry" in the
  debug log). In the probe, `turn.start` was not raised for it either; `turn.complete` was.
  Activity is therefore taken from prompts, tool calls and turn ends.
- A typed prompt arrives with `origin.kind === 'composer'`.
- `$.ui.notify` in tmux answered `no-channel`, hence the transcript fallback.
- The store is per install (`~/.claude/plugins/store/watch_inline-<hash>.json` for a
  `--plugin-dir` load). `watch@memory-kit` has its own, so the live checks left one `retires`
  entry in the inline store only.

## Limits

- Draining runs `mv` and `rm` through `$.process.run`, because `$.fs` has no rename or delete.
  So it is POSIX hosts only, and not Windows yet.
- Do not drain one file from two places. Switch off the hub-drain Monitor for an inbox before
  declaring it here: both rename aside, and both rewrite the same archive.
- The kaarel spool needs `kaarel-watch.sh` to append lines to the spool file instead of typing
  into tmux. That change belongs to the household.

## Install

It travels with the kit, beside the pane, in the same `memory-kit` marketplace:

```sh
claude plugin install watch@memory-kit
```

The marketplace entry to add upstream (`adapters/claude-code/.claude-plugin/marketplace.json`):

```json
{
  "name": "watch",
  "source": "./watch",
  "description": "Delivers a home's declared inboxes into the session (idle-safe); optional checkpoint-and-retire on idle."
}
```

For one session only: `claude --plugin-dir ./memory-kit/adapters/claude-code/watch`.

## Develop

```sh
claude plugin validate .
claude plugin test .          # tests/*.test.ts; files, mv/rm, clock and store are mocked
tsc -p .                      # once Claude Code has laid .claude-plugin/types/ (gitignored)
```
