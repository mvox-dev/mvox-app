# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-30 seam 2026-10-01 01:36Z, end of wave 3]

**Where things stand:** epic #524 (file-size ladder + consolidation). Step 1500 done (#525–#529); the consolidation run for 1500 filed #539–#562. Merged: W0 (#553 #555 #562), W1 (#540–#543), W2 (#544–#547 #549), #565 #566, W3 (#539 #548 #550–#552 #554). Briefs and research for all of it are in ~/workspace/scratchpad (brief-*.md, research-*.md, consolidation-1500.md); the findings log is findings-mvox-29.md.

**Next:** W4 = #560 (create-form keys; WAITING on Gama: Escape/Enter per control or on the wrapper) and #561 (agenda opens parts in the part viewer). Then W5 = #556 (step to 1000), then #557–#559 (the agenda page 1300, SeasonManagePanel, agendaLoad 1003). #568 (the comment/line-cap checks see untracked files) is filed but not `ready`. The tdd-slice-pipeline template fails the comment rules, so clean it before using the pipeline again.

**How the team runs now (in common-prompt + memory):** hand work. Fresh Josquin per issue or wave from a brief; Finn per research task; Bentham released at wave end; Pérotin only for live data; Comenius on demand for translations. Board labels: ready → in research → researched → prepped (brief on file) → in process. Rules: one folder per area, the size ladder, no loose text pins, the comment rules (+ top line, tiny files included).

**Team at seam:** nobody standing; spawn per task. Untracked to leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-30 seam 2026-09-29 15:19Z, Mihkel called the regroup]

**In flight: #508 (split the agenda page), epic #503's last child.** Slice 1/5 MERGED 95ae384 (PR #519, SeriesCreateForm). Slice 2/5 (EventCreateForm) ABORTED at its 2nd INTEGRATION pass per Mihkel's half-hour rule; branch feat/508-s2-event-create pushed at bd5391b (GREEN 4d632c4 + comment fix), no PR. Cost so far ~$123 by Passepartout's count; slice 1 took ~2h20m. Args: ~/workspace/scratchpad/args-508-pack.json (research: research-508-{verify,blast}.md). DO NOT relaunch the pack as is. Mihkel wants a cheaper plan for slices 3-5 (see the regroup report in the session). #508 needs a DETAILED CLOSING COMMENT after the last slice merges (Mihkel via Passepartout; not before, the pipeline pins 0 comments).

**Landed this session (MVOX-30):** #395 closed 44d700a (slice 2 f7e947d + crede provisioning, type-def `_parent` → db entity set by hand with Mihkel's clearance) · #504 8fbb4af · #506 40d6f56 · #507 c3d797a · #509 a59e67e · #505 closed with no change (CPU-bound, Mihkel accepted) · seed-results prune 775081f.

**Rules this session:** "When in doubt, leave comment out" (now in common-prompt). The #509 comment check applies to every touched file, specs too (Mihkel re-confirmed). skipRed tasks need a branch-setup RED prompt: the template only branches in RED. Findings log: ~/workspace/scratchpad/findings-mvox-29.md (template fixes pending: branch at GREEN when skipRed; GREEN-FIX suite-failure path; ensureEntityType writes no `_parent`).

**Team at seam:** finn, bentham, perotin, josquin; all respawn on wake. Untracked to leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts (Gama holds it).

(*MVOX:Palestrina*)
