# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-29 seam 2026-09-28 21:5xZ, Mihkel called the break]

**In flight: #395 (feedback entity).** Slice 1/2 LANDED 81f6c59 (schema of record + seed-395 crede provisioning script, dry-run default; PO-Approved trailer). Slice 2/2 (sole create path + FeedbackView) STOPPED at its RED contract pin: Pérotin commented on #395 (21:35Z) asking whether feedback gets a display `name` — against Mihkel's "nothing in comments". Sent to Gama to rule in the BODY + remove the comment. Relaunch = args-395.json with only task 2 (edit tasks[] to the slice-2 entry, keep "exactly 0 comments"; re-read the body for her ruling, fold it into the brief). Then: live provisioning of the type on crede from the TEAM-LEAD session (Mihkel's "#395 go-ahead!" is in the body, line ~17: type + 3 fields, no member records; dry run → live → ledger; may need manual mode) → Pérotin read-back + ledger PR. #395 closes only after a live read-back AS A SECOND MEMBER — who does it is still with Mihkel.

**Queue after #395 (all `ready` unless noted, chores via Josquin, not TDD):** #505 local suite = CI (MEASURE FIRST; container has 2 CPUs/7 GB vs CI public runner ~4/16 [unverified]; if CPUs are the cause → number in the PR and STOP, Gama restates) → #504 targeted tests while iterating (template) → #506 comment rules (template/prompts; body will carry Mihkel's length/width/frequency rules — re-read) → #507 trim the three big route files' comments → #509 comment check (unlabelled, follows #507) → #508 split the agenda page (not released). Epic #503.

**Landed this session (MVOX-29):** #483 1225e77 · #487 d568d7e · #388 f4edd65 · #394 037ab3b · #422 57cc7f6 · #361 59a3509 · #434 (6 slices, closed 92d1e37) · #395 s1 81f6c59. Tooling: RED on Opus 5.5 (e148ff8), lean research returns (5651af3), haltPush on review halts (9fc67b2), mvox-merge squashes with the PR description (skill edit, repo default is COMMIT_MESSAGES).

**Rules this session (memory):** nothing in issue comments — rulings/auth live in the BODY (feedback_nothing_in_comments.md). Hand merges: squash from a hand-written body file (fix-round commits carry stale/false text). A pipeline MERGE failure (not a review halt) still leaves the branch local — push by hand; template fix pending. Never truncate an issue body when checking for a ruling (cut -c hid #361's ruling once). Research args: one question per lettered item; digests in ~/workspace/scratchpad/research-<N>-{verify,blast}.md. Findings log: ~/workspace/scratchpad/findings-mvox-29.md.

**Live-pass residuals for Mihkel:** #434 — offline, open the agenda: write controls stay disabled with the reason while it shows cached data (Bentham's ordering argument is from router code, not an end-to-end run); #470 pickers on a real roster; #468 member view; #408 device checks.

**Team at seam:** finn, bentham, perotin, josquin — all respawn on wake. Untracked to leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts (Gama holds it).

(*MVOX:Palestrina*)

---
### [PREV — MVOX-28 seam 2026-09-23 22:5xZ]

**Board empty; nothing in flight.** #470 CLOSED 5fdc5dc (PR #484, merged 2026-09-23T22:43:20Z): hand fix round after the pipeline's RED — Josquin 31b57b9 (selectedIds/renderIds split) → Bentham RED-470.1 (keyed {#each} on member section ids throws on a duplicate; Entu POST appends, two admins/two tabs) → Josquin 0dadd77 (distinct at listActiveMembers + patchMemberSectionIds, mapper pin RED-first) → 09f0cfe main merged in → Bentham GREEN round 4. Labels cleared 22:4xZ; landing sent to Gama.

**Open unlabelled:** #483 (Gama filed from Finn's read: season conductors panel, same dup-key shape at seasonManage.ts:269 / entuSeasons.ts:110,207 / roster +page.svelte:7265 — fix = distinct at the loader, #470 pattern); #477 (nine user-feedback points on the agenda page, Gama's to cut); #422, #434 still parked. Wait for `ready`.

**Team at seam:** finn, bentham, perotin, josquin — all respawn on wake. Tree on main; untracked to leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts (Gama holds that question). Pérotin's probe-470 script + ledger committed in this seam PR (polyphony: 2 members, 0 sections, 0 duplicates — not a roster).

**Rules this session:** a teammate returns the shared tree to main only after the reviewer reports, not after its own push (Bentham's gate run flipped mid-suite 22:29Z; he caught it by capturing HEAD before/after in one command). Pipeline agents hold no Entu JWT (.env = PUBLIC_ENTU_API_BASE only) — "verified live on the page" in a pipeline review means fixtures, never a real db.

**Live-pass residuals for Mihkel:** #468 — see the section picker as an ordinary member on cards she owns; #470 — the new one-per-membership pickers on a real roster; #408 device checks.

(*MVOX:Palestrina*)

---
