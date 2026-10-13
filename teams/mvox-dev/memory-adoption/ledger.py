#!/usr/bin/env python3
"""Phase 2 dispositions from 01-items.tsv under the GATE 1 ruling. Writes 02-ledger.tsv,
prints the arithmetic. Usage: ledger.py 01-items.tsv <team-memory-dir>"""
import collections, csv, pathlib, sys

MOVED = {"architecture-decisions.md", "i18n-conventions.md"}       # whole file -> docs/
IDLE = {"byrd.md", "comenius.md", "tallis.md", "victoria.md"}       # yaml only if live
DEAD_TIERS = {"history", "superseded", "dup"}


def disposition(r):
    f, t = r["file"], r["tier"]
    if f in MOVED:
        return "move"
    if f == "test-gaps.md" or r["id"] == "bentham#30" or t in DEAD_TIERS:
        return "dead"
    if f in IDLE or "+" in t or (t == "longform" and f not in MOVED):
        return "judgment"
    if t == "rule":
        return "phase4"
    return "convert"


rows = list(csv.DictReader(open(sys.argv[1]), delimiter="\t"))
mem = pathlib.Path(sys.argv[2])
out = [(r["id"], r["file"], r["tier"], disposition(r)) for r in rows]
out += [(f"{p.parent.name}/{p.name}", p.parent.name + "/", "history", "dead")
        for d in ("pipeline-args", "research") for p in sorted((mem / d).glob("*.json"))]
with open("02-ledger.tsv", "w") as fh:
    fh.write("id\tfile\ttier\tdisposition\n")
    fh.writelines("\t".join(o) + "\n" for o in out)
c = collections.Counter(o[3] for o in out)
print(f"in {len(out)} = " + " + ".join(f"{k} {v}" for k, v in sorted(c.items()))
      + f" = {sum(c.values())}")
