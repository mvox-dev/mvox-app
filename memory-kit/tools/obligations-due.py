#!/usr/bin/env python3
"""Deadline horizon over a home's obligations tier.

    python3 memory-kit/tools/obligations-due.py [home] [days]

    home   the home (the folder holding memory-kit.conf), or its memory directory.
           Default: the current directory.
    days   the window after today. Default: 7.

Prints the expired rows first (check them, then re-state, resolve or hand them to the human --
never renew one silently), then the rows that expire in the window, then a count of the rest.
Read-only. Exit 0 with output, 2 when there is no memory directory or the file cannot be read.

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


def memory_dir(target):
    target = pathlib.Path(target).resolve()
    if target.name == "memory":
        return target
    conf = target / "memory-kit.conf"
    name = "memory"
    if conf.exists():
        name = (yaml.safe_load(conf.read_text()) or {}).get("memory_dir", "memory")
    return target / name


def main(argv):
    target = argv[1] if len(argv) > 1 else "."
    days = int(argv[2]) if len(argv) > 2 else 7
    mem = memory_dir(target)
    if not mem.is_dir():
        sys.stderr.write(f"memory-kit: no such memory directory: {mem}\n")
        return 2
    path = mem / "obligations.yaml"
    if not path.exists():
        print(f"no obligations file ({path})")
        return 0
    try:
        rows = (yaml.safe_load(path.read_text()) or {}).get("obligations") or []
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
        print(f"- {r.get('expires')}  {r.get('actor')}: {r.get('obligation')}")
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
