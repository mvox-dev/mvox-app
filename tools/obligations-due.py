#!/usr/bin/env python3
"""Deadline horizon over a home's obligations tier.

    python3 memory-kit/tools/obligations-due.py [home] [days]

    home   the home (the folder holding memory-kit.conf), or its memory directory, or a folder
           whose memory-kit.conf points at the home (kit_home:, kit #18). Default: the current
           directory, or the nearest folder above it with a memory-kit.conf (kit #42).
    days   the window after today. Default: 7.

Prints each row as `expires  actor -> owed_to: obligation` (no arrow on a row without owed_to).
Prints the expired rows first (check them, then re-state, resolve or hand them to the human --
never renew one silently), then the rows that expire in the window, then a count of the rest.
Read-only. Exit 0 with output, 2 when there is no memory directory or the file cannot be read.
A key given twice, in obligations.yaml or memory-kit.conf, is such a file: loaded as the lint
loads it, never the last copy kept silently (kit #55).

Three homes wrote this script independently before it shipped (household finding 13).
"""
import datetime as dt
import pathlib
import sys

try:
    import yaml
except ImportError:
    sys.stderr.write("memory-kit: PyYAML is required (apt install python3-yaml | pip install pyyaml)\n")
    sys.exit(2)


# Importing kit_home must leave no lint/__pycache__ in a home's vendored kit: an untracked file
# there is a dirty tree, which kit-update.py refuses.
sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lint"))
import kit_home  # noqa: E402
# A key given twice is an error, as the lint reads it, never the last copy kept silently (kit #55).
from strict_yaml import DuplicateKey, strict_load  # noqa: E402


def memory_dir(target, upward=False):
    target = pathlib.Path(target).resolve()
    if target.name == "memory":
        return target
    found = kit_home.resolve(target, upward)
    if found.problem:
        sys.stderr.write(f"memory-kit: {found.problem}\n")
        sys.exit(2)
    if found.found_in:
        sys.stderr.write(f"memory-kit: {kit_home.found_above_note(target, found.found_in)}\n")
    target = found.home
    conf = target / "memory-kit.conf"
    name = "memory"
    if conf.exists():
        try:
            data = strict_load(conf.read_text(encoding="utf-8"))
        except DuplicateKey as e:
            sys.stderr.write(f"memory-kit: {conf}: {e.message()}\n")
            sys.exit(2)
        name = (data or {}).get("memory_dir", "memory")
    return target / name


def main(argv):
    target = argv[1] if len(argv) > 1 else "."
    days = int(argv[2]) if len(argv) > 2 else 7
    # Only an unnamed folder looks upward for a conf (kit #42); a named one is taken as given.
    mem = memory_dir(target, upward=len(argv) <= 1)
    if not mem.is_dir():
        sys.stderr.write(f"memory-kit: no such memory directory: {mem}\n")
        return 2
    path = mem / "obligations.yaml"
    if not path.exists():
        print(f"no obligations file ({path})")
        return 0
    try:
        rows = (strict_load(path.read_text(encoding="utf-8")) or {}).get("obligations") or []
    except DuplicateKey as e:
        sys.stderr.write(f"memory-kit: {path}: {e.message()}\n")
        return 2
    except yaml.YAMLError as e:
        sys.stderr.write(f"memory-kit: {path}: unparseable YAML: {str(e).splitlines()[0]}\n")
        return 2

    today = dt.date.today()
    soon = today + dt.timedelta(days=days)
    rows = sorted(rows, key=lambda r: str(r.get("expires", "")))

    def when(r):
        try:
            return dt.date.fromisoformat(str(r.get("expires", "")))
        except ValueError:
            return None

    def show(r):
        owed = f" -> {r['owed_to']}" if r.get("owed_to") else ""
        print(f"- {r.get('expires')}  {r.get('actor')}{owed}: {r.get('obligation')}")
        if r.get("check"):
            print(f"    check: {r['check']}")

    undated = [r for r in rows if when(r) is None]
    expired = [r for r in rows if when(r) is not None and when(r) < today]
    near = [r for r in rows if when(r) is not None and today <= when(r) <= soon]
    later = len(rows) - len(undated) - len(expired) - len(near)

    print(f"## expired ({len(expired)}) -- check, then re-state, resolve, or hand to the human")
    for r in expired:
        show(r)
    print(f"## next {days} days ({len(near)})")
    for r in near:
        show(r)
    if undated:
        print(f"## no valid expires ({len(undated)}) -- the lint fails these")
        for r in undated:
            show(r)
    print(f"## later: {later} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
