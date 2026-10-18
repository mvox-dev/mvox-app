# watch

A Claude Code mod (function hooks) for a memory-kit home, kit issue #9, reshaped 2026-10-16. It
is a separate plugin from the obligations pane, which stays read-only. A home can take either one
without the other. Built against Claude Code 2.1.296's plugin API and checked live on 2.1.299
(early access; the API moves between releases).

**The watch is information only.** It never reads a file's meaning, never empties, moves or
archives anything, and never says what a signal means: that is the home's own rule. On one timer
(`pollSeconds`, default 5) it watches two kinds of things, both declared in the home's
`memory-kit.conf` (absent means off):

1. **Doorbells** (`watch_files`): when a declared file *grows*, the watch rings once -- one
   `$.prompt.submit`, which queues until the session is idle and starts a turn of its own,
   marked as coming from the plugin.
2. **Session sensors** (`watch_idle_minutes`, `watch_context_percent`): one report when the
   session has sat idle past the mark, one when its context crosses each declared percent of the
   window.

**What it costs: every ring or report is a full turn** (kit #17). The turn carries the session's
whole context, so on a long session one prompt costs hundreds of thousands of input tokens, even
when it says nothing new. Declare only what the session must act on.

## Doorbells

```yaml
watch_files:
  - label: "hub mail"
    path: comms/inboxes/team-lead.json
    instruction: "consume the inbox or new messages won't land"
    inject: false
  - label: ""
    path: ~/spool/links.txt
    instruction: ""
    inject: true
```

Every entry carries the same four fields, empty where unused:

- **label** -- what the ring arrives under, as `[label]`. Empty: the file's name.
- **path** -- absolute (POSIX, `C:\`, `C:/` or UNC), `~/` for the user's home (`HOME`, else
  `USERPROFILE` on Windows), or relative to the kit home. A `*` in a segment matches entries of
  that directory (never a dotfile); each matched file is its own bell.
- **instruction** -- home-authored text the ring carries verbatim. The watch relays the home's
  own words; it still decides nothing. Empty: the ring is just the bell.
- **inject** -- `true`: the ring includes the grown tail's non-blank lines, not just the bell.
  For short, line-shaped files (a spool of URLs, one-line mail summaries): the harness cuts very
  long lines, so a file of essays wants `inject: false` and a session that reads the file itself.

**A ring is growth.** The watch remembers each file's last-seen size; bigger rings once, and
everything else only moves the bookmark: created at 0 bytes is not growth, shrinking and
truncating are not growth, a deleted file counts 0 (so delete-then-write rings). A file that sits
unconsumed is not nagged: no new growth, no new ring. All of one poll's rings go as **one**
prompt. A ring the session's guards refuse rolls its bookmark back and rings again at a later
poll.

**Consuming is the home's own step.** An inbox-style file is consumed by reading it and then
deleting or emptying it -- either resets the bookmark, so the next real write rings again. A
tail-style file (`inject: true`) needs no consuming: the bookmark simply advances, and the file
may grow forever. Say the habit in the entry's `instruction`, where the session will read it.

**A consumer must take everything a ring announced, or retry by itself.** The ring is growth
only: a file the consumer leaves as it was never grows again, so it never rings again, and what
it holds waits until something else writes to the file. esl-suvekool met this on its first live
ring (2026-10-16): its consumer waits 10 s before taking fresh courier mail, the ring came inside
those 10 s, and the message stayed until a hand-run. Its fix is a model: when mail is too fresh,
or the harness holds the lock, wait once and pass again; if something is still left, say so
(a non-zero exit, a printed line) instead of returning quietly. A consumer that takes everything
at once, as the household's does, is not exposed.

A ring reads `[hub mail] /home/u/kit/comms/inboxes/team-lead.json grew. consume the inbox or new
messages won't land` -- with `inject`, the new lines follow, one per line.

**Never silently idle** (kit #14): a `watch_files` the watch cannot read, an entry without a
path, an unknown field, an `inject` that is not true/false -- each is one visible notice (notify,
else a transcript line), never a debug line alone, and the good entries still run. A conf still
declaring `watch_sources` (watch 0.4.x and older) gets one migration notice: declare
`watch_files`, and let the home consume its own files.

## Session sensors

```yaml
watch_idle_minutes: 50
watch_context_percent: 50, 60, 70, 80
```

- **Idle:** when the session has sat that many minutes with no prompt, tool call or turn end, one
  report: `[watch] This session has been idle for 52 min ...`. If the conf declares a
  `watch_retire_step`, the report quotes it as the home's own declared step. The report is armed
  by a human prompt and disarmed by firing, so one working stretch gets one report -- the watch's
  own rings never arm it, and a session no human spoke to is never pinged idle.
- **Context:** percent marks of the window (1-99), against the exact
  `$.session.usage()` reading. Crossing a mark gives one report naming the load and the mark;
  each mark fires once per session; a jump over several names the highest. A compaction that
  shrinks the context does not repeat old marks.

Both are information only: what a report means -- checkpoint, retire, nothing -- is the home's
rule (CLAUDE.md or its kin), not the watch's.

## A remote hub: a spool fed by a peek-only poller (kit #16)

The watch reads local files only, and it never touches a hub. For mail on a remote hub, such as
Lelle's stationmaster reached with `evr-mail recv`, a poller peeks at the hub and appends one line
per new item to a local spool. The home declares that spool as an injecting doorbell:

```yaml
watch_files:
  - label: lelle
    path: inbound/lelle-spool.txt
    instruction: "collect with recv, then ack BY ID what you read"
    inject: true
```

Each ring carries the new lines, `from=… id=… subject=…`. The session then collects and acks the
mail with its own `recv`, after recording it. **Custody stays with the session**: the poller only
looks, and the watch only rings. The spool is never consumed; the bookmark advances.

**Ack only what you read, by id** (kit #39). `evr-mail recv` without `--peek` acks everything
waiting on the hub, not what the peek showed: mail that arrived after the spool line is acked
too. framework-research acked two messages unread that way on 2026-10-15; both needed resends.
The rule: ack by id the messages you have read and recorded, and nothing else; an ack with no ids
acks nothing. Until a home's mail tool acks by id: `recv` prints every message before it acks it,
so read and record everything that run printed, not only the ones the ring named.

`spool/spool-poll.py` (Python 3, stdlib only) is the poller, generic over the command:

```sh
python3 memory-kit/adapters/claude-code/watch/spool/spool-poll.py \
  --spool inbound/lelle-spool.txt \
  --match '^--- \d+/\d+\s+from=(?P<from>\S+)\s+id=(?P<id>\S+)(?:\nsubject: (?P<subject>.*))?' \
  --line 'from={from} id={id} subject={subject}' --healthy '^collected' \
  -- python3 tools/evr-mail.py recv --peek
```

- **Peek only.** The command after `--` must only look (`recv --peek`), never collect or ack.
  The poller cannot check that: it is the home's choice of command.
- **Items.** Each match of `--match` in the command's output (a Python regex, multiline) is one
  item, keyed by its named group `id`. `--line` writes the spool line from the named groups; an
  absent group is empty. Without `--line`, the line is the match itself, on one line. A line
  never holds a line break.
- **Each item once.** Seen ids persist in `.<stem>-seen.json` beside the spool (the last 500,
  `--keep`). So a peeked but uncollected item is not spooled again, across restarts too.
- **Health.** A run fails when the command cannot start, times out (`--timeout`, 90 s), exits
  non-zero, or prints nothing matching `--healthy`. After 3 failures in a row (`--tolerate`), the
  spool gets one `health: <why>` line, then at most one per 30 min (`--health-every`) while the
  failures go on, and `health: recovered` once a run succeeds. Each health line grows the spool,
  so it rings: a full turn.
- **Every 30 s** (`--every`).
- **One poller per spool.** It holds `.<stem>.lock` beside the spool and writes its pid there
  (`flock` on POSIX, `msvcrt` on Windows). A second poller finds the lock held, says so and
  exits 0.
- **JSON instead of a regex** (`--json`, kit #39, hr2): give the peek command its JSON form and
  `--json` in place of `--match`; the first JSON value must be a list of objects with an `id`.
- **A reminder for mail left waiting** (`--remind N`, minutes, off by default; kit #39): an id
  still in the peek N minutes after first seen gets one `waiting: ...` line.
- **Liveness** (kit #39): each successful run stamps `.<stem>.alive`; `--status` prints the
  poller's state (exit 0 running and fresh); `--keep-alive` makes sure one poller runs and
  returns at once -- put it in the home's SessionStart hook (see `spool/spool-poll.py --help`
  and the adapters README). `--once` polls once, for a scheduler.

## A session outside its home: `kit_home` (kit #18)

**User-scope options apply to every session on the machine.** That covers `home` set in the
user's settings, not only the home's own sessions. Use a pointer conf instead: put this in the
folder the session starts in:

```yaml
kit_home: ../desk        # absolute, or relative to this conf's own folder
```

- **What counts:** the home it names. That home's `memory-kit.conf` declares the doorbells and
  sensors, with paths relative to that home. Other keys left in the pointer conf are ignored, and
  `watch_files` left there are a visible notice.
- **Precedence:** the start folder's pointer first. It wins over the user-scope `home` option.
  Then the option, then the start folder itself.
- **One hop, never chained.** If the target's own conf points on, that is refused, and so is a
  loop. `kit_home: .` is just the home.
- **Never silent:** a target with no `memory-kit.conf`, a chained pointer or a `~` path is one
  visible notice, and the watch rings nothing. It never falls back to the start folder. `/watch`
  names the home and the pointer.
- A session whose home came from the user-scope `home` option but which started outside that home
  rings nothing there (one notice); its own session sensors still run.
- The lint and the tools follow the same pointer (`lint/kit_home.py`). This plugin's copy of the
  rules is `hooks/kit-home.ts`, identical in all three plugins; `lint/run-fixtures.sh` fails when
  the copies differ.

## Options (`userConfig`)

- `home`: the kit home whose `memory-kit.conf` declares the doorbells and sensors. Empty: the
  session's start directory. **Set user-wide, it applies to every session on the machine**:
  prefer a `kit_home` pointer conf (above), which also wins over this option.
- `pollSeconds` (5, at least 5): the poll interval. It reads local files only.
- Setting options from a shell: `claude plugin configure watch@memory-kit --values-stdin` takes
  a JSON object of **strings only**, e.g. `{"pollSeconds": "5"}` (found by mvox, 2026-10-14).
- `retireOnIdle`, `idleMinutes`, `growthPercent` are gone (watch 0.5.0): a conf setting
  `retireOnIdle` gets one notice pointing at `watch_idle_minutes` and `watch_context_percent`.

## /watch

Answers with the home (and pointer), each doorbell (label, path, inject, instruction), every
problem in the declaration, and the sensor marks.

## Live findings (2026-10-14, Claude Code 2.1.299, throwaway tmux sessions)

- **`$.prompt.submit` from a timer wakes a session idle at the prompt.** This held before any
  turn and after one (44 s idle). It resolved about 60 ms later, as the turn started. Two
  submits in a row ran as two turns, in order. The model reads it as "The watch plugin sent a
  message: …".
- **`$.session.usage()` while idle** gives the last response's input. Before the first response:
  `context.tokens` and `percent` undefined, `window` 1000000. After a turn: the last response's
  input tokens, unchanged until the next turn. So the sensors read a stable figure.
- A prompt the plugin submits does not reach its own `prompt.submit` hook ("re-entry" in the
  debug log). Activity is therefore taken from prompts, tool calls and turn ends.
- A typed prompt arrives with `origin.kind === 'composer'`.
- `$.ui.notify` in tmux answered `no-channel`, hence the transcript fallback.

## Limits

- A ring is growth in the text `$.fs.read` returns, compared only with itself. A same-size
  overwrite is invisible; that is the definition, not an accident.
- The watch does not watch directories, only files (a `*` path is expanded per poll, so a new
  matching file is picked up then).
- Two sessions in one home each keep their own bookmarks: both ring. Information is per session;
  consuming is not, so the home's rules say who consumes.

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
  "description": "Rings a doorbell when a home's declared files grow, and reports the session's idleness and context marks. Information only."
}
```

For one session only: `claude --plugin-dir ./memory-kit/adapters/claude-code/watch`.

**Scope.** This installs at user scope: every session on the machine loads the plugin. What it
does in a folder that is not a kit home, and the project-scope alternative:
[Install scope](../README.md#install-scope-kit-35).

## Develop

```sh
claude plugin validate .
claude plugin test .          # tests/*.test.ts; files, clock, store and the session are mocked
tsc -p .                      # once Claude Code has laid .claude-plugin/types/ (gitignored)
```
