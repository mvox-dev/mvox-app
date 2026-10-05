# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-33 checkpoint 2026-10-05 22:05Z]

**State:** main fe45b42 (after this seam PR: one more chore commit), tree clean apart from memory files, no branch open. The #706 test-review queue is DONE: #708-#718 and #723 all closed. Repo test:source 3.34:1 (from 3.9:1 on 10-01).

**Landed 10-03→10-05:** #711 (b2-b10 + follow-ups, PRs #774-#783); #715 (#785, #786); #717 (#787); #718 (#789); #712 (#791, follow-up #793); #713 (#792); #714 (#794); #713 flake fix (#799); #716 (#797, #798, #801); #723 (#804, #805, follow-up #806); seam PRs #784, #802.

**Next:** features per the board, in the order #611 → #684 → #617/#618/#619 → #615 → #616 (verify the `ready` labels and Gama's order first). #756 is not ready.

**Filed by Gama this wave, unreleased (wait on Mihkel's word):** #795 (links/roster writes send a stale token after it's cleared), #796 (series picker: status region mounts late; saved cue survives a switch), #800 (library page left mid-load overwrites librarianStore; its fix needs a test written first that leaves /library mid-load, re-mounts and settles late, and must NOT copy #799's afterEach drain), #803 (8 unused locale keys go). Not yet filed: #717 finding, 17 roster generation guards fail no test on main (scratchpad/717/res).

**New standing rule (Mihkel 10-05, in common-prompt):** 4-point gate for every test PR (behaviour, not classes/source/calls; once over a source-derived page list; named break tried; test:source ratio stated).

**Lessons this wave:** grep closing keywords case-insensitively, in both the squash body and the PR description (mvox-merge skill updated). Release = shutdown_request, never a text message. Mutation runs: check the branch first and restore before reporting (a stray mutation sat on main). Never pkill shared processes. A mock dropped while its handle is still asserted makes a never-failing test (#805 → #806). Never prove a negative after a fixed wait (#792).

**Team at seam:** none up. Spawn fresh josquin/bentham/finn per task.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-32 checkpoint 2026-10-03, restart seam]

**State (2026-10-03 20:27Z, restart seam — Mihkel asked for fresh context):** main 6bb3246, tree clean apart from memory files. #711 in process: b1 merged (PR #772); next b2 admin+profile (32), then event 33, roster 35, season panel 21, agenda 21+21; plan in ~/workspace/scratchpad/711-inventory.md, scripts in scratchpad/711/. Spawn a fresh Josquin for b2 (point at the inventory + findings-mvox-29.md tail for rules) and a fresh Bentham (bentham.md has the traps). Then #712-#718 (research after #711), #723, then features #611 → #684 → #617, #618, #619, #615 → #616. #756 (swallowed reads) not ready yet; finds go to Gama for its body.

**Landed 10-03:** #708 (PRs #724-#733), #710 (#734-#739), #709 (#740-#771, closed e58ed92), #704, #711 b1.

**Batch rules (shared setup):** ≤40 files; mutation proof + 2 shuffled seeds; only last batch says Closes (GitHub acts on "Closes #N" anywhere in a PR body); author lines kept; comment rules on touched files.

**Rules learned today:** labels per transition are steps in mvox-pickup/mvox-merge skills. research-pack markers: no regex metachars. Teammate subagent hand-backs land in team-lead: have them write files. Line report = po-team's tool, ask Gama.

**Nits:** soleCreatePath guard now a subset of rightsWrites (retire at next touch); t4-10-plan.ts:435 stale comment; resolveAdmin/resolveLibrarian auth-expired → load-error (pre-existing).

**Team at seam:** perotin up. Spawn fresh josquin/bentham/finn per task.

(*MVOX:Palestrina*)

---
