#!/usr/bin/env python3
"""Feed the watch from a remote hub: run a peek-only command, append one line per new item to a spool.

    python3 spool-poll.py --spool PATH --match REGEX [options] -- COMMAND [ARGS...]

Kit #16, after the fleet's lelle-watch.py --spool (pepys desk, semafor, hr2). The watch reads
local files only; this poller bridges a hub it cannot read, and the home declares the spool as a
`lines` source:

    watch_sources:
      - "lelle | lines | inbound/lelle-spool.txt"

Every --every seconds (30) it runs COMMAND, which must only LOOK at the hub (e.g. `evr-mail recv
--peek`): it never collects or acks, so custody stays with the session's own collect, after the
mail is recorded. Each match of --match in the command's stdout (a Python regex, multiline) is
one item, and its named group `id` keys it. A new id appends one line to the spool, written by
--line (str.format over the named groups; an absent group is empty; default: the match itself,
on one line). Seen ids persist in .<stem>-seen.json beside the spool (the last --keep, 500), so a
peeked but uncollected item is not spooled again, across restarts too.

Health: a run fails when the command cannot start, times out (--timeout, 90 s), exits non-zero,
or prints nothing matching --healthy. After --tolerate failures in a row (3) the spool gets one
`health: <why>` line, then at most one per --health-every seconds (1800) while it keeps failing,
and `health: recovered` once a run succeeds again.

One poller per spool: it holds .<stem>.lock beside the spool (flock on POSIX, the same lock the
`flock` command takes; msvcrt on Windows) and writes its pid there. A second one finds the lock
held, says so and exits 0.

  --once        one poll, then exit (a scheduler's job, a test).
  --keep-alive  for a SessionStart hook: if a poller holds the lock, exit 0 at once; otherwise
                start one detached (its own session; output to .<stem>.log beside the spool) and
                exit 0. Never blocks the session.

Exit: 0 polled, already running, or started; 2 bad usage.
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import time

USAGE = "usage: spool-poll.py [--keep-alive | --once] --spool PATH --match REGEX [--line TEMPLATE] [--healthy REGEX] [--every S] [--timeout S] [--tolerate N] [--health-every S] [--keep N] -- COMMAND [ARGS...]"


class Config:
    def __init__(self, spool, match, command, line=None, healthy=None, every=30.0, timeout=90.0, tolerate=3, health_every=1800.0, keep=500):
        self.spool = pathlib.Path(spool)
        self.match, self.command, self.line, self.healthy = match, list(command), line, healthy
        self.every, self.timeout, self.tolerate, self.health_every, self.keep = every, timeout, tolerate, health_every, keep


def _beside(spool, suffix):
    spool = pathlib.Path(spool)
    return spool.with_name(f".{spool.stem}{suffix}")


def seen_path(spool):
    return _beside(spool, "-seen.json")


def lock_path(spool):
    return _beside(spool, ".lock")


def log_path(spool):
    return _beside(spool, ".log")


def check_pattern(pattern):
    """A usable --match: it compiles and has a named group `id`. ValueError says why not."""
    try:
        compiled = re.compile(pattern, re.MULTILINE)
    except re.error as e:
        raise ValueError(f"--match does not compile: {e}") from e
    if "id" not in compiled.groupindex:
        raise ValueError("--match needs a named group (?P<id>...): the id that keys an item")
    return compiled


def one_line(text):
    return " ".join(text.split())


def items(stdout, pattern, template):
    """[(id, line)] for each match, in order. The line is never more than one line."""
    found = []
    for m in check_pattern(pattern).finditer(stdout):
        groups = {k: (v or "") for k, v in m.groupdict().items()}
        text = template.format_map(groups) if template is not None else m.group(0)
        found.append((groups["id"], one_line(text) or groups["id"]))
    return found


def _append(path, lines):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Opened per write: the watch drains the spool by renaming it aside, and the next write makes
    # it again. One write call, so a line is never split.
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write("".join(f"{line}\n" for line in lines))
        f.flush()


def _load_seen(path, keep):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return [str(x) for x in data][-keep:] if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save_seen(path, seen):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(seen), encoding="utf-8")
    os.replace(tmp, path)


class Poller:
    def __init__(self, config, run=subprocess.run):
        self.c, self.run = config, run
        self.seen = _load_seen(seen_path(config.spool), config.keep)
        self.failures = 0
        self.health_at = None  # when the last health line went out, while failing

    def peek(self):
        """(ok, stdout, why). Runs the command once; never more than it is given."""
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        try:
            r = self.run(self.c.command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=self.c.timeout, env=env)
        except subprocess.TimeoutExpired:
            return False, "", f"timed out after {self.c.timeout:g} s"
        except OSError as e:
            return False, "", f"cannot run {self.c.command[0]}: {e}"
        if r.returncode != 0:
            last = (r.stderr or r.stdout or "").strip().splitlines()
            return False, "", f"exit {r.returncode}: {last[-1] if last else 'no output'}"
        if self.c.healthy is not None and not re.search(self.c.healthy, r.stdout, re.MULTILINE):
            return False, "", f"output did not match {self.c.healthy}"
        return True, r.stdout, ""

    def poll(self, now=None):
        now = time.monotonic() if now is None else now
        ok, out, why = self.peek()
        if not ok:
            self.failures += 1
            if self.failures >= self.c.tolerate and (self.health_at is None or now - self.health_at >= self.c.health_every):
                _append(self.c.spool, [one_line(f"health: {why}")])
                self.health_at = now
            return
        if self.health_at is not None:
            _append(self.c.spool, ["health: recovered"])
        self.failures, self.health_at = 0, None
        fresh, known = [], set(self.seen)
        for i, line in items(out, self.c.match, self.c.line):
            if i not in known:
                known.add(i)
                fresh.append((i, line))
        if not fresh:
            return
        # The lines first, then the seen set: a crash between them spools an item twice, never
        # loses one.
        _append(self.c.spool, [line for _, line in fresh])
        self.seen.extend(i for i, _ in fresh)
        del self.seen[: -self.c.keep]
        _save_seen(seen_path(self.c.spool), self.seen)


def take_lock(path):
    """The open lock file, held; None when another process holds it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "a+", encoding="utf-8")
    try:
        if os.name == "nt":
            import msvcrt

            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def parse(argv):
    """(mode, Config) or a usage problem as a string."""
    if "--" not in argv:
        return "no command: give it after --"
    cut = argv.index("--")
    opts, command = argv[:cut], argv[cut + 1 :]
    if not command:
        return "no command after --"
    mode, values = "loop", {}
    names = {"--spool": str, "--match": str, "--line": str, "--healthy": str, "--every": float, "--timeout": float, "--tolerate": int, "--health-every": float, "--keep": int}
    i = 0
    while i < len(opts):
        a = opts[i]
        if a in ("--once", "--keep-alive"):
            mode = a[2:]
            i += 1
            continue
        if a not in names or i + 1 >= len(opts):
            return f"unknown or incomplete option: {a}"
        try:
            values[a[2:].replace("-", "_")] = names[a](opts[i + 1])
        except ValueError:
            return f"{a} takes a number"
        i += 2
    if "spool" not in values or "match" not in values:
        return "--spool and --match are required"
    try:
        check_pattern(values["match"])
    except ValueError as e:
        return str(e)
    return mode, Config(command=command, **values)


def keep_alive(argv, config):
    """Start one detached poller unless one runs. Returns at once."""
    held = take_lock(lock_path(config.spool))
    if held is None:
        return 0  # one runs
    held.close()
    # The child takes the lock itself; if another start won the race, it finds the lock held and exits 0.
    child = [sys.executable, str(pathlib.Path(__file__).resolve()), *[a for a in argv if a != "--keep-alive"]]
    log = open(log_path(config.spool), "a", encoding="utf-8")
    kw = dict(stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, cwd=os.getcwd())
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        try:
            subprocess.Popen(child, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kw)
        except OSError:
            subprocess.Popen(child, creationflags=flags, **kw)  # a job that refuses breakaway
    else:
        subprocess.Popen(child, start_new_session=True, **kw)
    log.close()
    return 0


def say(text):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] spool-poll: {text}", flush=True)


def main(argv):
    parsed = parse(argv)
    if isinstance(parsed, str):
        print(f"spool-poll: {parsed}\n{USAGE}", file=sys.stderr)
        return 2
    mode, config = parsed
    if mode == "keep-alive":
        return keep_alive(argv, config)
    lock = take_lock(lock_path(config.spool))
    if lock is None:
        say(f"another poller holds {lock_path(config.spool)}; exiting")
        return 0
    lock.seek(0)
    lock.truncate()
    lock.write(f"{os.getpid()}\n")
    lock.flush()
    poller = Poller(config)
    if mode == "once":
        poller.poll()
        return 0
    say(f"polling every {config.every:g} s into {config.spool}: {' '.join(config.command)}")
    while True:
        try:
            poller.poll()
        except OSError as e:
            say(f"spool error: {e}")
        time.sleep(config.every)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
