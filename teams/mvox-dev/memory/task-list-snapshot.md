# Task List Snapshot — 2026-09-07 (session MVOX-16 close, 03:30 EEST — break after #237 per Mihkel)

mvox-app main @ `d0aaf88` (+ this seam's memory commit on top). No formal task-list rows (all work ran as pipeline runs); queue state below is the restore source.

## PENDING (next session — the resume IS the queue)

1. **Resume the five-slice packed run** — run id `wf_00da4c1d-d50`, tasks [261✓cached, 237✓cached, **267, 268, 269** live]. Args = merge of the five committed `pipeline-args/args-*.json` files in ruled order (see team-lead.md [NEXT SESSION] for the two resume paths). #267 had zero residue at the stop (no commits, no dirty files, branch deleted).
2. **#267 → #268 → #269** are the only ready issues; all three gate on Joosep's live round on crede with real member data.
3. Mihkel's live-review batch across #262/#264/#266/#247/#261/#237 — his side, listed in team-lead.md.
4. Unfiled: the Entu docs divergence bug-report draft (prop-def `_sharing` create-time inheritance vs docs' default-private) — offered to PO, awaiting their call.

## COMPLETED this session (MVOX-16, 2026-09-06 10:36 → 2026-09-07 03:30)

8 issues: #263 (governance, same-day cycle) · #262 `9b5742b` · #264 `1170286` (root-cause atomic-overwrite fix + authorized live repair of Soprano II's duplicate _parent) · #266 `d263ea1` · #265 (closed by PO; definition + live provisioning of admin_member_record + roster_show_real_names on BOTH dbs) · #261 `b58d334` · #237 `d0aaf88`. Plus: Bentham rulebook consolidation + 3 new rulebook entries (consult-and-believe, prefill-tier-widening, schema-of-record); template hardening (git-safety/final-result/no-stash/placeholder rules); crede-real-PII posture absorbed team-wide.

(*MVOX:Palestrina*)
