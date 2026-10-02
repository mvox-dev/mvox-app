# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-31 checkpoint 2026-10-02 05:47Z, Run 500 done]

**State:** main cc27564, tree clean. Mihkel (2026-10-01): refactoring rounds before features. No source file over 500; 400 register = 6 files (memberLifecycle.ts 471 largest).

**Landed since the last checkpoint:** consolidation-700 w1 e6c88f7 (#625-#630), w2 7ce9511 (#623 #624 #631-#633) · attribution-only rule 5abaea8 · Run 500 b1 a6bfd5e (#634 #635 #649 #652), b2 56bab05 (#641 #646 #648), b3 97aa11b (#636 #656 #651 #644), b4 74d2c96 (#639 #643 #650 + writeReach.ts fence), b5 965b82f (#642 #647 #654 #653), b6 cc27564 (#645 #638 #640 #637). Closed no-change: #655, D2.

**In flight:** nothing building. Consolidation-500 (~/workspace/scratchpad/consolidation-500.md: 9 IDENTICAL, D1-D5) SENT to Gama 2026-10-02 05:53Z. Gama filed the merges as #667-#677 (no `ready` yet). Waiting: `ready` labels, D-rulings, the 400 step (6 files) → research-pack → branches. Mihkel called the day 09:02Z.

**Rules this session:** commits/PR bodies carry ONLY (*MVOX:Name*) (no Co-authored-by/email/session link; Mihkel). Gates: FOREGROUND, `ulimit -c 0` (vitest core dumps), split by path, ALL 510 spec files incl. scripts/. write-gate fence now follows imports (writeReach.ts); untraceable forms fail a guard.

**Queue after refactor:** #611 (brief-611.md) → #615 pen → #616 → #617/#618/#619. #580's D3 prompt text with Mihkel. Mihkel live checks: #612 capture pixels/scroll, datalist Enter.

**Nits for next touch:** EventConvertForm.svelte:294 indent; linkedIdentities.ts:40 stale path comment. josquin.md over 100 lines: next Josquin prunes it.

**Team at seam:** perotin up; finn on consolidation-500; spawn josquin/bentham per branch.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-31 checkpoint 2026-10-01 17:48Z, idle seam]

**State:** main d716a6f, tree clean, no branch open. Mihkel (16:30Z): refactoring before new features.

**Landed this session (MVOX-31):** #574 a51986d · #568+#556 116bbca · #559 0c566b6 · #558 c3f2892 · #557 3e569b2 · #561 923d677 · #560 29be807 · consolidation-1000 waves A-F (#594/#597/#598 3b47c18, #581/#605 90b890f, #586/#588/#587/#583 61c24d3, #596/#589/#591 954d6cd, #585/#584/#580/#592 e28c5fa, #590/#593/#595 8aa80f2) · #612 ec250e9 (double-tap capture editor, modern-screenshot) · Run 700 #599/#600/#601 d716a6f. Closed no-change: #582, #602, #603.

**Waiting:** (1) Gama files issues from consolidation-700 (~/workspace/scratchpad/consolidation-700.md: 9 IDENTICAL, D1-D4 questions sent). (2) Mihkel: does the whole 500 step (22 register files) come before #611 + #615-#619? (3) #580's shared prompt waits on D3 (Mihkel). (4) Mihkel live checks: #612 capture (hatching in pixels, scrolled page), Chrome datalist Enter on create forms (#560).

**Queue after refactor:** #611 (send + offline queue; brief ~/workspace/scratchpad/brief-611.md, rulings in body; live check = read of a member's own send, no auth) → #615 pen → #616 → #617/#618/#619.

**How this session worked:** research-pack per batch → brief-<N>.md → fresh Josquin per branch → Bentham review → /mvox-merge. Briefs/digests in ~/workspace/scratchpad/ (brief-common-1000.md = shared rules). Gates FOREGROUND, split suite by path (>600s). Comment rules force trims on every touched file. Findings log: ~/workspace/scratchpad/findings-mvox-29.md.

**Team at seam:** bentham, perotin up; respawn finn/josquin on demand. Held probe moved to ~/workspace/scratchpad/held/ (Gama told).

(*MVOX:Palestrina*)

---
