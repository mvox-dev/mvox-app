#!/usr/bin/env python3
"""Move a home's vendored memory-kit to the newest release its channel allows.

    python3 memory-kit/tools/kit-update.py [home] [--dry-run]

The home's memory-kit.conf names the channel:

    update: pinned      # the default: never move (upgrade by hand, per UPGRADE.md)
    update: verified    # the newest release with a verified/<tag> marker (the household passed it)
    update: latest      # the newest release tag
    upstream: mitselek/memory-kit    # optional; a Codeberg owner/repo or a git URL

What it does, and what it never does:
  - refuses a dirty tree, a new major version, and any step whose UPGRADE.md entry does not
    begin "no data step" (those need the full UPGRADE.md steps, by hand);
  - git subtree pull --squash of the target tag, then the lint gate over the home;
  - on a lint failure, undoes the pull (back to the commit it started from) and says why;
  - commits locally and NEVER pushes: each home's own push rule applies;
  - says when a plugin changed, so the session runs /reload-plugins.

Exit: 0 updated or nothing to do, 1 refused or failed, 2 bad usage or setup.
Kit #15. The kit-update plugin prompts a session to run this when a release appears.
"""
import pathlib
import re
import subprocess
import sys

DEFAULT_UPSTREAM = "https://codeberg.org/mitselek/memory-kit.git"
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


def git(home, *args, check=True):
    r = subprocess.run(["git", "-C", str(home), *args], capture_output=True, text=True,
                       encoding="utf-8")
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


def data_steps_ok(upgrade_md, path):
    """Each step along the path must have an UPGRADE.md entry that begins 'no data step'."""
    for a, b in zip(path, path[1:]):
        m = re.search(rf"\*\*{re.escape(a)} -> {re.escape(b)}:\*\*\s*(.*)", upgrade_md)
        if not m:
            return f"UPGRADE.md has no entry for {a} -> {b}"
        if not m.group(1).lower().startswith("no data step"):
            return f"{a} -> {b} has a data step: {m.group(1)[:80]}"
    return None


def lint_passes(home):
    """The home's lint gate, run with the home path. (passed, stdout)."""
    r = subprocess.run(["bash", str(home / "memory-kit/lint/memory-lint.sh"), str(home), "--gate"],
                       capture_output=True, text=True, encoding="utf-8")
    return r.returncode == 0, r.stdout


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in argv
    home = pathlib.Path(args[0] if args else ".").resolve()
    vfile, cfile = home / "memory-kit" / "VERSION", home / "memory-kit.conf"
    if not vfile.exists() or not cfile.exists():
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
    if git(home, "status", "--porcelain").stdout.strip():
        say("the home has uncommitted changes; commit or stash them first")
        return 1
    if not lint_passes(home)[0]:
        say("the home fails its own lint gate before any update; fix that first")
        return 1

    git(home, "fetch", "--no-tags", "--quiet", url, f"refs/tags/{target}")
    upgrade_md = git(home, "show", "FETCH_HEAD:UPGRADE.md").stdout
    path = [t[1:] for t in releases if key(cur_tag) <= key(t) <= key(target)]
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
               "-m", msg, check=False)
    if pull.returncode != 0:
        git(home, "reset", "--hard", start, check=False)
        say(f"subtree pull failed, undone: {pull.stderr.strip()[:300]}")
        return 1
    ok, out = lint_passes(home)
    if not ok:
        git(home, "reset", "--hard", start, check=False)
        fails = [l for l in out.splitlines() if "FAIL" in l][:5]
        say("the lint gate failed on the new version; the pull is undone:")
        for f in fails:
            print("   ", f.strip())
        return 1
    plugins = git(home, "diff", "--name-only", start, "HEAD", "--", "memory-kit/adapters").stdout.split()
    say(f"updated {current} -> {target[1:]} ({channel}); lint gate passes; committed locally, not pushed")
    if plugins:
        say("a plugin changed: run /reload-plugins")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
