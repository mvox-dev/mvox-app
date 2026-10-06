# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-34 checkpoint 2026-10-06 08:00Z]

**State:** main f9c73a5 (plus this seam commit), no branch open, no teammates up. The released queue is done.

**Landed 10-06:** #611 code (PR #808; the issue stays OPEN for Done-when 6: Mihkel sends one feedback from the app, then Pérotin reads it back: owner = member, `_sharing: domain`; no authorization needed). #795 + #796 + #803 (#810). #800 (#811). #756 (#813-#816). #790 (#818, follow-up #820). Seams #807, #817.

**Next:** board order #684 → #617/#618/#619 → #615 → #616; briefs exist in ~/workspace/scratchpad (prepped). Re-read each body, add the 10-05 test-gate and contract notes to the brief, spawn a fresh Josquin plus Bentham.

**Waiting on Gama:** filing the record save-lock bug (recordSavingMemberId isn't reset on a collective switch; B's editor locked while A's save is in flight) and the domain-only name-check test pin (#811 finding).

**Rules learned this run:** epic labels are the PO's (script); label only issues you pick. Closing comments are encouraged; the merge skill posts one per closed issue. Rule out a fix that adds a regression even when Bentham says "mergeable" (#811 gate drop, #808 duplicate send). Move rules that lived only in cut comments to architecture-decisions.md. Teammates must not edit on main or commit during review; one final SHA. The ratio method is src/ only, matching Gama's line report (3.42:1 now).

**Team at seam:** none up.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-33 checkpoint 2026-10-05]

**State:** main fe45b42 (after this seam PR: one more chore commit), tree clean apart from memory files, no branch open. The #706 test-review queue is DONE: #708-#718 and #723 all closed. Repo test:source 3.34:1 (from 3.9:1 on 10-01).

**Landed 10-03→10-05:** #711 (b2-b10 + follow-ups, PRs #774-#783); #715 (#785, #786); #717 (#787); #718 (#789); #712 (#791, follow-up #793); #713 (#792); #714 (#794); #713 flake fix (#799); #716 (#797, #798, #801); #723 (#804, #805, follow-up #806); seam PRs #784, #802.

**Next:** features per the board, in the order #611 → #684 → #617/#618/#619 → #615 → #616 (verify the `ready` labels and Gama's order first). #756 is not ready.

**Filed by Gama this wave, unreleased (wait on Mihkel's word):** #795 (links/roster writes send a stale token after it's cleared), #796 (series picker: status region mounts late; saved cue survives a switch), #800 (library page left mid-load overwrites librarianStore; its fix needs a test written first that leaves /library mid-load, re-mounts and settles late, and must NOT copy #799's afterEach drain), #803 (8 unused locale keys go). Not yet filed: #717 finding, 17 roster generation guards fail no test on main (scratchpad/717/res).

**New standing rule (Mihkel 10-05, in common-prompt):** 4-point gate for every test PR (behaviour, not classes/source/calls; once over a source-derived page list; named break tried; test:source ratio stated).

**Lessons this wave:** grep closing keywords case-insensitively, in both the squash body and the PR description (mvox-merge skill updated). Release = shutdown_request, never a text message. Mutation runs: check the branch first and restore before reporting (a stray mutation sat on main). Never pkill shared processes. A mock dropped while its handle is still asserted makes a never-failing test (#805 → #806). Never prove a negative after a fixed wait (#792).

**Team at seam:** none up. Spawn fresh josquin/bentham/finn per task.

(*MVOX:Palestrina*)

---
