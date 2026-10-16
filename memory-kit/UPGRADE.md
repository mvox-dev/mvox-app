# UPGRADE

**This file is a prompt.** An assistant reads it and executes it after pulling a new version of
the kit into an already-adopted home. Adoption happens once; this happens on every pull.

The contract: **a minor upgrade is a pull and nothing else.** If you find yourself about to
change the home's own data because a minor version arrived, stop -- either the kit broke its
own rule, or you are reading a major.

## Phase 0 -- know which two versions you are between

Read the pinned version in `memory-kit/VERSION` before the pull, and the new one after. Read
`CHANGELOG.md` for every entry between them.

If the major number changed, go to **Major** below. Otherwise continue.

## Minor or patch: pull, verify, report

1. Pull the subtree. Nothing in the home's own memory directory may change as a result; if
   the pull touched it, that is a kit bug -- stop and report it.
2. Run `lint/memory-lint.sh --report` over the home. Compare with the last run.
3. New findings are expected when a check was added. Handle them by the same rule adoption
   used: **gate what already passes, gauge the rest.** A check that a home fails today is
   debt, not a failure -- write it into the home's debt list with a line on what would fix it.
4. A tightened cap never rewrites existing rows. It applies to what the home writes next.
5. Write the new version into `memory-kit/VERSION`.
6. One commit: what moved, what the lint now says, what debt was added. State the way back
   (the previous pinned version).

> **GATE -- only if the upgrade wants something from the human.** A new tier the home must
> decide whether to use; a rule the kit now ships that would change how the assistant behaves;
> a deletion. Ask, with the CHANGELOG entry quoted. Never adopt a behaviour change silently
> because a version number moved.

## Major: a migration ran, so treat it like a small adoption

A major means data shape changed. The kit ships `migrations/<version>/` for exactly this.

1. Work on a branch. Keep the old tree until the end.
2. Read the migration's own notes first -- they say what changes and what cannot be automated.
3. Run the migration in dry-run. It must print: converted, needs-judgment, could-not. If the
   numbers do not add up, stop.
4. Work the needs-judgment list with the human, as in adoption Phase 3.
5. Gate what passes, gauge the rest.
6. Keep what the migration replaced as a fallback until the events that exercise it have run (a
   cold start, each scheduled memory routine) -- not a calendar week; then delete.
7. Report what the migration got wrong or could not do -- upstream, on the kit's tracker.

## Per version

- **0.1.0-alpha.1 -> 0.1.0-alpha.2:** lessons now carry their index fields in front matter. After
  the pull, run once: `python3 memory-kit/tools/lesson-index.py memory --from-index` (writes front
  matter from your existing index), then `--check`, then the lint. A home that already keeps its
  own front matter: compare its keys with `LessonFrontMatter` first.

- **0.1.0-alpha.2 -> 0.1.0-alpha.3:** no data step -- the pull changes nothing in a home's
  memory; run the lint to confirm. New, optional: the Claude Code obligations pane. From the home
  root: `claude plugin marketplace add ./memory-kit/adapters/claude-code`, then
  `claude plugin install obligations-pane@memory-kit`. The install notes "N userConfig options
  not yet set" (2 at alpha.3; 3 from alpha.4 with `memoryDir`; 4 from alpha.6 with `checkUpdates`): harmless, the defaults
  apply (agent name = the folder's name; no memoryDir; auto-open where an obligations file exists). A session whose working folder is not the home root: put a
  `memory-kit.conf` there with an absolute `memory_dir` (po-team's setup). Superseded in
  alpha.4: use the pane's `memoryDir` option instead.

- **0.1.0-alpha.3 -> 0.1.0-alpha.4:** no data step. After the pull, run the lint once **with the
  home as its argument** -- it now honours `memory_dir` and fails (exit 2, even under `--report`)
  when the memory directory is missing, so a hook or script that passed a wrong path will now
  fail where it used to pass. Fix the path, not the lint. A home that put a `memory-kit.conf`
  outside itself to steer the pane (alpha.3's advice): delete that file and set the pane's
  `memoryDir` option to the home's memory directory (stored in settings under
  `pluginConfigs`), then `/reload-plugins`.

- **0.1.0-alpha.4 -> 0.1.0-alpha.5:** no data step. Pull, run the lint, then `/reload-plugins` for
  pane 0.2.1: it now stays on the home the session started in, even after a shell `cd`. If your
  home's adoption PR was squash-merged, `git subtree pull` will refuse; see "Always" below. A home
  more than one version behind: read every step from its version on, then pull once.

- **0.1.0-alpha.5 -> 0.1.0-alpha.6:** no data step. Pull, run the lint, then `/reload-plugins`.
  Expect a new note in the lint output: "files read / files ignored", naming files in your memory
  directory that are not a kit tier. It never fails the gate; it shows what the lint does not
  check. New, optional: `memory-kit/tools/obligations-due.py <home>` replaces a home-written
  deadline script. The pane (0.3.0) now makes one anonymous request to Codeberg at most every
  6 hours to look for a newer release; set `checkUpdates` off to stop it. A Windows home: check
  that an absolute `memoryDir` works (#8 is tested only on Linux).

- **0.1.0-alpha.6 -> 0.1.0-alpha.7:** no data step. Pull, run the lint, `/reload-plugins`. New,
  optional: the watch plugin (`claude plugin install watch@memory-kit`; see its README). Before
  pointing it at an inbox, stop whatever drains that inbox today (a hub-drain Monitor, a script):
  two drains would both rename the file aside and rewrite the same archive. Keep `retireOnIdle`
  off until the notifications have run a while in your home.

- **0.1.0-alpha.7 -> 0.1.0-alpha.8:** no data step. Pull, run the lint, `/reload-plugins`. A home
  that installed the watch at alpha.7 and set no `pollSeconds` now polls every 5 s; one that set
  15 should set 5 (`claude plugin configure watch@memory-kit --values-stdin`).

- **0.1.0-alpha.8 -> 0.1.0-alpha.9:** no data step. Pull, lint, `/reload-plugins`. POSIX homes see
  no change in behaviour. A Windows home can now use the watch; check the README's Platforms list.

- **0.1.0-alpha.9 -> 0.1.0-alpha.10:** no data step. Pull, lint, `/reload-plugins`. A team home whose
  watch source is `~/.claude/teams/session-*/inboxes/...`: change its format to `hub unread courier`
  (see the watch README) so teammate messages stay with the harness.

- **0.1.0-alpha.10 -> 0.1.0-alpha.11:** no data step. Pull, lint, `/reload-plugins`. A Windows home can
  drop the `-X utf8` / `PYTHONUTF8=1` workaround for the lint and tools.

- **0.1.0-alpha.11 -> 0.1.0-alpha.12:** no data step. Pull, lint, `/reload-plugins`, then run `/watch`
  once to see that your sources are active.

- **0.1.0-alpha.12 -> 0.1.0-alpha.13:** no data step. Pull, lint, `/reload-plugins`. New, optional: choose
  a channel in `memory-kit.conf` (`update: pinned|verified|latest`; pinned is the default), and
  `claude plugin install kit-update@memory-kit` to be prompted when a release on it appears.

- **0.1.0-alpha.13 -> 0.1.0-alpha.14:** no data step. Pull, lint, `/reload-plugins`, then `/watch` once:
  it now names which session drains each home (one drain per home). Behaviour changes to know:
  the watch delivers one prompt per poll (a burst arrives as one `[watch] N items` prompt), and
  the user-scope `home` option no longer makes a session outside that home drain it -- a start
  folder that is not the home needs a one-line pointer conf instead (`kit_home: <path>`, see the
  skeleton conf). A home that kept `watch_sources`/`memory_dir` in a start folder's conf as a
  workaround: once `kit_home` is added there, those keys are ignored with a notice -- move them
  into the home's own conf. Plugin versions moved (watch 0.3.0, obligations-pane 0.4.0,
  kit-update 0.2.0): `claude plugin marketplace update memory-kit`, then update each plugin or
  reinstall, then `/reload-plugins`.

- **0.1.0-alpha.14 -> 0.1.0-alpha.15:** no data step. Pull, lint, then update the plugins: plugin
  versions moved (watch 0.3.1, obligations-pane 0.5.0, kit-update 0.3.0), and a pull alone never
  updates one: `claude plugin marketplace update memory-kit`, `claude plugin update <p>@memory-kit`
  for each installed one, then `/reload-plugins`. kit-update.py now prints these steps (#23).
  - Obligations take `owed_to` (#29). Expect a new note per row without it, `no owed_to`, and a
    count; it never fails the gate. Nothing to change at the pull. From then on, write `owed_to`
    on new rows and on old ones as they are next touched; a row nobody but its actor is owed is
    a to-do, which belongs in the home's own work queue (moving one out is the human's call).
    Update the obligations pane with the release before any row carries `owed_to`: an older
    pane refuses the whole file on the unknown key.
  - New, optional: the commitments tier (#30). Nothing changes until the home creates
    `memory/commitments.yaml`; whether to use it is the human's call (see the GATE above). A
    scratchpad the home already named `commitments.yaml` (`current`/`staging`, no
    `commitments` key) is still linted as a scratchpad.
  - The lint banner now names the kit's VERSION (#26); alpha.14's said alpha.13. Nothing to do.
  - A session whose start folder has no `memory-kit.conf` now gets one kit-update notice saying so
    (#31). If the home is elsewhere, add a one-line pointer conf there: `kit_home: <path>`.

- **0.1.0-alpha.15 -> 0.1.0-alpha.16:** no data step. Pull, lint, then update the plugins as for alpha.15
  (watch 0.4.0, obligations-pane 0.5.1, kit-update 0.3.1; alpha.15's kit-update.py prints the steps), then
  `/reload-plugins`.
  - A home on Python 3.9 (macOS's system python3) can run `tools/lesson-index.py` again (#34).
    Nothing to do; if it skipped regenerating its index because of the crash, run it now.
  - `tools/kit-update.py` now runs the plugin updates itself after a pull that changed a plugin,
    when `claude` is on PATH (#37): `claude plugin marketplace update memory-kit` and `claude
    plugin update <p>@memory-kit` for each changed one installed, then it says to
    `/reload-plugins`. It changes the harness's plugin state, user-level for a user-scope install.
    The run that pulls alpha.16 is still alpha.15's script, which prints the steps; the new
    behaviour starts with the next update.
  - New: `memory-kit/adapters/claude-code/README.md`, "Install scope" (#35). A home whose plugins
    are installed at user scope can read there what they do in other folders, and move them to
    project scope if it wants; that choice is the human's.
  - The spool poller (#39): nothing changes until a home adds the new options. A Windows home that
    runs it gets `CREATE_NO_WINDOW` at the pull; restart the poller (kill the pid in
    `.<stem>.lock`, then start a session) to pick it up. `--remind`, `--json` and `--status` are
    opt-in. Read the watch README's "Ack only what you read, by id" either way.

- **0.1.0-alpha.16 -> 0.1.0-alpha.17:** a data step in `memory-kit.conf` only, for a home that
  runs the watch; nothing in the home's memory changes. `kit-update.py` refuses this pull (it
  takes only "no data step" entries): do it by hand. A home without the watch: pull, lint, done.
  The watch (0.5.0) is now **information only**: it rings a doorbell when a declared file grows,
  and never drains, archives or moves anything. **Consuming a file becomes the home's own step.**
  - **Before you reload, have a consumer.** The plugin update reaches every session of a
    user-scope install on that machine at its next `/reload-plugins` or restart, whatever its
    subtree says. A hub inbox nobody empties stops the courier: the next message waits.
  - **Own hub inbox** (`hub` on a file the courier alone writes, like the household's): consume
    it with a script the session runs on each ring -- move the inbox aside (atomic), print the
    messages in full, append them to your archive, and leave the inbox absent. The household's
    `scripts/hub-consume.sh` is a working model.
  - **The harness's teammate inbox** (`hub unread courier` on `~/.claude/teams/session-*/...`):
    the watch no longer takes courier entries out of it. Before reloading, run your own consumer
    for those entries (your earlier drain script, under the harness lock), or stay on alpha.16
    with the plugin pinned (`claude plugin update` not run) until you have one.
  - **A spool** (`lines`): declare it with `inject: true`; the ring carries the new lines and
    the bookmark advances, so the spool needs no consuming and may grow.
  - Then rewrite the conf: remove `watch_sources:` and declare `watch_files:`, each entry with
    all four fields (empty where unused). A conf still holding `watch_sources` gets one notice
    and nothing rings from it.

    ```yaml
    watch_files:
      - label: "hub mail"
        path: comms/inboxes/team-lead.json
        instruction: "Run scripts/hub-consume.sh now: the courier delivers nothing more until it runs."
        inject: false
    ```
  - Optional, new: `watch_idle_minutes: N` and `watch_context_percent: 50, 60, ...` -- reports
    only; what they mean is the home's own rule. `watch_retire_step` is now only quoted in the
    idle report.
  - The plugin options `retireOnIdle`, `idleMinutes` and `growthPercent` are gone; a set
    `retireOnIdle` gets one notice.
  - Plugins: watch 0.5.0 (obligations-pane 0.5.1 and kit-update 0.3.1 unchanged). Update with
    `claude plugin marketplace update memory-kit` and `claude plugin update watch@memory-kit`,
    then `/reload-plugins`, then `/watch` to see what it understood.

## Always

- The home's config for the kit lives outside the subtree; a pull must never clobber it.
- Merge the kit's subtree commits into the home with a merge commit, never a squash merge. A
  squash merge of a pull request drops git-subtree's metadata, and the next `git subtree pull`
  refuses. (`--squash` on the subtree command itself is fine; it is the PR merge that must not
  squash.) Repair: re-add the kit at the pinned version and merge that with a merge commit.
- If an upgrade requires the assistant to re-read the home's whole memory to make sense of it,
  that is a finding worth reporting: the kit has leaked into the home's data.
