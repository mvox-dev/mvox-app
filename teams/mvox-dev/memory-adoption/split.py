#!/usr/bin/env python3
"""Dump every source item (same split as gauge.py) as JSONL: id, file, words, text.
Usage: split.py <team-memory-dir> <auto-memory-dir> > items.jsonl"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from gauge import items  # noqa: E402  (gauge.py prints only under __main__)

team = sorted(pathlib.Path(sys.argv[1]).glob("*.md"))
auto = sorted(p for p in pathlib.Path(sys.argv[2]).glob("*.md") if p.name != "MEMORY.md")
for src, whole in [(p, False) for p in team] + [(p, True) for p in auto]:
    for n, it in enumerate(items(src.read_text(), whole), 1):
        print(json.dumps(dict(id=f"{src.stem}#{n}", file=src.name, words=len(it.split()), text=it)))
