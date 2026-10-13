#!/usr/bin/env python3
"""Final state of every unit after the rulings so far: 03-state.tsv + arithmetic.
Inputs in this directory: 02-ledger.tsv (Phase 2 dispositions), 02-conv.tsv (converter
ledgers), 02-screen.tsv (Phase 3 screen, accepted as is at batch 1), 04-rule-candidates.tsv
(GATE 2 destinations of rule-class items).
Usage: settle.py"""
import collections, csv, re

DESIGN_NOTES = "teams/mvox-dev/docs/design-notes/"
DEAD_1A = {"project_cf_pages_wrangler_vars#1", "project_cf_workers_process_env#1",
           "project_wrangler_deploy_auth#1", "project_pnpm_not_on_path#1",
           "project_polyphony_no_domain_sharing#1", "team-lead-archive#18",
           "team-lead-archive#92", "finn#10", "finn#12", "feedback_ultracode_team_roles#1"}
DEAD_2 = {"byrd#113"}
MEMKIT = {"team-lead#1": "team-lead.yaml:header", "team-lead#2": "team-lead.yaml:current",
          "task-list-snapshot#1": "team-lead.yaml:current"}
MOVES = {"architecture-decisions.md": "teams/mvox-dev/docs/architecture-decisions.md",
         "i18n-conventions.md": "teams/mvox-dev/docs/i18n-conventions.md"}

rd = lambda f: list(csv.DictReader(open(f), delimiter="\t"))
CANDS = rd("04-rule-candidates.tsv")


def rule_outcome(i):
    """GATE 2 outcome of a rule-class item: the destinations of the norms citing it."""
    pat = re.compile(r"(^|[ ,(])" + re.escape(i) + r"($|[ ,)])")
    dests = sorted({c["destination"] for c in CANDS if pat.search(c["sources"])})
    assert dests, f"{i}: no rule candidate cites it"
    return "; ".join(dests)
conv = {}
for r in rd("02-conv.tsv"):
    conv[r["src_id"]] = r["target"]          # K1 rows come last and win
screen = {r["id"]: r for r in rd("02-screen.tsv")}
out = []
for r in rd("02-ledger.tsv"):
    i, d = r["id"], r["disposition"]
    if d == "move":
        st, where = "moved", MOVES[r["file"]]
    elif d == "dead":
        st, where = "dead", "GATE 1"
    elif d == "phase4":
        st, where = "rule", rule_outcome(i)
    elif i in MEMKIT:
        st, where = "converted", MEMKIT[i]
    elif i in DEAD_1A:
        st, where = "dead", "batch 1A"
    elif i in DEAD_2:
        st, where = "dead", "batch 2"
    elif i in screen:
        rec = screen[i]["recommendation"]
        if rec == "dead":
            st, where = "dead", "batch 1B"
        elif rec == "keep:rule":
            st, where = "rule", rule_outcome(i)
        elif rec == "keep:longform":
            st, where = "moved", DESIGN_NOTES
        else:
            t = conv.get(i, "judgment")
            st, where = ("judgment", "batch 2") if t == "judgment" else ("converted", t)
    else:
        t = conv.get(i, "judgment")
        st, where = ("judgment", "batch 2") if t == "judgment" else ("converted", t)
    out.append((i, r["file"], r["tier"], st, where))
with open("03-state.tsv", "w") as fh:
    fh.write("id\tfile\ttier\tstate\twhere\n")
    fh.writelines("\t".join(o) + "\n" for o in out)
c = collections.Counter(o[3] for o in out)
print(f"in {len(out)} = " + " + ".join(f"{k} {v}" for k, v in sorted(c.items()))
      + f" = {sum(c.values())}")
