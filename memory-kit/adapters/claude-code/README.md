# memory-kit plugins for Claude Code

This folder is the `memory-kit` marketplace. It holds three plugins, each with its own README:

- [`obligations-pane`](obligations-pane/README.md): a read-only side pane over the obligations tier.
- [`watch`](watch/README.md): rings a doorbell when a file the home declares grows, and reports
  idleness and context growth, information only.
- [`kit-update`](kit-update/README.md): prompts the session when a kit release is out on the home's
  channel.

## Idle compaction: turn it off in a home that retires instead (Claude Code 2.1.290+)

Claude Code compacts a conversation over 200k tokens while the session is idle, before its
one-hour prompt cache expires: at about 54 idle minutes (90% of the hour), whatever the window.
A compaction replaces the conversation with a summary, and the session afterwards works from that
summary: what it had read and checked becomes something it infers. A home whose rule is to
checkpoint into its memory files and retire by its context gauge, never to compact, loses exactly
that. The household saw it twice (18.10 and 19.10.2026, at 256k and 239k tokens, the gauge at
23% of a 1M window): both came after 55 minutes idle, not from a full window.

Turn it off in the user's settings, `~/.claude/settings.json`:

```json
{
  "idleCompaction": false
}
```

- The key and its meaning are Claude Code's own (2.1.303's settings schema: "Set to false to stop
  Claude Code from compacting a long conversation while the session is idle"). `true` does not
  turn it on; leave the key out for the default.
- **User scope applies to every session on the machine**, every home included. `[unverified]`:
  whether a project's `.claude/settings.json` is read for this key (plugin options, for one, are
  read from user settings only).
- `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` moves the 200k minimum instead of turning it off.
- Compaction at a full window stays on (`autoCompactEnabled`); a home retiring at its gauge's
  mark (the household: 80%) stays below it.
- With idle compaction off, the first turn after an hour idle reads the whole context uncached.
  The watch's repeating idle report (`watch_idle_repeat: true`, kit #47) keeps the cache warm
  instead; see the watch README.
- How to tell: the transcript's `compact_boundary` line carries `compactMetadata.trigger` and
  `preTokens`; an idle compaction follows a gap of about 54 minutes after the last turn.

## Install scope (kit #35)

`claude plugin install <plugin>@memory-kit` installs at **user scope** unless told otherwise. A
user-scope plugin loads in every Claude Code session on the machine, in a kit home or not.
mac-sysops installed all three that way.

### Outside a kit home

A folder that is not a kit home: no `memory-kit.conf` in the folder the session starts in. What
each plugin does there, as each plugin's tests hold it (`claude plugin test .`, alpha.16):

- **kit-update: one notice per session.** "`<folder>` has no memory-kit.conf, so it is not a kit
  home; if the home is elsewhere, put kit_home: `<path>` in a memory-kit.conf here. kit-update
  checks nothing until it has one." (#31). `/kit-update` says the same. This is the visible cost
  of a user-scope install: every session elsewhere shows it once.
- **obligations-pane: silent.** The pane does not open, nothing is asked upstream, and nothing
  is logged. It still registers `/obligations` and refreshes every 20 s and at each turn end,
  which reads the start folder's `memory-kit.conf` and `memory/obligations.yaml` and finds
  neither. `/obligations` opens the pane, which says "no obligations file here (`<path>`)".
- **watch: silent.** Nothing is rung or reported, nothing is written, no notice or transcript
  line, no process. It still registers `/watch` and reads the start folder's `memory-kit.conf`
  every poll (5 s). `/watch` says "no watch_files in `<path>`; no doorbells." and that both
  session sensors are off.

**User-scope options end the silence.** They reach every session, so set them in a home's own
sessions only, or not at all:

- the pane's `memoryDir`: every session reads that home's ledger and opens the pane;
- the watch's `home`: every session outside that home gets one notice and rings nothing there;
- kit-update's `home`: every session checks that home's channel.

A `kit_home` pointer conf in the start folder does the same job for one folder and wins over all
three options (each README's "A session outside its home").

### The alternative: project scope

Install from inside the folder the home's sessions start in:

```sh
claude plugin marketplace add ./memory-kit/adapters/claude-code --scope project
claude plugin install obligations-pane@memory-kit --scope project
claude plugin install watch@memory-kit --scope project
claude plugin install kit-update@memory-kit --scope project
```

The plugins then load only in sessions of that project. The setting lands in its
`.claude/settings.json`, which is committed with the repo and travels with it. Two cautions:

- **The start folder, not the home.** A home whose sessions start in another folder, with a
  `kit_home` pointer conf there (the workshop starts in `~/Documents/3D`, its home is
  `~/Documents/3D/workshop`), needs the project-scope install in that start folder.
  `[unverified]`: which folder Claude Code takes for the project when a session starts in a
  subfolder of the repo.
- **Not re-checked here.** The kit's tests run the plugins in a mocked engine; they do not run an
  install. The commands above are as `claude plugin install --help` and `claude plugin
  marketplace add --help` state them (Claude Code 2.1.300).

### A trap: a scoped marketplace add can rewrite the user-level entry

In the `kit_home` live test (2026-10-14), `claude plugin marketplace add --scope local` also
rewrote the user-level `memory-kit` marketplace entry. `[speculative]`: a marketplace is known by
its name, so a scoped add of `memory-kit` from another path can move the source that every user-scope install
of the same name reads. After a scoped add, check `claude plugin marketplace list` names the
source you expect. Reported from that live test, not re-run here; not yet filed with the harness.
