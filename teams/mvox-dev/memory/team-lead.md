# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-36 checkpoint 2026-10-07 05:39Z]

**State:** main 069e536 (plus this seam commit), no branch open, no teammates up. The released queue is done.

**Landed since MVOX-35:** #615 (#844, pen test #845), #616 (#845). #825 CLOSED 10-07 (Mihkel's iOS Safari + Brave checks, relayed by Henry).

**Next:** no `ready` issue except #826. Check the board and Gama's mail for a new release.

**Waiting on Mihkel:** #826 live checks (/lab/entu sign-in returns signed in; passkey link opens Entu add-passkey). #832 (deploy/SW: missing /_app/immutable/* answers cacheable 200 HTML) filed, NOT released. **Waiting on Gama:** "unknown member" issue for a raw member id in /admin role rows.

**Loose ends:** untracked scripts/migrations/seed-results/probe-701-rights-sweep-crede-live-2026-10-02T18-19-14-618Z-committed.json in the app tree (from #701, not committed; check before deleting). josquin.md is 176 lines: duplicate #611 section cut; the next Josquin should trim it under 100.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-35 checkpoint 2026-10-06 20:15Z]

**State:** main 25dad04, no branch open. Bentham up (standing for the wave); no Josquin up.

**Landed 10-06 (after 10:35Z):** #684 (#828), #826 part (#829; open for Mihkel's live checks), #812 (#831), #819 (#833), #825 part (#834; open for iPhone + one other mobile browser), #488 (#835), #809 (#836 + #838), #618 (#839), #617 (#840), #619 (#842). #823 closed not planned (crede name formula set then removed by Mihkel; ledgers #824, #827; upstream ask entu/api#43).

**Next:** #615 → #616, research re-running (wf_971f398c-064); briefs brief-615.md / research-616-verify.md need refreshing from its digests. Queue file: ~/workspace/scratchpad/queue-2026-10-06.md.

**Waiting on Mihkel:** #832 (deploy/SW: missing /_app/immutable/* answers cacheable 200 HTML; Edge held it until reboot) filed, NOT released. Live checks #826, #825. **Waiting on Gama:** whether a raw member id in /admin role rows (roster failed, grant has no name) gets an "unknown member" issue.

**Rules learned this run:** Entu ids are globally unique (memory). During review the tree is the reviewer's: the implementer runs nothing; undo breaks with git checkout, never a saved copy (#618 overwrite). Briefs state the ratio method inline (src/ only, *.spec.ts + src/lib/testing as test, paraglide excluded). Count vitest "Errors" lines as failures. A PR's CI may not start: close/reopen it. Re-check an issue body's edit history before launch (#809 moved 4 times). Headless Chromium can't run here (missing libs).

(*MVOX:Palestrina*)

---
