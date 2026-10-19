#!/usr/bin/env python3
"""Feed the watch from a remote hub: run a peek-only command, append one line per new item to a spool.

    python3 spool-poll.py --spool PATH (--match REGEX | --json) [options] -- COMMAND [ARGS...]
    python3 spool-poll.py --status --spool PATH

Kit #16, after the fleet's lelle-watch.py --spool (pepys desk, semafor, hr2). The watch reads
local files only; this poller bridges a hub it cannot read, and the home declares the spool as an
injecting doorbell in memory-kit.conf (watch 0.5.0; the watch's README, "A remote hub"):

    watch_files:
      - label: lelle
        path: inbound/lelle-spool.txt
        instruction: "collect with recv, then ack BY ID what you read"
        inject: true

Every --every seconds (30) it runs COMMAND, which must only LOOK at the hub (e.g. `evr-mail recv
--peek`): it never collects or acks, so custody stays with the session's own collect, after the
mail is recorded. Each match of --match in the command's stdout (a Python regex, multiline) is
one item, and its named group `id` keys it. A new id appends one line to the spool, written by
--line (str.format over the named groups; an absent group is empty; default: the match itself,
on one line). Seen ids persist in .<stem>-seen.json beside the spool (the last --keep, 500), so a
peeked but uncollected item is not spooled again, across restarts too.

--json instead of --match (kit #39, hr2's `recv --peek --json`): the output's first JSON value
must be a list of objects, each with an `id`; each is an item. --line is str.format over the
object, nested fields by index ({entry[summary]}); a missing field is empty. Without --line, the
line is the object as JSON. Output that is not such a list is a failed run (below), never quiet.

--remind N (minutes; kit #39): an id still in the peek N minutes after this poller first saw it
gets one more line, `waiting: id=<id> age=<age> -- <line>`. The age runs from the hub's deposit
stamp when --deposited (a template like --line, default {deposited}: a named group of --match)
gives one in ISO 8601, else from when this poller first saw the id. Once per id per poller run.

Health: a run fails when the command cannot start, times out (--timeout, 90 s), exits non-zero,
or prints nothing matching --healthy. After --tolerate failures in a row (3) the spool gets one
`health: <why>` line, then at most one per --health-every seconds (1800) while it keeps failing,
and `health: recovered` once a run succeeds again.

Liveness (kit #39): each successful run writes `<UTC time> pid=<pid> every=<s> timeout=<s>` to
.<stem>.alive beside the spool. It is stale when older than two intervals and a timeout.

One poller per spool: it holds .<stem>.lock beside the spool (flock on POSIX, the same lock the
`flock` command takes; msvcrt on Windows) and writes its pid there. A second one finds the lock
held, says so and exits 0.

  --once        one poll, then exit (a scheduler's job, a test).
  --keep-alive  for a SessionStart hook: if a poller holds the lock, exit 0 at once; otherwise
                start one detached (its own session; output to .<stem>.log beside the spool) and
                exit 0. Never blocks the session. It prints one line when the running poller's
                heartbeat is stale, or when it starts one after an outage (the last poll's time).
                On Windows the poller and each peek run with CREATE_NO_WINDOW: no console flash.
  --status      whether a poller holds the lock (its pid), the last successful poll and its age,
                and whether that is stale. Needs only --spool.

Exit: 0 polled, already running, or started; --status 0 running and fresh, 1 not; 2 bad usage.
"""
import datetime as dt
import json
import os
import pathlib
import re
import string
import subprocess
import sys
import time

USAGE = ("usage: spool-poll.py [--keep-alive | --once] --spool PATH (--match REGEX | --json) [--line TEMPLATE] [--healthy REGEX] "
         "[--every S] [--timeout S] [--tolerate N] [--health-every S] [--keep N] [--remind MIN] [--deposited TEMPLATE] -- COMMAND [ARGS...]\n"
         "       spool-poll.py --status --spool PATH")

# Windows process flags (kit #39), by value: subprocess names them on Windows only. DETACHED_PROCESS
# gave the poller no console, so each peek opened a visible one: a flash every poll (desk, FR).
WINDOWS = os.name == "nt"
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_BREAKAWAY_FROM_JOB = 0x01000000
CREATE_NO_WINDOW = 0x08000000


class Config:
    def __init__(self, spool, match, command, line=None, healthy=None, every=30.0, timeout=90.0, tolerate=3, health_every=1800.0, keep=500,
                 json_items=False, remind=0.0, deposited="{deposited}"):
        self.spool = pathlib.Path(spool)
        self.match, self.command, self.line, self.healthy = match, list(command), line, healthy
        self.every, self.timeout, self.tolerate, self.health_every, self.keep = every, timeout, tolerate, health_every, keep
        self.json_items, self.remind, self.deposited = json_items, remind, deposited


def _beside(spool, suffix):
    spool = pathlib.Path(spool)
    return spool.with_name(f".{spool.stem}{suffix}")


def seen_path(spool):
    return _beside(spool, "-seen.json")


def lock_path(spool):
    return _beside(spool, ".lock")


def log_path(spool):
    return _beside(spool, ".log")


def alive_path(spool):
    return _beside(spool, ".alive")


def stamp(wall):
    """A wall-clock time as UTC ISO 8601, to the second."""
    return dt.datetime.fromtimestamp(wall, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def wall_of(text):
    """Seconds since the epoch from an ISO 8601 stamp (Z, an offset, or none: UTC); None if it is not one."""
    try:
        when = dt.datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (when if when.tzinfo else when.replace(tzinfo=dt.timezone.utc)).timestamp()


def age_of(seconds):
    """17m, 2h05m."""
    m = int(seconds // 60)
    return f"{m}m" if m < 60 else f"{m // 60}h{m % 60:02d}m"


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


def regex_items(stdout, pattern, template):
    """[(id, line, groups)] for each match, in order. The line is never more than one line."""
    found = []
    for m in check_pattern(pattern).finditer(stdout):
        groups = {k: (v or "") for k, v in m.groupdict().items()}
        text = template.format_map(groups) if template is not None else m.group(0)
        found.append((groups["id"], one_line(text) or groups["id"], groups))
    return found


def items(stdout, pattern, template):
    """[(id, line)] for each match, in order."""
    return [(i, line) for i, line, _ in regex_items(stdout, pattern, template)]


class _Blank(string.Formatter):
    """str.format over a JSON item: a missing field or index is empty, as an absent group is."""

    def get_field(self, field_name, args, kwargs):
        try:
            return super().get_field(field_name, args, kwargs)
        except (KeyError, IndexError, AttributeError, TypeError):
            return "", field_name

    def format_field(self, value, spec):
        return super().format_field("" if value is None else value, spec)


def json_items(stdout, template):
    """[(id, line, fields)] from the output's first JSON value, a list of objects with ids. ValueError
    says what is wrong: a changed format is a failed run, never quiet (kit #39)."""
    try:
        data, _ = json.JSONDecoder().raw_decode(stdout.lstrip())
    except ValueError:
        raise ValueError("output is not JSON") from None
    if not isinstance(data, list):
        raise ValueError("output is not a JSON list")
    found = []
    for n, obj in enumerate(data, 1):
        if not isinstance(obj, dict):
            raise ValueError(f"item {n} is not an object")
        if obj.get("id") in (None, ""):
            raise ValueError(f"item {n} has no id")
        text = _Blank().vformat(template, (), obj) if template is not None else json.dumps(obj, ensure_ascii=False)
        found.append((str(obj["id"]), one_line(text) or str(obj["id"]), obj))
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


def _write(path, text):
    """The whole file through a temporary beside it and a rename: a reader never sees half."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _save_seen(path, seen):
    _write(path, json.dumps(seen))


class Poller:
    def __init__(self, config, run=subprocess.run):
        self.c, self.run = config, run
        self.seen = _load_seen(seen_path(config.spool), config.keep)
        self.failures = 0
        self.health_at = None  # when the last health line went out, while failing
        self.first_seen = {}  # id -> wall time this run first saw it in a peek, while it stays there
        self.reminded = set()

    def peek(self):
        """(ok, stdout, why). Runs the command once; never more than it is given."""
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        flags = {"creationflags": CREATE_NO_WINDOW} if WINDOWS else {}
        try:
            r = self.run(self.c.command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=self.c.timeout, env=env, **flags)
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

    def entries(self, out):
        """[(id, line, fields)]: the regex groups or the JSON object."""
        if self.c.json_items:
            return json_items(out, self.c.line)
        return regex_items(out, self.c.match, self.c.line)

    def poll(self, now=None, wall=None):
        now = time.monotonic() if now is None else now
        wall = time.time() if wall is None else wall
        ok, out, why = self.peek()
        if ok:
            try:
                found = self.entries(out)
            except ValueError as e:
                ok, why = False, str(e)
        if not ok:
            self.failures += 1
            if self.failures >= self.c.tolerate and (self.health_at is None or now - self.health_at >= self.c.health_every):
                _append(self.c.spool, [one_line(f"health: {why}")])
                self.health_at = now
            return
        if self.health_at is not None:
            _append(self.c.spool, ["health: recovered"])
        self.failures, self.health_at = 0, None
        _write(alive_path(self.c.spool), f"{stamp(wall)} pid={os.getpid()} every={self.c.every:g} timeout={self.c.timeout:g}\n")
        fresh, known = [], set(self.seen)
        for i, line, _ in found:
            if i not in known:
                known.add(i)
                fresh.append((i, line))
        if fresh:
            # The lines first, then the seen set: a crash between them spools an item twice, never
            # loses one.
            _append(self.c.spool, [line for _, line in fresh])
            self.seen.extend(i for i, _ in fresh)
            del self.seen[: -self.c.keep]
            _save_seen(seen_path(self.c.spool), self.seen)
        self.remind(found, wall)

    def remind(self, found, wall):
        """One `waiting:` line per id still in the peek --remind minutes after this run first saw it."""
        ids = {i for i, _, _ in found}
        self.first_seen = {i: self.first_seen.get(i, wall) for i in ids}
        self.reminded &= ids
        if self.c.remind <= 0:
            return
        due = []
        for i, line, fields in found:
            if i in self.reminded or wall - self.first_seen[i] < self.c.remind * 60:
                continue
            deposited = wall_of(_Blank().vformat(self.c.deposited, (), fields))
            due.append((i, f"waiting: id={i} age={age_of(wall - (deposited or self.first_seen[i]))} -- {line}"))
        if due:
            _append(self.c.spool, [line for _, line in due])
            self.reminded.update(i for i, _ in due)


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
    """(mode, Config) or a usage problem as a string. --status needs --spool alone."""
    cut = argv.index("--") if "--" in argv else len(argv)
    opts, command = argv[:cut], argv[cut + 1 :]
    mode, values = "loop", {}
    names = {"--spool": str, "--match": str, "--line": str, "--healthy": str, "--every": float, "--timeout": float, "--tolerate": int,
             "--health-every": float, "--keep": int, "--remind": float, "--deposited": str}
    i = 0
    while i < len(opts):
        a = opts[i]
        if a in ("--once", "--keep-alive", "--status"):
            mode = a[2:]
            i += 1
            continue
        if a == "--json":
            values["json_items"] = True
            i += 1
            continue
        if a not in names or i + 1 >= len(opts):
            return f"unknown or incomplete option: {a}"
        try:
            values[a[2:].replace("-", "_")] = names[a](opts[i + 1])
        except ValueError:
            return f"{a} takes a number"
        i += 2
    if "spool" not in values:
        return "--spool is required"
    if mode == "status":
        return mode, Config(match=None, command=command, **{k: v for k, v in values.items() if k != "match"})
    if "--" not in argv:
        return "no command: give it after --"
    if not command:
        return "no command after --"
    if bool(values.get("json_items")) == ("match" in values):
        return "give --match or --json, one of them"
    if "match" in values:
        try:
            check_pattern(values["match"])
        except ValueError as e:
            return str(e)
    else:
        values["match"] = None
    return mode, Config(command=command, **values)


def heartbeat(spool):
    """(wall time of the last successful poll, stale after N s), or None when there is none."""
    try:
        text = alive_path(spool).read_text(encoding="utf-8")
    except OSError:
        return None
    fields = dict(f.split("=", 1) for f in text.split()[1:] if "=" in f)
    wall = wall_of(text.split()[0]) if text.split() else None
    if wall is None:
        return None
    try:
        return wall, 2 * float(fields.get("every", 30)) + float(fields.get("timeout", 90))
    except ValueError:
        return wall, 150.0


def ago(seconds):
    """40 s, 10 min, 2 h."""
    s = int(seconds)
    return f"{s} s" if s < 120 else f"{s // 60} min" if s < 7200 else f"{s // 3600} h"


def status(config):
    """--status: the lock, the heartbeat, stale or not. 0 running and fresh, 1 otherwise."""
    held = take_lock(lock_path(config.spool))
    running = held is None
    if held is not None:
        held.close()
    lines = [f"spool-poll: {config.spool}"]
    if running:
        try:
            pid = lock_path(config.spool).read_text(encoding="utf-8").strip() or "?"
        except OSError:
            pid = "?"
        lines.append(f"  poller: running, pid {pid}")
    else:
        lines.append("  poller: not running")
    beat, fresh = heartbeat(config.spool), False
    if beat is None:
        lines.append("  last successful poll: none recorded")
    else:
        wall, stale_after = beat
        age = time.time() - wall
        lines.append(f"  last successful poll: {stamp(wall)}, {ago(age)} ago")
        fresh = age <= stale_after
        if not fresh:
            lines.append(f"  stale: no successful poll for {int(age)} s (more than {stale_after:g} s)")
    print("\n".join(lines))
    return 0 if running and fresh else 1


def keep_alive(argv, config):
    """Start one detached poller unless one runs. Returns at once."""
    held = take_lock(lock_path(config.spool))
    beat = heartbeat(config.spool)
    if held is None:  # one runs; say so only when it has not polled lately (kit #39)
        if beat is not None and time.time() - beat[0] > beat[1]:
            try:
                pid = lock_path(config.spool).read_text(encoding="utf-8").strip() or "?"
            except OSError:
                pid = "?"
            print(f"spool-poll: the poller (pid {pid}) holds the lock, but its last successful poll was "
                  f"{ago(time.time() - beat[0])} ago ({stamp(beat[0])}); see {log_path(config.spool)}")
        return 0
    held.close()
    if beat is not None:
        print(f"spool-poll: no poller was running; the last successful poll was {ago(time.time() - beat[0])} ago "
              f"({stamp(beat[0])}); started one")
    # The child takes the lock itself; if another start won the race, it finds the lock held and exits 0.
    child = [sys.executable, str(pathlib.Path(__file__).resolve()), *[a for a in argv if a != "--keep-alive"]]
    log = open(log_path(config.spool), "a", encoding="utf-8")
    kw = dict(stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, cwd=os.getcwd())
    if WINDOWS:
        # CREATE_NO_WINDOW, not DETACHED_PROCESS: a hidden console of its own, which its peeks share,
        # so none flashes a window (kit #39). Its own group: the hook's Ctrl+C does not reach it.
        flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        try:
            subprocess.Popen(child, creationflags=flags | CREATE_BREAKAWAY_FROM_JOB, **kw)
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
    if mode == "status":
        return status(config)
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
