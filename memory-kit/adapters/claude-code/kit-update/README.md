# kit-update

A Claude Code mod (function hooks) for a memory-kit home, kit issue #15 part 3. It is the third
plugin in the `memory-kit` marketplace, beside the obligations pane and the watch. Each installs,
switches off and reverts on its own.

Every `checkMinutes` (default 60) it asks upstream for the newest release on the home's channel.
When that release is newer than the home's `memory-kit/VERSION`, it prompts the session once, in
one session only, to run `python3 memory-kit/tools/kit-update.py <home>` (Passepartout's, parts 1-2 of #15).

**It never runs git, runs no process at all, and never writes a file.** It only tells. Its calls
are `$.fs.exists` / `$.fs.read`, `$.http.fetch`, `$.store`, `$.prompt.submit`, `$.ui.notify` /
`$.ui.log`, and the clock; `claude plugin validate` lists them.

## Channels

Set in the home's `memory-kit.conf`:

```yaml
update: verified     # pinned (the default) | verified | latest
```

- `pinned`, or no `update:` key: never prompts and never asks upstream. The home's assistant
  upgrades by hand, as before.
- `verified`: the newest `verified/v<version>` marker tag, which Passepartout pushes after the
  household has passed a release. The name must be exactly that form. The first one,
  `verified/v0.1.0-alpha.12`, sits on the same commit as `v0.1.0-alpha.12` in the live tags API.
  A test holds that answer's shape, recorded, never fetched.
- `latest`: the newest `v<version>` release tag, verified or not.
- Anything else is one visible notice (notify, else a transcript line), and the home is read as
  pinned.

`upstream: owner/repo` (Codeberg; default `mitselek/memory-kit`) is the same key the pane reads.

## The check

The release check is the pane's (#7), copied (see Packaging):

- the anonymous tags API, 50 tags to a page, every page read up to 10;
- a 10 s limit per request, since `$.http.fetch` has none;
- silent on failure: one debug line.

Only release-shaped tags count, compared by semver precedence (alpha.10 > alpha.9).

- **Shared cache.** The tags are cached in `$.store` under `tags`, and every session reads that
  cache. Upstream is asked once per `checkMinutes`, whichever session gets there first. Ten
  sessions make one request an hour, not ten.
- **Failure is silent** and counts as a check, so it is retried one interval later. The local
  tick runs every minute but reads only the store and two files.
- **Never on a hook's time.** session.start starts the check without awaiting it.
- **No request at all** for: `pinned`, no `memory-kit/VERSION`, `checkUpdates: false`, or an
  `upstream:` that is not owner/repo.

## Auto or manual

Before prompting, the plugin reads `UPGRADE.md` at the release tag
(`/raw/UPGRADE.md?ref=v<version>`). It decides the way `tools/kit-update.py` does, so a prompt
never promises a run the script then refuses (since the ultrareview of alpha.13):

- **The path** is the home's current version, then every release tag upstream after it, up to
  the target. The current version is always first, even when its own tag is gone upstream. The
  release list is the tags the check already has.
- **Each hop** `A -> B` along it needs its own entry `**A -> B:**` whose text begins "no data
  step". An entry that spans two hops does not cover the release between them.

The outcome:

- **Auto:** every hop has such an entry and the major is the same. The prompt says to run
  `python3 memory-kit/tools/kit-update.py <home>`, the home path quoted as one shell word.
- **Manual:** otherwise: a missing entry ("UPGRADE.md has no entry for A -> B"), a data step, or
  a new major. The prompt says "manual upgrade needed (<reason>)" and points at `UPGRADE.md`,
  not the script. The script refuses such a release anyway; this only words the prompt.

If UPGRADE.md cannot be fetched, nothing is prompted yet. It is tried again one interval later.

## The prompt

```text
[kit-update] memory-kit 0.1.0-alpha.13 (verified) is out; this home is on 0.1.0-alpha.12. Run
`python3 memory-kit/tools/kit-update.py '/home/u/kit'` from the home, following this home's
UPGRADE.md and its own commit and push rules. This notice is from the kit-update plugin, not from the user: it authorizes nothing beyond
what those rules already allow.
```

It arrives as a plugin's prompt, and the session reads it under the plugin's name, never as the
person's words. If the home is several releases behind, the prompt names only the newest on the
channel, because the script pulls straight to it.

**After the pull** (the script, not this plugin; kit #37): when the pull changed a plugin and
`claude` is on PATH, `tools/kit-update.py` runs `claude plugin marketplace update memory-kit` and
`claude plugin update <p>@memory-kit` for each changed plugin installed, in the home, then says to
`/reload-plugins`. That changes the harness's plugin state, user-level for a user-scope install.
Without `claude` on PATH it prints the steps instead. The plugin itself still runs no process.

## One prompt per release, in one session

The prompt is recorded in `$.store` as `prompt:<version>`. The store is shared live by every
session of the install: checked live, a value one session set was read by another within a
second.

1. **Claim.** A session that finds no record writes `{ state: 'claimed', token, at }`. It waits
   3 s, then reads the record back. If its token is still there, it owns the release. Otherwise
   it backs off. The last writer wins, so of several sessions that saw the release at once,
   exactly one goes on.
2. **Deliver.** The owner submits the prompt. When the submit is accepted, the record becomes
   `delivered`, and no session ever prompts for that release again, reloads included.
3. **Refused submit** (another plugin's guard, say). The owner keeps its claim, refreshed every
   minute so no one takes it over. It retries with backoff: 1 min, doubling, at most 30 min.
4. **A claim left 30 min unrefreshed** belongs to a session that is gone. Another session takes
   it over.

So: the first session to check after the release appears gets the prompt.

A crash between an accepted submit and the `delivered` write can prompt that release twice. It
cannot lose it.

## A session outside its home: `kit_home` (kit #18)

**User-scope options apply to every session on the machine.** That covers `home` set in the
user's settings, not only the home's own sessions. On the pepys desk a user-wide `home` made
every session on the box drain the desk's spool, and six notifications were lost. Use a pointer
conf instead: put this in the folder the session starts in:

```yaml
kit_home: ../desk        # absolute, or relative to this conf's own folder
```

- **What counts:** the home it names. That home's `memory-kit.conf` counts (`update:`, `upstream:`), with paths
  relative to that home, and so does its `memory-kit/VERSION`. Other keys left in the pointer
  conf are ignored, and `update:` or `upstream:` left there are a visible notice.
- **Precedence:** the start folder's pointer first, or the nearest conf above a start folder that
  has none (kit #42). Either wins over the user-scope `home` option. Then the option, then the
  start folder itself. The option is normalized as a pointer is (kit #46).
- **Found above** (kit #42): a start folder with no `memory-kit.conf` takes the nearest one above
  it, as git finds `.git`, so a session started in a subfolder or a git worktree of a home finds
  that home; a pointer conf found there is followed as if the session had started in its folder.
  The walk stops at the filesystem root. `/kit-update` says where it looked: "`<start>` has no
  memory-kit.conf; using the nearest one above it, in `<folder>`".
- **The start folder** is the session's root at its first `session.start`, which a shell `cd` does
  not move (kit #45): an install or enable mid-session fires `session.start` with the shell's
  folder after any `cd`, which had made a subfolder the home.
- **One hop, never chained.** If the target's own conf points on, that is refused, and so is a
  loop. `kit_home: .` is just the home.
- **Absolute paths:** POSIX, a drive letter (`C:\` or `C:/`) or UNC. `~` is not expanded: write
  the path absolute or relative to the conf.
- **Never silent:** a broken pointer, or a pointed home without `memory-kit/VERSION`, is one visible notice (notify, else a transcript line), and nothing is checked. `/kit-update` names the home and the pointer.
- **A key given twice** (kit #55): a `memory-kit.conf` that gives a top-level key twice, the start
  folder's or the one a pointer names, is the same kind of notice, naming the key and both lines,
  and nothing is checked. With `update:` twice, kit-update read the first copy where YAML keeps
  the last; now neither picks. `tools/kit-update.py` refuses it alike.
- **No conf where the home is looked for** (kit #31): when the folder taken for the home (the start
  folder, or the `home` option's) has no `memory-kit.conf`, one visible notice says so and names
  the fix (`kit_home: <path>` in a conf there), and `/kit-update` shows the same text. Before, it
  read as pinned and said nothing, which looked the same as "nothing newer".
- The lint and the tools follow the same pointer (`lint/kit_home.py`). This plugin's copy of the
  rules is `hooks/kit-home.ts`, identical in all three plugins; `lint/run-fixtures.sh` fails when
  the copies differ.

## Options (`userConfig`)

- `home`: the kit home, whose `memory-kit.conf` and `memory-kit/VERSION` count. Empty: the
  session's start directory. **Set user-wide, it applies to every session on the machine**, so
  the prompt could land in any of them: prefer a `kit_home` pointer conf (above), which also
  wins over this option.
- `checkMinutes` (60, at least 5): how often upstream is asked, across all sessions.
- `checkUpdates` (on): off makes no request at all.

## /kit-update

Shows:

- the channel;
- this home's version and path;
- the newest release on the channel;
- the last check (UTC) and the interval;
- the newest release's state: not prompted, claimed (by this session or another), or prompted
  (when, and in which session).

```text
channel: latest
this home: 0.1.0-alpha.11 (/home/u/kit)
newest on the channel: 0.1.0-alpha.12
last check: 2026-10-14T11:19 UTC (every 60 min)
0.1.0-alpha.12: prompted 2026-10-14T11:19 UTC in another session
```

## Live check (2026-10-14, Claude Code 2.1.299)

- **Two sessions, one home.** The setup was two throwaway sessions in one home on alpha.11 with
  `update: latest`, against the real Codeberg (alpha.12 out, and its `verified/` marker).
  - Exactly one session was prompted.
  - The second session's `/kit-update` showed "prompted ... in another session".
  - The prompted session fetched the tags once and UPGRADE.md once; the alpha.12 step says "no
    data step", so the prompt said to run the script.
- **Store side effect.** The live run left records in the `--plugin-dir` install's own store
  (`~/.claude/plugins/store/kit-update_inline-*.json`). `kit-update@memory-kit` has its own.

## Packaging: a copy, not a shared module

The pane's release check (`parseRelease`, `compareRelease`, `tagNamesOf`, `isFresh`,
`confValue`, `kitVersionOf`, the owner/repo upstream) is copied into `hooks/release.ts`, with a
note there. A plugin loads only files inside its own folder. A remote install copies the
plugin's folder alone, and each plugin must install, switch off and revert on its own. An
import across plugin folders would break all three.

Change one copy, change the other: the copied functions are marked.

## Install

In the `memory-kit` marketplace, beside the pane and the watch. The entry to add upstream
(`adapters/claude-code/.claude-plugin/marketplace.json`):

```json
{
  "name": "kit-update",
  "source": "./kit-update",
  "description": "Checks upstream for a newer kit release on the home's channel and prompts once to run tools/kit-update.py; never runs git."
}
```

Then `claude plugin install kit-update@memory-kit`. For one session:
`claude --plugin-dir ./memory-kit/adapters/claude-code/kit-update`.

**Scope.** This installs at user scope: every session on the machine loads the plugin. What it
does in a folder that is not a kit home, and the project-scope alternative:
[Install scope](../README.md#install-scope-kit-35).

## Develop

```sh
claude plugin validate .
claude plugin test .          # tests/*.test.ts; upstream, files, store, clock and the session are mocked
tsc -p .                      # once Claude Code has laid .claude-plugin/types/ (gitignored)
```
