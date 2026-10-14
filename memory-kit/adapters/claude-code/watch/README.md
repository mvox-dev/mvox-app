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
  - "hub mail | hub unread courier | ~/.claude/teams/session-*/inboxes/team-lead.json | ~/comms/archive/{name}-archive.json"
watch_retire_step: "touch .fresh-next, then exit"
```

Each item is `prefix | format [modifiers] | path [| archive]`:

- **prefix**: what every item from the source arrives under, as `[prefix]`. Peer content stays
  information and is never taken for the human's words.
- **format**:
  - `hub` is a JSON list of `{ from, text | summary, timestamp }`, as the hub courier writes.
    An item reads `[hub mail] from <from> [<timestamp>]: <text>`.
  - `lines` is one item per non-blank line, e.g. a spool a watcher script appends to. An item
    reads `[kaarel] <line>`.
- **modifiers**, for `hub` only (since 0.2.1, kit #12): `unread` skips entries marked
  `read: true`, and `courier` takes only entries whose `from` ends in `-courier`. A source with
  either is a shared inbox (see below). For the harness's teammate inbox, use both:
  `hub unread courier`.
- **path**: absolute (POSIX, `C:\`, `C:/` or UNC), `~/` for the user's home (`HOME`, else
  `USERPROFILE` on Windows), or relative to the kit home. A `*` in a segment
  matches entries of that directory (never a dotfile). This covers a team inbox under the
  rotating `~/.claude/teams/session-<id>/`. Check that the glob matches only the inbox you mean.
  `session-*` matches every team on the box, the dead ones included.
- **archive**: where drained content is kept. `{name}` is the drained file's stem. The default
  is `archive/` beside the file: `<stem>-archive.json` for hub, the same file name for lines. Both
  defaults match the household's `comms/inboxes/archive/team-lead-archive.json`.

**Either YAML list form** (since 0.2.3, kit #14):

- the block form above, with items indented or at column 0;
- the flow form, on one line or several:
  `watch_sources: ["hub mail | hub unread courier | ~/.claude/teams/session-*/inboxes/team-lead.json"]`.

In the flow form, items may be `"double"` quoted (with `\"` and `\\`), `'single'` quoted (with
`''`) or plain. A comma or bracket inside a quoted item is part of it. A plain item ends at a
comma.

**Never silently idle.** Each case below is one visible notice per session (notify, else a
transcript line), never a debug line alone:

- `watch_sources:` is there but cannot be read: no items under it, a value that is not a list,
  an unterminated `[ ...`, nested lists or maps, or items without commas between them.
- One item does not parse, or names `~` with no HOME. That item is skipped, and the rest still
  run.

`watch_sources: []` is a home watching nothing on purpose, so it gets no notice.

**`/watch`** shows what is active now:

- each source with its format and expanded path;
- what was skipped, and why;
- the retire switch and the poll interval.

It re-reads `memory-kit.conf` every time, so it is the check to run after a reload.

## Draining

This is the same design as `scripts/hub-drain.sh` and esl-suvekool's `scripts/drain-inbox.py`.
The mod reads both but changes neither.

1. **Read first.** An empty file, or `[]`, is left alone. A file that is not a hub list is left
   in place with one debug line.
2. **Rename aside** to `.watch-drain-<file>-<time>-<n>` beside it, so a writer racing the
   drain never loses an item. Renames and deletes run on the host (see Platforms).
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
unreadable goes back to the file's name only if nothing new is there (no-clobber); otherwise it
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
- Setting options from a shell: `claude plugin configure watch@memory-kit --values-stdin` takes
  a JSON object of **strings only**, e.g. `{"pollSeconds": "5", "retireOnIdle": "false"}`;
  bare numbers and booleans are refused (found by mvox, 2026-10-14).
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

## A shared inbox: the harness's teammate inbox (since 0.2.1, kit #12)

In a team session the courier writes hub mail into `~/.claude/teams/session-<id>/inboxes/team-lead.json`,
which is also the harness's own teammate inbox. A plain `hub` source would rename the whole file
aside, taking teammate messages away from the harness. A source with modifiers works differently:

- **Only its own entries leave.** The watch takes the entries the source takes (e.g. unread
  courier mail). Everything else stays in place, unchanged and in order: read entries, and
  teammate messages read or not. A file holding nothing to take is not touched at all.
- **The harness goes first.** A takeable entry must sit in the file for 30 s before the watch
  takes it. While the harness's team is live, the harness delivers inbox entries itself and
  removes them within about a second, so the watch never sees them twice. The watch takes only
  what the harness is not picking up.
  The cost: while a courier entry waits out its 30 s, the inbox is not empty, so the courier
  holds any further hub mail (it writes only into an empty inbox) and redelivers it later. A
  burst into a team inbox therefore arrives about one message per 30-40 s, in custody and in
  full, but slowly. A household-style inbox that only the courier writes needs no modifiers and
  has no such delay.
- **Under the harness's own lock.** The harness serialises its inbox with a `<inbox>.lock`
  directory, made with mkdir (seen live, below). The watch takes the same lock with `mkdir`, or
  `New-Item -ItemType Directory` on Windows; both fail when the lock exists. If the lock is
  held, the watch tries again at the next poll. A lock older than 60 s is taken as stale and
  broken, with one debug line. Under the lock the watch:
  1. re-reads the file;
  2. writes the taken entries to an aside (temp file + rename);
  3. writes the rest back in place (temp file + rename, as the harness itself writes);
  4. unlocks.

  The aside then goes through the usual archive, pending and delivery steps. If writing the
  rest back fails, the aside is removed and the inbox still holds everything.
- **The courier.** `stationmaster-courier.py` writes only into an absent or empty inbox (empty,
  rename-aside, then exclusive-create). The watch writes only when it takes something, so the file
  is not empty when the watch acts, and the courier is then waiting.
- **Never put back.** An unreadable aside of a shared source stays aside, with one debug line. It
  is never moved into the harness's inbox.
- **What can still go twice:** a crash after the aside is written but before the rest is written
  back. The taken entries then sit in both, and arrive twice. None is lost.

**Live check** (2026-10-14, Claude Code 2.1.299, throwaway team sessions, haiku, plan mode):

- **No teammate.** The harness did not read its inbox at all, idle or at a turn's end. A courier
  entry written there sat untouched: the esl "8 h unread" case. With the watch on
  `hub unread courier`:
  - the courier entry was delivered 35 s later as `[hub mail]`;
  - a `read: true` teammate entry stayed in place, byte for byte;
  - the watch took and released `team-lead.json.lock`.
- **A live teammate.** The harness polled about once a second. It took its lock (a directory,
  `team-lead.json.lock`), delivered the entry as "Message from @hub-courier" and replaced the
  file with `[]` (temp file + rename: new inode). It removed every entry, `read: true` ones
  included. The watch saw the entry for a second and did not deliver it.
- **Unverified:**
  - mvox's report that its harness marks entries `read: true` and leaves them. The harness here
    removed them. Either way the watch leaves read entries alone.
  - Whether every harness version takes the lock.
  - Whether teammates' own writes into the inbox take it. A teammate's write here showed up as a
    temp-file rename.

## Platforms (since 0.2.0, kit alpha.9)

`$.fs` has no rename or delete, so the drain runs its file operations on the host through
`$.process.run`:

| operation | used for | POSIX | Windows (PowerShell) |
|---|---|---|---|
| move | the inbox, renamed aside | `mv -- a b` | `Move-Item -LiteralPath 'a' -Destination 'b'` |
| move, never over a file | an unreadable aside put back | `mv -n -- a b` | `Move-Item` as above: it fails when the target exists |
| move over | archive and pending file, through a temporary | `mv -f -- a b` | `Move-Item ... -Force` |
| remove | the aside, an emptied pending file | `rm -f -- a` | `if (Test-Path -LiteralPath 'a') { Remove-Item -LiteralPath 'a' -Force }` |
| lock | a shared inbox's `<inbox>.lock` | `mkdir -- a` | `New-Item -ItemType Directory -Path 'a'`: it fails when the lock exists. New-Item has no `-LiteralPath`, so `[ ]` in the path is unverified |
| unlock | the same | `rm -d -f -- a` | `if (Test-Path -LiteralPath 'a') { Remove-Item -LiteralPath 'a' -Force }` |

- **Detection:** the platform is found once per module load and cached. A drive-letter or UNC
  home is Windows. Otherwise `uname -s` decides: an answer means POSIX, no answer means Windows.
  The probe is `uname` rather than `mv --version` because macOS's BSD `mv` has no `--version`.
- **Windows calls:**
  - The tool is `powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64 of UTF-16LE>`.
    That is Windows PowerShell 5.1, which every Windows 10 and 11 has.
  - The encoded script never meets command-line quoting, so spaces and quotes in paths are safe.
  - Inside the script each path is a single-quoted literal. Every character PowerShell reads as a
    single quote (`'` and the typographic `‘ ’ ‚ ‛`) is doubled, so `$` and backticks stay
    literal.
  - `-LiteralPath` keeps `[ ]` from being read as wildcards.
  - `$ErrorActionPreference = 'Stop'` makes a failed move exit non-zero.
  - **Already gone counts as removed** (since 0.2.2, kit #11). Under `Stop`, `Remove-Item` on a
    missing path exits 1 even with `-ErrorAction SilentlyContinue` (Pepys's desk). So remove and
    unlock are guarded by `Test-Path`: exit 0 when the path is gone, exit 1 on a real failure.
    The same trap was on POSIX for the unlock: `rmdir` fails on a missing directory, so it is now
    `rm -d -f`.
    - A file can already be gone because another session finished the same pending file.
    - A lock can already be gone because the harness broke it as stale.
    - The lock itself stays a plain `New-Item` / `mkdir`: failing when the lock exists is its
      job.
  - **Success is the exit code alone.** stderr goes only into the debug line of a failed call.
    Windows PowerShell writes CLIXML progress records (`#< CLIXML …`) to stderr even on a call
    that succeeded (Pepys's desk), and a test holds that.
- **Checked on Windows 11** (Pepys's desk, part 1 of the check, kit #11):
  - brackets in paths: pass;
  - a failed move exits 1: pass;
  - odd file names: pass;
  - a missing path under `Stop` fails the remove, which 0.2.2 fixes.
- **Speed.** One call costs 200 to 280 ms warm and 0.5 to 1.5 s cold. A drain of n items makes
  4 + n calls, so a single hub message costs about 1 to 1.5 s warm, spread over one poll.
  - A shared inbox adds 2 calls (lock and unlock) and a temp-file rename.
  - The poll is single-flight, so a slow call delays the next poll and never overlaps it.
- **Still unverified on Windows** (part 1, as reported to the watch):
  - whether `New-Item -ItemType Directory -Path` takes `[ ]` literally for the lock;
  - whether `$.fs` reads and lists `C:\...` paths and the `.watch-*` files there as it does on
    Linux;
  - a whole drain through the mod in a live session.

  The tests run on Linux, against a fake host that decodes the script and models PowerShell's
  `Stop` behaviour (a missing path fails, stderr may carry CLIXML).

## Limits

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
claude plugin test .          # tests/*.test.ts; files, the host (POSIX or Windows), clock and store are mocked
tsc -p .                      # once Claude Code has laid .claude-plugin/types/ (gitignored)
```
