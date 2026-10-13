#!/usr/bin/env python3
"""Phase 0 gauge: split each memory source into items and measure them against kit caps.

Item = one heading section (## and deeper) or one [TAG] entry in a team memory file;
one file in the harness auto-memory dir. Usage: gauge.py <team-memory-dir> <auto-memory-dir>
Prints a markdown table plus totals. Changes nothing.
"""
import pathlib, re, sys

TAG = re.compile(r"^\s*(?:[-*]\s+)?\**\[(DECISION|LEARNED|WARNING|WIP|DEFERRED|PATTERN|GOTCHA|CHECKPOINT)\b")
HEAD = re.compile(r"^#{2,6}\s")
SRC = re.compile(r"\b[0-9a-f]{7,40}\b|#\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|[\w.-]+/[\w./-]+\.\w+|Mihkel|ruling", re.I)
URL = re.compile(r"https?://")
FACT_WORDS, RECORD_CHARS = 42, 100


def items(text, whole):
    if whole:
        body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
        return [body]
    out, cur = [], []
    for line in text.splitlines():
        if (HEAD.match(line) or TAG.match(line)) and cur:
            out.append("\n".join(cur)); cur = []
        cur.append(line)
    if cur:
        out.append("\n".join(cur))
    return [i for i in out if len(i.split()) > 3]   # drop rules/separators/one-word stubs


def measure(path, whole):
    its = items(path.read_text(), whole)
    r = dict(file=path.name, items=len(its), words=sum(len(i.split()) for i in its))
    r["sourced"] = sum(1 for i in its if SRC.search(i))
    r["url"] = sum(1 for i in its if URL.search(i))
    r["fit_fact"] = sum(1 for i in its if len(i.split()) <= FACT_WORDS)
    r["fit_record"] = sum(1 for i in its if len(" ".join(i.split())) <= RECORD_CHARS)
    return r


def table(rows, title):
    cols = ["file", "items", "words", "sourced", "url", "fit_fact", "fit_record"]
    print(f"\n### {title}\n")
    print("| " + " | ".join(cols) + " |"); print("|" + "---|" * len(cols))
    tot = {c: 0 for c in cols[1:]}
    for r in rows:
        print("| " + " | ".join(str(r[c]) for c in cols) + " |")
        for c in tot: tot[c] += r[c]
    print("| **total** | " + " | ".join(str(tot[c]) for c in cols[1:]) + " |")
    return tot


def main():
    team = sorted(pathlib.Path(sys.argv[1]).glob("*.md"))
    auto = sorted(p for p in pathlib.Path(sys.argv[2]).glob("*.md") if p.name != "MEMORY.md")
    t1 = table([measure(p, False) for p in team], f"team memory ({len(team)} files)")
    groups = {}
    for p in auto:
        groups.setdefault(p.name.split("_")[0], []).append(measure(p, True))
    rows = [dict(file=f"{k}_* ({len(v)} files)", **{c: sum(r[c] for r in v) for c in
            ["items", "words", "sourced", "url", "fit_fact", "fit_record"]}) for k, v in sorted(groups.items())]
    t2 = table(rows, f"harness auto-memory ({len(auto)} files, item = file)")
    print(f"\nAll sources: {t1['items'] + t2['items']} items, {t1['words'] + t2['words']} words.")


if __name__ == "__main__":
    main()
