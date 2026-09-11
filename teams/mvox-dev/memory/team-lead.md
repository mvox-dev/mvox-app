# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-21 WIND-DOWN 2026-09-12 ~01:10 EEST, planned at the #328 seam (Mihkel 23:52)]

**MVOX-21 TALLY (12h session): 7 merged** — #329 25d72cd (YELLOW-cap recovery: fix c0700bd + Bentham GREEN + Gama sanction 5635111998) · #323 ca0da98 · #324 c9a3954 (honest-stall recovery) · #325 5dafcaf · #326 a42a15c · #327 a9e420d · #328 ba16454. **Epic #289: ALL SIX sub-issues closed, mirror cleared — closure reported to Gama, their call.** Also: #330 prepped (amended 3-edit spec; args-330.json committed) · #331 researched v2 (research-331-v2.json; v1 killed on Gama's catch) · #331/#332 follow-ons filed by PO.

**FIRST ACTIONS NEXT SESSION:** (1) /mvox-wake; re-arm landing monitor. (2) Author args-318 (re-verify infra at slot; pin-set item DEAD — #322 took it; ER-1/ER-7 unpinned = separate work, NOT #318's per Gama) + args-331 (fresh re-reads MANDATORY — #324 touched refreshWorksAfterWrite, #326/#327/#328 reshaped the cue family + locale files; bake: per-WorkRow flag design fork, wrapper split, page-level-only acceptance per Gama 5635682393, three reset sites, leave :135 alone). (3) Launch packed [330, 318, 331] (Gama-ruled order, unconditional). (4) #319 HELD (Mihkel-pending amendment: po-team three-gates + tripwire). #316 closes on #318+#319 → lifts #233's gate (Mihkel at-the-time auth). #332 shaped, not ready.

**STANDING NEW THIS SESSION (all durable):** workflow cache is PREFIX-based (memory + template comment; amend-and-resume unusable in argsFile mode — remainder-file + fresh launch); argsFile mode live (template LOAD phase; launch = scriptPath + args:{argsFile}, jq-verify, no full Reads — memory updated); board-label.sh (teams/mvox-dev/scripts/) for EVERY label transition incl. auto epic mirror; findings-on-the-issue law (Gama; memory extended); pin-the-version-not-the-marker (pickup skill); manual-mode-on-classifier-block (memory); mvox-exit ancestry-walk fix APPLIED (+durable copies; record-before-send rule); ~/.tmux.conf mouse-on deliberate; up-vs-resident attach-first patch = Mihkel's hand (root/image); Gmail/Calendar/Drive connector disconnect + superpowers removal = Mihkel considering (~40k standing context). Own-node-per-surface + late-settle-guard-statement rulings live on issues 326/327/328 (pointer-comment relay pattern works — REDs read their threads live).

(*MVOX:Palestrina*)

---
### [PREV — MVOX-21 session log through the day]

**Session 407ee56a, wake 13:04. Teammates: finn/bentham/perotin up. Landing-notice monitor b4etmzn0o armed (dies with session — re-arm on wake).**

**#329 MERGED 25d72cd** (recovery chain: pipeline YELLOW-cap r3 → fix c0700bd → Bentham GREEN revert-replay → Gama sanction #329 comment 5635111998; bound-statement a3c6ab4; full trail on the issue + git). #322 landed before wake (db03a38). Session tally: 1 merged + #330 prepped.

**QUEUE:**
1. **REMAINDER PACK [324, 325, 326, 327, 328] RUNNING as wf_0a1ab32f-478** from args-pack-324-328.json. #323 MERGED ca0da98 (closed, cleared, noticed). History: #324 GREEN stalled honestly 18:43 (impl written, suite run stalled — impl UNCOMMITTED in tree, RED at 5e11b30); first recovery attempt (LOAD cache-bust + resume) FAILED at 18:46 — **PREFIX-CACHE LESSON, now in the template comment: resume replays the longest unchanged prefix; LOAD is call #1, busting it re-dispatches EVERYTHING live (a stale RED-323 ran against merged main — refused correctly, zero damage, dirty impl preserved); not busting it serves the OLD file from cache. Amend-and-resume is UNUSABLE in argsFile mode — recovery = remainder args file + FRESH launch.** #324 MERGED c9a3954 (recovery closed clean, Gama verified). #325 in flight. **CUE-NODE RULING (Gama 19:50, #328 comment 5637755878): shared SHAPE, own NODE per surface — one live region serving several queues announces settles the user didn't cause. Applies to #326/#327/#328. Closed without touching the running pack: RED agents read their issues live, so pointer comments posted on #326 (5637764114) + #327 (5637764322); #328's agents see the original directly.** Gama confirms: args-331's post-pack fresh re-reads are REQUIRED (#324 touched refreshWorksAfterWrite). **LATE-SETTLE GUARD ASK (Gama, epic comment 5639445492): three guard idioms exist (#325 generation thread / #326-event isCurrentWrite / #326-agenda documented no-guard on id uniqueness) — #327/#328 must STATE which they follow, not invent a fourth; pointer comments posted (327: 5639456095, 328: 5639456298).** Landed so far this pack: #323 ca0da98 · #324 c9a3954 · #325 5dafcaf · #326 a42a15c. If pack dead on wake: check per-branch state, relaunch remainder from a newly derived args file (prefix-cache rule).
2. **Packed [330, 318]** (Gama-ruled order). args-330.json committed (amended 3-edit spec, comment 5633793421; pin ruling: re-pin only edited blocks from post-edit bytes, coverage never moves to #318). #318: RE-VERIFY infra at its slot, then author args — Bentham's old pin-set item is DEAD (#322 took it); ER-1/ER-7 remain unpinned = separate work, NOT #318's.
3. **#331 IN RESEARCH — V2 CONTRACT (AMENDED 16:56, caught by Gama: my 16:56 read was v1, 35s pre-amendment; v1 run killed, wf_2a11c2fd-a9f relaunched against v2).** v2 INVERTS v1: the defect is one link earlier — #329's reader unknown branch EXISTS but is gated off (rowEditionUnknown opens `if (!partial) return false`; partial reaches a rights-less reader as false on both pages: worksManage undefined / libraryEditionsPartial editor-only). **v2 RESEARCH LANDED CLEAN (research-331-v2.json committed-pending)** — chain verified; key for args-331 (author POST-pack, fresh re-reads): per-WorkRow optional truncated field (NOT top-level wrapper — saves ~30 spec mocks); RepertoireElement's rowEditionUnknown wrapper must SPLIT into two differently-fed call sites (editor byte-identical fence); ZERO existing reader-under-truncation tests (both suites grant _editor — coverage from scratch, both pages); three worksByEventId reset sites need the new flag reset (collective-switch leak); #324 collision CONFIRMED (same refreshWorks()); workRows.ts comment corrected in-slice. Fences: repertoire_edition_unknown wording unchanged, editor behaviour byte-identical, no new reads. Queue [330, 318, 331] UNCONDITIONAL (Gama 17:01, discharged on this landing). Exact-banner guard rule in pickup skill (pin the version, never marker presence — Gama's fix). #332 shaped, not ready.

**BOARD LABELS NOW PROCEDURAL (Mihkel's idea 17:0x):** teams/mvox-dev/scripts/board-label.sh <N> research|prepped|enter|land — encodes contract v2 + automatic epic-mirror recompute via native sub-issue parent lookup (GraphQL, verified #323→#289). First live run = #331→research. Use it for EVERY transition from now; never hand-roll gh label calls. Uncommitted till next gap.
4. **#319 HELD out of any pack** (Gama: body gets a Mihkel-pending spec amendment — po-team three-gates scope field + tripwire rider; build only after the edit lands). #316 closes on #318+#319 → lifts #233's schema gate (#233 = Mihkel at-the-time auth).

**WIND-DOWN RULED (Mihkel 23:52): session ends at the #328 seam.** Sequence when #328 lands: landing routine (notice, land label, epic #289 close-check → report to Gama, their close call) → seam commit of ALL dirty files (team-lead.md, board-label.sh, research-331-v2.json, args-pack-324-328.json, canonical template w/ argsFile+resume-trap, pickup-skill... skill is outside repo — its durable copy question: N/A, skills live in ~/.claude only except mvox-exit's resident/ copies) → refresh checkpoint + task-list-snapshot (next session: author args-318 + args-331 w/ fresh re-reads, launch [330, 318, 331]; #319 held; #233 gated; #332 not ready) → break notice to Gama → /mvox-exit (fresh-next, checkpoint path; FIRST LIVE USE of the fixed ancestry-walk self-exit — record outcome BEFORE sending).

**SEAM WORK (Mihkel 16:39):** (2) this trim — DONE; (5) template argsFile mode — first agent loads the args file, team-lead launches with args:{argsFile} + jq-verifies, never full-Reads args; (6) drop ritual template Read, md5-verify instead + amend project_workflow_scriptpath_scratchpad memory. Mihkel separately considering: disconnect Gmail/Calendar/Drive connectors (~38k standing), superpowers plugin removal.

**STANDING (this session's additions, all durable-memory'd or ruled):**
- Gama law (16:24): merge-gating findings go ON THE ISSUE, mail is only the prompt (memory extended; proven by po-team's restart eating three mails 14:43–16:17 — consolidated-resend recovered it).
- Manual mode on classifier block (Mihkel 13:18, durable memory).
- mvox-exit pane discovery FIXED + applied (ancestry-walk; durable copies in resident/; record learnings BEFORE sending the exit — the send kills the turn).
- up-vs-resident gap: bare `up` refuses under residency (guard sees claude w/o session `mvox`); attach-first patch given to Mihkel (root-owned, image-baked); Passepartout warned both teams.
- ~/.tmux.conf `mouse on` is DELIBERATE (Mihkel via Passepartout) — do not revert.
- Schema-of-record home is SETTLED (#263): mvox-schema-extensions.ts + .md; stale "pending" pointers fixed (workspace CLAUDE.md 015218f + common-prompt).
- Memory pruned 98→86 files, MEMORY.md 95→83 lines (13 dead/merged).
- po-team restart-cycle test done; their resident-loop replication recipe sent (recipe msg 9e60b185).

**Recovery patterns proven again this session:** merge-agent placeholder refusal = correct → re-direct with content source; premature-idle → continuation prompt with observed git state.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-20 BREAK 2026-09-11 ~12:3x EEST, planned at the #322 seam (Mihkel's request)]

**#322 LANDED before exit: db03a38, first-pass GREEN, closed, label cleared, notice sent.** Its args ADOPTED Bentham's pin-set close (ER-18..23 into UNTOUCHED_SHA256) — args-318 must NOT re-take it.

**MVOX-20 TALLY (19h session): 8 merged** — #315 e361173 · #313 d118cff · #317 d8651b9 · #256 9929de2 · #277 0732e85 · #320 6cbaf39 · #321 b178631 (7-commit recovery, Bentham RED→GREEN) · #322 db03a38. Plus: #289 inventory fe52c54 + SIX sub-issues cut #323-328 (all ready via Gama) · #329 filed+ready · #316 at 2/4 (doc = ER-1..ER-23 + two-layer guard fence).

**STANDING FROM MVOX-20:** epic-label-mirrors-tasks (durable memory; also: clear `in research` when research lands without immediate args). `disableArtifact: true` in ~/.claude/settings.json. Count semantics = probe-settled platform knowledge (ledgers committed; ER-doc candidate for future commission). Label contract v2 (in research → prepped → in process → cleared after landing). Resident loop armed; flags fresh-next/stay-down in ~/.claude/.

(*MVOX:Palestrina*)
