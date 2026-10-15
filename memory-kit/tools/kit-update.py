#!/usr/bin/env python3
"""Move a home's vendored memory-kit to the newest release its channel allows.

    python3 memory-kit/tools/kit-update.py [home] [--dry-run]
    python3 memory-kit/tools/kit-update.py --help       this text; runs nothing

The home's memory-kit.conf names the channel:

    update: pinned      # the default: never move (upgrade by hand, per UPGRADE.md)
    update: verified    # the newest release with a verified/<tag> marker (the household passed it)
    update: latest      # the newest release tag
    upstream: mitselek/memory-kit    # optional; a Codeberg owner/repo or a git URL

A folder that is not the home may hold a pointer conf, `kit_home: <path>` (absolute, or relative
to that conf): the tool then runs on the home it names, one hop (lint/kit_home.py, kit #18).

What it does, and what it never does:
  - refuses a dirty tree (a tracked change anywhere, an untracked file under memory-kit/; an
    untracked file elsewhere is safe, #25), a new major version, and any step whose UPGRADE.md
    entry does not begin "no data step" (those need the full UPGRADE.md steps, by hand);
  - git subtree pull --squash of the target tag, then the lint gate over the home;
  - on a lint failure, undoes the pull (back to the commit it started from) and says why;
  - commits locally and NEVER pushes: each home's own push rule applies;
  - when a plugin changed, names the steps that update it: the marketplace update, a plugin
    update per changed plugin, then /reload-plugins (a pull alone never updates one, #23).

Exit: 0 updated or nothing to do, 1 refused or failed (and anything changed undone), 2 bad usage
(an unknown option, more than one home) or setup, 3 the undo itself failed: the tree may be partly pulled (the message says how to recover).
Kit #15. The kit-update plugin prompts a session to run this when a release appears.
"""
import os
import pathlib
import re
import subprocess
import sys

# Importing kit_home must leave no lint/__pycache__ in a home's vendored kit: an untracked file
# there is a dirty tree, which kit-update.py refuses.
sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lint"))
import kit_home  # noqa: E402  (kit #18: memory-kit.conf kit_home names the home)

DEFAULT_UPSTREAM = "https://codeberg.org/mitselek/memory-kit.git"
EXIT_ROLLBACK_FAILED = 3
# The bound on a network git call (fetch, subtree pull; ls-remote keeps its own 60 s). The kit is
# small: a fetch takes seconds on a slow link. 300 s leaves room for a slow remote and a large
# home's subtree merge while still ending a stalled transfer; a timeout is a failure (ultrareview
# alpha.13, finding 5).
NETWORK_TIMEOUT = 300
TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$")
PRE_RANK = {"alpha": 0, "beta": 1, "rc": 2, None: 3}


def say(msg):
    print(f"kit-update: {msg}")


def key(tag):
    m = TAG.match(tag)
    if not m:
        return None
    ma, mi, pa, pre, n = m.groups()
    return (int(ma), int(mi), int(pa), PRE_RANK[pre], int(n or 0))


def git(home, *args, check=True, timeout=None):
    """git in the home. With a timeout, a call still running then is stopped and fails (exit 124,
    "timed out after N s"), and git never waits on a credential prompt (GIT_TERMINAL_PROMPT=0)."""
    argv = ["git", "-C", str(home), *args]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        r = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        r = subprocess.CompletedProcess(argv, 124, "", f"timed out after {timeout} s")
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r


def conf_value(text, name):
    for line in text.splitlines():
        m = re.match(rf"^{name}:\s*(.*?)\s*(#.*)?$", line)
        if m:
            return m.group(1).strip().strip("'\"")
    return ""


def upstream_url(value):
    if not value:
        return DEFAULT_UPSTREAM
    if "://" in value or value.startswith("git@") or value.startswith("/"):
        return value
    if re.fullmatch(r"[\w.-]+/[\w.-]+", value):
        return f"https://codeberg.org/{value}.git"
    raise ValueError(f"unusable upstream: {value}")


def step_path(current, releases, target):
    """The versions to walk, from the home's current version to the target: the current version
    always first, even when its tag is gone upstream, then every release tag after it up to the
    target. So the current -> first-release hop is always checked (ultrareview alpha.13, 1)."""
    cur = key("v" + current)
    return [current] + [t[1:] for t in releases if cur < key(t) <= key(target)]


def data_steps_ok(upgrade_md, path):
    """Each step along the path must have an UPGRADE.md entry that begins 'no data step'."""
    for a, b in zip(path, path[1:]):
        m = re.search(rf"\*\*{re.escape(a)} -> {re.escape(b)}:\*\*\s*(.*)", upgrade_md)
        if not m:
            return f"UPGRADE.md has no entry for {a} -> {b}"
        if not m.group(1).lower().startswith("no data step"):
            return f"{a} -> {b} has a data step: {m.group(1)[:80]}"
    return None


def undo(home, start, why):
    """Back to the commit the update started from. The exit code: 1 when the reset worked, or
    EXIT_ROLLBACK_FAILED when it did not, said plainly with how to recover (ultrareview alpha.13, 4)."""
    r = git(home, "reset", "--hard", start, check=False)
    if r.returncode == 0:
        say(f"{why}; the pull is undone (back to {start[:12]})")
        return 1
    say(f"{why}, AND the undo failed: the tree may be partly pulled.")
    say(f"  git reset --hard {start} said: {r.stderr.strip()[:300]}")
    say(f"  To recover: remove a stale .git/index.lock if no git is running, then run")
    say(f"  `git -C {home} reset --hard {start}` and check `git -C {home} status` is clean.")
    return EXIT_ROLLBACK_FAILED


def paths_of(porcelain):
    """The paths in `git status --porcelain` output (a rename shows its new path)."""
    return [line[3:].split(" -> ")[-1] for line in porcelain.splitlines() if line.strip()]


def named(paths):
    """The first five paths, then a count of the rest."""
    more = f" +{len(paths) - 5} more" if len(paths) > 5 else ""
    return ", ".join(paths[:5]) + more


def plugin_steps(changed):
    """What to run when the pull changed files under memory-kit/adapters. A pull never updates an
    installed plugin: the harness keeps its own copy from the install, so /reload-plugins alone
    reloads the old one (#23, po-team's pane stayed at 0.1.0)."""
    names = sorted({p.split("/")[3] for p in changed
                    if p.startswith("memory-kit/adapters/claude-code/") and p.count("/") >= 4
                    and not p.split("/")[3].startswith(".")})
    lines = [f"plugins changed: {', '.join(names)}" if names else "the plugin marketplace changed",
             "a pull never updates an installed plugin; run, in order (each plugin this home has installed):",
             "  claude plugin marketplace update memory-kit"]
    lines += [f"  claude plugin update {n}@memory-kit" for n in names]
    lines.append("  then /reload-plugins in every session of this home")
    return lines


def lint_passes(home):
    """The home's lint gate, run with the home path. (passed, stdout)."""
    r = subprocess.run(["bash", str(home / "memory-kit/lint/memory-lint.sh"), str(home), "--gate"],
                       capture_output=True, text=True, encoding="utf-8")
    return r.returncode == 0, r.stdout


def main(argv):
    # Every option is known or refused: a dropped unknown one let --help run a real update (#32).
    opts = [a for a in argv[1:] if a.startswith("-")]
    args = [a for a in argv[1:] if not a.startswith("-")]
    if "--help" in opts or "-h" in opts:
        print(__doc__.strip())
        return 0
    for o in opts:
        if o != "--dry-run":
            say(f"unknown option {o} (usage: kit-update.py [home] [--dry-run]; --help for more)")
            return 2
    if len(args) > 1:
        say(f"one home at most, got {len(args)}: {' '.join(args)}")
        return 2
    dry = "--dry-run" in opts
    start = pathlib.Path(args[0] if args else ".").resolve()
    found = kit_home.resolve(start)
    if found.problem:
        say(found.problem)
        return 2
    home = found.home
    if found.pointer:
        say(f"following kit_home in {found.pointer} to {home}")
    vfile, cfile = home / "memory-kit" / "VERSION", home / "memory-kit.conf"
    if not cfile.exists():
        say(f"{kit_home.no_conf_notice(home)}. kit-update checks nothing until it has one.")
        return 2
    if not vfile.exists():
        say(f"{home} is not a kit home (needs memory-kit/VERSION and memory-kit.conf)")
        return 2
    conf = cfile.read_text(encoding="utf-8")
    channel = conf_value(conf, "update") or "pinned"
    if channel not in ("pinned", "verified", "latest"):
        say(f"update: {channel!r} is not pinned, verified or latest")
        return 2
    current = vfile.read_text(encoding="utf-8").strip()
    if channel == "pinned":
        say(f"pinned at {current}; nothing to do (upgrade by hand per UPGRADE.md)")
        return 0
    try:
        url = upstream_url(conf_value(conf, "upstream"))
    except ValueError as e:
        say(str(e))
        return 2

    r = subprocess.run(["git", "ls-remote", "--tags", "--refs", url], capture_output=True,
                       text=True, encoding="utf-8", timeout=60)
    if r.returncode != 0:
        say(f"cannot list tags at {url}: {r.stderr.strip()}")
        return 1
    names = [line.split("refs/tags/", 1)[1] for line in r.stdout.splitlines() if "refs/tags/" in line]
    releases = sorted((t for t in names if key(t)), key=key)
    verified = {t[len("verified/"):] for t in names if t.startswith("verified/")}
    pool = [t for t in releases if channel == "latest" or t in verified]
    if not pool:
        say(f"no {channel} release upstream")
        return 0
    target = pool[-1]
    cur_tag = "v" + current
    if key(cur_tag) is None:
        say(f"memory-kit/VERSION {current!r} is not a release version")
        return 2
    if key(target) <= key(cur_tag):
        say(f"up to date: {current} ({channel}; newest is {target[1:]})")
        return 0
    if key(target)[0] != key(cur_tag)[0]:
        say(f"{current} -> {target[1:]} is a new major version: upgrade by hand per UPGRADE.md")
        return 1
    # Tracked changes anywhere refuse; untracked files only under memory-kit/, where the pull writes
    # and the lint reads. Elsewhere they are safe: the undo (reset --hard) leaves them alone (#25).
    tracked = paths_of(git(home, "status", "--porcelain", "--untracked-files=no").stdout)
    if tracked:
        say(f"the home has uncommitted changes; commit or stash them first: {named(tracked)}")
        return 1
    stray = paths_of(git(home, "status", "--porcelain", "--untracked-files=all", "--", "memory-kit").stdout)
    if stray:
        say(f"files untracked under memory-kit/ (the pull writes there); remove or commit them first: {named(stray)}")
        return 1
    if not lint_passes(home)[0]:
        say("the home fails its own lint gate before any update; fix that first")
        return 1

    fetch = git(home, "fetch", "--no-tags", "--quiet", url, f"refs/tags/{target}", check=False,
                timeout=NETWORK_TIMEOUT)
    if fetch.returncode != 0:
        say(f"cannot fetch {target} from {url}: {fetch.stderr.strip()[:300]} (nothing changed)")
        return 1
    upgrade_md = git(home, "show", "FETCH_HEAD:UPGRADE.md").stdout
    path = step_path(current, releases, target)
    refusal = data_steps_ok(upgrade_md, path)
    if refusal:
        say(f"refused: {refusal}. Upgrade by hand per UPGRADE.md.")
        return 1
    if dry:
        say(f"would move {current} -> {target[1:]} ({channel}) via {' -> '.join(path)}")
        return 0

    start = git(home, "rev-parse", "HEAD").stdout.strip()
    msg = f"chore: memory-kit {current} -> {target[1:]} (kit-update, {channel})"
    pull = git(home, "subtree", "pull", "--prefix=memory-kit", url, target, "--squash",
               "-m", msg, check=False, timeout=NETWORK_TIMEOUT)
    if pull.returncode != 0:
        return undo(home, start, f"subtree pull failed: {pull.stderr.strip()[:300]}")
    ok, out = lint_passes(home)
    if not ok:
        fails = [l for l in out.splitlines() if "FAIL" in l][:5]
        say("the lint gate failed on the new version:")
        for f in fails:
            print("   ", f.strip())
        return undo(home, start, "the lint gate failed on the new version")
    plugins = git(home, "diff", "--name-only", start, "HEAD", "--", "memory-kit/adapters").stdout.split()
    say(f"updated {current} -> {target[1:]} ({channel}); lint gate passes; committed locally, not pushed")
    if plugins:
        for line in plugin_steps(plugins):
            say(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
