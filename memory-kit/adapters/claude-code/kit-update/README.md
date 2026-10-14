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
(`/raw/UPGRADE.md?ref=v<version>`). It checks every per-version step
(`- **A -> B:** ...`) between the home's version and the target.

- **Auto:** each step says "no data step", the target has a step, and the major is the same.
  The prompt says to run `python3 memory-kit/tools/kit-update.py <home>`, the home path
  quoted as one shell word.
- **Manual:** otherwise. The prompt says "manual upgrade needed (<reason>)" and points at
  `UPGRADE.md`, not the script. The script refuses such a release anyway; this only words the
  prompt.

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

## Options (`userConfig`)

- `home`: the kit home, whose `memory-kit.conf` and `memory-kit/VERSION` count. Empty: the
  session's start directory. Use it for a session that runs outside its home.
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

## Develop

```sh
claude plugin validate .
claude plugin test .          # tests/*.test.ts; upstream, files, store, clock and the session are mocked
tsc -p .                      # once Claude Code has laid .claude-plugin/types/ (gitignored)
```
