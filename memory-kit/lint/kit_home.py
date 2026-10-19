"""kit_home: a memory-kit.conf key naming the kit home (kit #18).

A session or a tool starts in some folder. If that folder's memory-kit.conf says

    kit_home: ../desk          # absolute, or relative to this conf's own folder

the home is that folder instead: its memory-kit.conf, memory-kit/VERSION, memory directory,
update:/upstream: and watch_files all count, and the pointer conf's other keys are ignored.

- One hop, never chained: the target's own conf may not point on (a loop is a chain too). A home
  naming itself (`kit_home: .`) is just the home.
- A target with no memory-kit.conf is a problem, said plainly; never a silent fall back.
- Absolute is POSIX (/...), a drive letter (C:\\ or C:/) or UNC (\\\\server\\share). `~` is not
  expanded: write the path absolute or relative to the conf.
- Upward (kit #42), only when asked (`resolve(start, upward=True)`): a start folder without a
  memory-kit.conf takes the nearest one above it, as git finds .git; the walk stops at the
  filesystem root. The tools ask when no folder was named (the current directory); a folder named
  on the command line is taken as given, so a fixture inside a vendored kit stays itself. The
  plugins always walk: a session's start folder is never named.

The lint and the tools import this file; the three Claude Code plugins carry the same rules in
hooks/kit-home.ts (lint/run-fixtures.sh holds those copies identical). Standard library only.
"""
import os
import pathlib
import re
from dataclasses import dataclass, field

KEY = "kit_home"
ABSOLUTE = re.compile(r"^(/|[A-Za-z]:[\\/]|\\\\)")


def is_absolute(path):
    return bool(ABSOLUTE.match(path))


def conf_value(text, name):
    """A top-level `name: value` of memory-kit.conf, comment and quotes stripped; '' if absent."""
    for line in text.splitlines():
        m = re.match(rf"^{re.escape(name)}:\s*(.*?)\s*(\s#.*)?$", line)
        if m:
            return m.group(1).strip().strip("'\"")
    return ""


def top_keys(text):
    return [m.group(1) for m in (re.match(r"^([A-Za-z_][\w-]*):", line) for line in text.splitlines()) if m]


@dataclass
class Resolved:
    home: "pathlib.Path | None"
    pointer: "pathlib.Path | None" = None  # the conf that named the home, when one did
    problem: "str | None" = None
    ignored: list = field(default_factory=list)  # pointer-conf keys that do not count
    found_in: "pathlib.Path | None" = None  # the folder above the start whose conf decided (kit #42)


def _read(path):
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _same(a, b):
    return os.path.normcase(os.path.normpath(str(a))) == os.path.normcase(os.path.normpath(str(b)))


def no_conf_notice(folder):
    """What a reader says when the folder it took for the home has no memory-kit.conf (kit #31),
    worded as the plugins' noConfNotice."""
    folder = os.path.normpath(str(folder)).replace(os.sep, "/")
    return f"{folder} has no memory-kit.conf, so it is not a kit home; if the home is elsewhere, put kit_home: <path> in a memory-kit.conf here"


def found_above_note(start, found_in):
    """What a reader says when the home came from a conf above the start folder (kit #42), worded
    as the plugins' foundAboveNote."""
    start, found_in = (os.path.normpath(str(p)).replace(os.sep, "/") for p in (start, found_in))
    return f"{start} has no memory-kit.conf; using the nearest one above it, in {found_in}"


def resolve(start, upward=False):
    """The home for a start folder, by its memory-kit.conf's kit_home (see the module doc)."""
    begin = pathlib.Path(os.path.normpath(str(start)))
    text = None
    for start in [begin, *begin.parents] if upward else [begin]:
        text = _read(start / "memory-kit.conf")
        if text is not None:
            break
    if text is None:
        return Resolved(begin)
    above = None if start == begin else start
    conf_path = start / "memory-kit.conf"
    raw = conf_value(text, KEY)
    if not raw:
        return Resolved(start, found_in=above)
    if raw.startswith("~"):
        return Resolved(None, conf_path, f"{conf_path}: kit_home: {raw} -- write it absolute or relative to this conf's folder (~ is not expanded)")
    target = pathlib.Path(os.path.normpath(raw if is_absolute(raw) else str(start / raw)))
    if _same(target, start):
        return Resolved(start, found_in=above)
    target_text = _read(target / "memory-kit.conf")
    if target_text is None:
        return Resolved(None, conf_path, f"{conf_path}: kit_home: {raw} -> {target}: no memory-kit.conf there, so it is not a kit home")
    onward = conf_value(target_text, KEY)
    if onward:
        onward_target = onward if is_absolute(onward) else str(target / onward)
        if not _same(onward_target, target):
            return Resolved(None, conf_path, f"{conf_path}: kit_home: {raw} -> {target}, whose own conf points on (kit_home: {onward}); a pointer is followed one hop, never chained")
    return Resolved(target, conf_path, None, [k for k in top_keys(text) if k != KEY], above)
