# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-35 checkpoint 2026-10-06 20:15Z]

**State:** main 25dad04, no branch open. Bentham up (standing for the wave); no Josquin up.

**Landed 10-06 (after 10:35Z):** #684 (#828), #826 part (#829; open for Mihkel's live checks), #812 (#831), #819 (#833), #825 part (#834; open for iPhone + one other mobile browser), #488 (#835), #809 (#836 + #838), #618 (#839), #617 (#840), #619 (#842). #823 closed not planned (crede name formula set then removed by Mihkel; ledgers #824, #827; upstream ask entu/api#43).

**Next:** #615 → #616, research re-running (wf_971f398c-064); briefs brief-615.md / research-616-verify.md need refreshing from its digests. Queue file: ~/workspace/scratchpad/queue-2026-10-06.md.

**Waiting on Mihkel:** #832 (deploy/SW: missing /_app/immutable/* answers cacheable 200 HTML; Edge held it until reboot) filed, NOT released. Live checks #826, #825. **Waiting on Gama:** whether a raw member id in /admin role rows (roster failed, grant has no name) gets an "unknown member" issue.

**Rules learned this run:** Entu ids are globally unique (memory). During review the tree is the reviewer's: the implementer runs nothing; undo breaks with git checkout, never a saved copy (#618 overwrite). Briefs state the ratio method inline (src/ only, *.spec.ts + src/lib/testing as test, paraglide excluded). Count vitest "Errors" lines as failures. A PR's CI may not start: close/reopen it. Re-check an issue body's edit history before launch (#809 moved 4 times). Headless Chromium can't run here (missing libs).

(*MVOX:Palestrina*)

---
### [PREV — MVOX-34 checkpoint 2026-10-06 08:00Z]

**State:** main f9c73a5 (plus this seam commit), no branch open, no teammates up. The released queue is done.

**Landed 10-06:** #611 CLOSED (PR #808 + live read-back passed 10:27Z: owner Mihkel, _sharing domain, metadata keys exact; 611-readback.md). #795 + #796 + #803 (#810). #800 (#811). #756 (#813-#816). #790 (#818, follow-up #820). Seams #807, #817.

**Next (Mihkel 10-06: context break, then launch remaining tasks):** board order #684 → #617/#618/#619 → #615 → #616; briefs exist in ~/workspace/scratchpad (prepped). Re-read each body, add the 10-05 test-gate and contract notes to the brief, spawn a fresh Josquin plus Bentham.

**Filed, unreleased (waits on Mihkel):** #819 record save-lock bug (recordSavingMemberId not reset on switch). **Waiting on Gama:** the domain-only name-check test pin (#811 finding).

**Rules learned this run:** epic labels are the PO's (script); label only issues you pick. Closing comments are encouraged; the merge skill posts one per closed issue. Rule out a fix that adds a regression even when Bentham says "mergeable" (#811 gate drop, #808 duplicate send). Move rules that lived only in cut comments to architecture-decisions.md. Teammates must not edit on main or commit during review; one final SHA. The ratio method is src/ only, matching Gama's line report (3.42:1 now).

**Team at seam:** none up.

(*MVOX:Palestrina*)

---
