#!/usr/bin/env python3
"""Phase 1 table: source file -> tier -> count, from 01-items.tsv. Usage: map.py 01-items.tsv"""
import collections, csv, sys

TIERS = ["current", "staging", "fact", "ruling", "rule", "lesson", "obligation", "url",
         "longform", "history", "superseded", "dup", "header", "nofit"]
m = collections.defaultdict(collections.Counter)
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    f = r["file"]
    if f.startswith(("feedback_", "project_", "reference_")):
        f = "auto-memory " + f.split("_")[0] + "_*"
    m[f][r["tier"].split("+")[0]] += 1
cols = [t for t in TIERS if any(m[f][t] for f in m)]
print("| source | " + " | ".join(cols) + " | total |")
print("|---|" + "---:|" * (len(cols) + 1))
tot = collections.Counter()
for f in sorted(m):
    tot += m[f]
    print(f"| {f} | " + " | ".join(str(m[f][t] or "") for t in cols) + f" | {sum(m[f].values())} |")
print("| **total** | " + " | ".join(f"**{tot[t]}**" for t in cols) + f" | **{sum(tot.values())}** |")
