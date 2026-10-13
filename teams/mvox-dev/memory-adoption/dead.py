#!/usr/bin/env python3
"""Write 03-ruled-dead.md from 03-state.tsv and 02-test-gaps-check.tsv. Run after settle.py."""
import collections, csv

rows = [r for r in csv.DictReader(open("03-state.tsv"), delimiter="\t") if r["state"] == "dead"]
g = collections.defaultdict(list)
for r in rows:
    f = "auto-memory" if r["file"].startswith(("feedback_", "project_", "reference_")) else r["file"]
    g[(r["where"], f)].append(r)
o = ["# 03 — Ruled dead (not deleted)\n",
     "Every unit the gates ruled dead. Nothing here is deleted before GATE 3; the sources sit in",
     "`teams/mvox-dev/memory/fallback/` (and the lead's auto-memory fallback) until then. Generated",
     "by `python3 settle.py && python3 dead.py`; the full text of any id regenerates with `split.py`.\n",
     f"Total: {len(rows)}.\n", "| ruled at | source | count | tiers |", "|---|---|---:|---|"]
for (w, f), rs in sorted(g.items()):
    t = collections.Counter(r["tier"] for r in rs)
    o.append(f"| {w} | {f} | {len(rs)} | " + ", ".join(f"{k} {v}" for k, v in sorted(t.items())) + " |")
o += ["", "## Test gaps still holding (batch 1C: dead, no issues; e2e is a product decision)\n",
      "| gap | evidence |", "|---|---|"]
for line in open("02-test-gaps-check.tsv"):
    a = line.rstrip("\n").split("\t")
    if a[1] == "holds":
        o.append(f"| {a[0]} | {a[2]} |")
o += ["", "## Ids by source\n"]
for (w, f), rs in sorted(g.items()):
    o.append(f"- **{w} / {f}**: " + ", ".join(r["id"] for r in rs))
o += ["", "(*MVOX:memkit*)"]
open("03-ruled-dead.md", "w").write("\n".join(o) + "\n")
print(f"{len(rows)} dead")
