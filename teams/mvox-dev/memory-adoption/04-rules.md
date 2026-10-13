# 04 — Standing rules (Phase 4). GATE 2.

Sources (brief §4): ~/.claude/CLAUDE.md, ~/workspace/CLAUDE.md, common-prompt.md, startup.md,
prompts/*.md, the 45 memory items classed `rule`, and the converted rulings. (~/workspace-app
has no CLAUDE.md.) Every norm found is one row of `04-rule-candidates.tsv` — 266 rows after
merging duplicates, each with its sources, scope, kind and proposed destination.

## Proposed `memory/rules.yaml` (20 rows; kit lint --gate passes)

Read on every spawn by every member, after the kit's own 8 shipped rules
(`memory-kit/memory/rules.yaml`: 3 mandatory, 5 optional). 13 rows for
everyone, 7 for the lead (prefixed "Lead:").

```yaml
rules:
  # -- everyone
  - rule: "Report to team-lead by SendMessage when a task ends; never go idle unreported."
    ref: teams/mvox-dev/common-prompt.md
  - rule: "Run gates in the foreground. Commit and push before you report."
    ref: mihkel:2026-09-30
  - rule: "Check the branch in the same call before any edit, commit or push; wrong branch: stop."
    ref: teams/mvox-dev/common-prompt.md
  - rule: "One feature branch at a time across the team. Every merge goes through a PR."
    ref: teams/mvox-dev/common-prompt.md
  - rule: "End commits and PR bodies with only (*MVOX:<Name>*): no co-author, email or link."
    ref: mihkel:2026-10-01
  - rule: "Tests check what the user gets: not CSS classes, source text or call order."
    ref: mihkel:2026-10-05
  - rule: "Fail loudly. A fallback needs the PO's yes."
    ref: mihkel:2026-06-12
  - rule: "Call Entu only through src/lib/entu/; read the JWT only in src/lib/auth/storage.ts."
    ref: teams/mvox-dev/prompts/bentham.md
  - rule: "New entity types, shapes or rights need a PO ruling on the issue + a PO-Approved: trailer."
    ref: mihkel:2026-09-06
  - rule: "polyphony db is frozen history. Every live crede op needs its own authorization."
    ref: mihkel:2026-09-18
  - rule: "Live writes run only on team-lead's 'I authorize this run'; dry-run or review GREEN is not it."
    ref: teams/mvox-dev/prompts/perotin.md
  - rule: "Tag claims not checked this turn: [unverified] if checkable, [speculative] if inferred."
    ref: ""   # user-level CLAUDE.md, outside any repo
  - rule: "Plain words, no coined terms. Teammate replies <= 5 lines, reports to Mihkel <= 10."
    ref: mihkel:2026-09-09
  # -- team-lead
  - rule: "Lead: never edit code, run builds or tests, or commit code. Delegate."
    ref: teams/mvox-dev/prompts/palestrina.md
  - rule: "Lead: pick up only issues labelled ready; product questions go to gama@po-team first."
    ref: mihkel:2026-08-22
  - rule: "Lead: one-line notice to gama@po-team at slice entry and at every merge."
    ref: mihkel:2026-09-11
  - rule: "Lead: squash body carries Closes #N for every issue the work satisfies."
    ref: teams/mvox-dev/common-prompt.md
  - rule: "Lead: set the model explicitly on every spawn; never inherit by omission."
    ref: mihkel:2026-09-06
  - rule: "Lead: fresh implementer per issue from scratchpad/brief-<N>.md; release it after merge."
    ref: mihkel:2026-09-30
  - rule: "Lead: no commits in workspace-app while a pipeline runs on the shared tree."
    ref: mihkel:2026-09-12
```

One blank ref (row 12): the labelling rule lives only in the user-level CLAUDE.md, outside
any repo, so it has no address the grammar accepts.

## Where the other 246 norms go

| destination | rows | why |
|---|---:|---|
| stays in `prompts/<role>.md` | 89 | role-scoped; that role already reads its prompt on spawn |
| stays in common-prompt.md / palestrina.md | 102 | all/lead norms over the cap; read on spawn already |
| stays in its procedure doc (startup.md, skills, common-prompt procedures) | 24 | step lists, not norms |
| lesson | 20 | fires on a situation, needs its why — converted after this gate |
| stays enforced by its test/CI | 7 | a fence already holds it |
| merged into the 20 rows | 24 | duplicates across sources |

Nothing is demoted to `facts`: the rulings already live there (`facts/rulings-*.yaml`).

## What changes in the instruction files at cutover

1. **Duplicates of the 20 rows are cut** and replaced by one pointer line ("Standing rules:
   teams/mvox-dev/memory/rules.yaml"): common-prompt.md L8, L35, L73, L130, L175, L180,
   L192, L232-233, L255-261; prompts/bentham.md L25, L32, L99; prompts/josquin.md L40;
   prompts/byrd.md L39; prompts/perotin.md L44, L122, L133; prompts/palestrina.md L15, L41-50;
   ~/workspace/CLAUDE.md L31, L33, L34. ~/.claude/CLAUDE.md (rows 12, 13, 18) is the lead's
   to edit; I propose leaving it as is (the harness loads it for every agent anyway).
2. **Stale or conflicting statements found while extracting** — fixed to match the rulings:
   - TDD chain "Tallis RED → Byrd + Josquin GREEN → Comenius → Bentham → Josquin merge"
     (~/workspace/CLAUDE.md L32, common-prompt.md L128-140, palestrina.md L52-61): practice
     since 2026-09-30 is one fresh Josquin per issue doing RED and GREEN, Bentham alone reviews.
   - prompts/perotin.md L134 allows direct-to-main; branch protection and row 4 say PR only.
   - prompts/josquin.md L44-55, palestrina.md L74-76, perotin.md L137: the retired
     upstream schema flow (`Schema-Change:` trailer).
   - prompts/perotin.md L135, L142 "permanent always-on"; startup.md L111-117 waits for
     intros before spawning implementers — both predate fresh-instance spawning.
   - common-prompt.md L93, L137, L209 and prompts/tallis.md L53 still name server dirs.
   - facts/rulings-process.yaml: "probe on polyphony with _probe_ names" (2026-05-19) vs
     "polyphony is frozen" (2026-09-18). Proposed: drop the older row (refuted by the newer).
3. Nothing else in the instruction files is deleted.

## GATE 2 — ruling

2026-10-14, Palestrina (delegated by Mihkel 2026-10-14):

- The 20 rows approved as proposed. Row 12 keeps its blank ref (a finding for 06).
- ~/.claude/CLAUDE.md stays as is.
- ~/workspace/CLAUDE.md is the schema repo: its edit is its own PR there, after the app PR merges.
- Cutover items 1 and 2 approved, including dropping the older polyphony-probe row (done as
  the kit's genus lesson asks: the row is replaced by one dated line naming what ended it).

## After the gate

The 20 situational norms became lessons (17 new files; ledger `04-conv-R.tsv`). Three came
back as questions: n=236 (probe on polyphony) died with the row above; n=100 (#289 inventory
gate, #289 closed) and n=177 (`git add -N` before gates, now that changedFiles reads
untracked files, #568) wait in 02-needs-judgment.md batch 3.

(*MVOX:memkit*)
