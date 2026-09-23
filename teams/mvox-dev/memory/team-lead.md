# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-28 seam 2026-09-23 22:5xZ]

**Board empty; nothing in flight.** #470 CLOSED 5fdc5dc (PR #484, merged 2026-09-23T22:43:20Z): hand fix round after the pipeline's RED — Josquin 31b57b9 (selectedIds/renderIds split) → Bentham RED-470.1 (keyed {#each} on member section ids throws on a duplicate; Entu POST appends, two admins/two tabs) → Josquin 0dadd77 (distinct at listActiveMembers + patchMemberSectionIds, mapper pin RED-first) → 09f0cfe main merged in → Bentham GREEN round 4. Labels cleared 22:4xZ; landing sent to Gama.

**Open unlabelled:** #483 (Gama filed from Finn's read: season conductors panel, same dup-key shape at seasonManage.ts:269 / entuSeasons.ts:110,207 / roster +page.svelte:7265 — fix = distinct at the loader, #470 pattern); #477 (nine user-feedback points on the agenda page, Gama's to cut); #422, #434 still parked. Wait for `ready`.

**Team at seam:** finn, bentham, perotin, josquin — all respawn on wake. Tree on main; untracked to leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts (Gama holds that question). Pérotin's probe-470 script + ledger committed in this seam PR (polyphony: 2 members, 0 sections, 0 duplicates — not a roster).

**Rules this session:** a teammate returns the shared tree to main only after the reviewer reports, not after its own push (Bentham's gate run flipped mid-suite 22:29Z; he caught it by capturing HEAD before/after in one command). Pipeline agents hold no Entu JWT (.env = PUBLIC_ENTU_API_BASE only) — "verified live on the page" in a pipeline review means fixtures, never a real db.

**Live-pass residuals for Mihkel:** #468 — see the section picker as an ordinary member on cards she owns; #470 — the new one-per-membership pickers on a real roster; #408 device checks.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-27 closed at a seam 2026-09-23 21:3xZ on Mihkel's word ("at next seam, lets restart")]

**FIRST: finish #470.** Pipeline halted at review RED after fix cap; branch `feat/470-native-section-pickers` is PUSHED @ 44b61f3 (4 commits, gates green, 6193 tests), tree back on main. One blocker, fix shape known — read the last #470 entry in ~/workspace/scratchpad/findings-mvox-27.md (split SectionPicker's `selectedIds` into full-held-set for exclusion + `renderIds` for the per-card {#each}; two specs on the m-multi fixture). Pattern: spawn Josquin, fix round on the branch → Bentham verdict → Josquin PR via /mvox-merge with `Closes #470`. Issue #470 is `ready,in process`. Not a re-run of the pipeline (cache is prompt-keyed; the branch is the state).

**Landed 2026-09-23 (seven):** #463 e26d989 · #466 e73406b · #467 c5a5024 · #471 57d7de4 · #474 74f91dc · #468 68de3ac · #469 a8422b0; seam PRs #465, #479, #481, and this one. Team at exit: finn, bentham, perotin, josquin — all respawn on wake. Untracked on tree, leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts.

**Rules this session (all in memory):** research and dev run in parallel, never hold a prepped issue to pack it; /mvox-merge = one command per Bash call; a mid-turn operator question derails running workflow agents (relaunch with a nonce); research-pack labels agent split "468" into 4/6/8 → template fix pending (pass `#N` tokens); pipelines halting at YELLOW/RED after fix cap → hand fix round, scope widenings ruled explicitly in the findings log.

**Live-pass residuals for Mihkel:** #468 — see the section picker as an ordinary member on cards she owns; #408 device checks. Open unlabelled: #422, #434. #361's surface list grows after #469.

(*MVOX:Palestrina*)

---
