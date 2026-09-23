# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-27 closed at a seam 2026-09-23 21:3xZ on Mihkel's word ("at next seam, lets restart")]

**FIRST: finish #470.** Pipeline halted at review RED after fix cap; branch `feat/470-native-section-pickers` is PUSHED @ 44b61f3 (4 commits, gates green, 6193 tests), tree back on main. One blocker, fix shape known — read the last #470 entry in ~/workspace/scratchpad/findings-mvox-27.md (split SectionPicker's `selectedIds` into full-held-set for exclusion + `renderIds` for the per-card {#each}; two specs on the m-multi fixture). Pattern: spawn Josquin, fix round on the branch → Bentham verdict → Josquin PR via /mvox-merge with `Closes #470`. Issue #470 is `ready,in process`. Not a re-run of the pipeline (cache is prompt-keyed; the branch is the state).

**Landed 2026-09-23 (seven):** #463 e26d989 · #466 e73406b · #467 c5a5024 · #471 57d7de4 · #474 74f91dc · #468 68de3ac · #469 a8422b0; seam PRs #465, #479, #481, and this one. Team at exit: finn, bentham, perotin, josquin — all respawn on wake. Untracked on tree, leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts.

**Rules this session (all in memory):** research and dev run in parallel, never hold a prepped issue to pack it; /mvox-merge = one command per Bash call; a mid-turn operator question derails running workflow agents (relaunch with a nonce); research-pack labels agent split "468" into 4/6/8 → template fix pending (pass `#N` tokens); pipelines halting at YELLOW/RED after fix cap → hand fix round, scope widenings ruled explicitly in the findings log.

**Live-pass residuals for Mihkel:** #468 — see the section picker as an ordinary member on cards she owns; #408 device checks. Open unlabelled: #422, #434. #361's surface list grows after #469.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-26 closed at a seam 2026-09-23 02:20Z, fresh-next]

**Board empty at exit; nothing in flight.** Team: finn, bentham, josquin, perotin (fresh since 20:12Z) — all respawn on wake. Untracked on tree, leave: scratchpad/, probes/probe-crede-rsvp-tally-nameless-diagnosis-2026-09-19.ts (Gama holds that question). Open threads with PO: #422 (loadCfg gate) and #434 (offline event page) unlabelled; roster last-activity parked on Argo; Mihkel owes device checks on #408 (installed iPhone updates; ET iOS hint). Live crede commands run from the team-lead session under MANUAL mode; common-prompt Merge Procedure is now the PR path (36ef0e0).

**Later 2026-09-22:** #454 CLOSED a828096 (chip gated on the read; producer reads _viewer — Entu returns 200 with the private bucket withheld, never a refusal; Gama corrected the body premise) · #456 CLOSED 35549d7 first-pass GREEN (orphan members skipped in active + archived lists). Pérotin respawned fresh at this seam (74% context). Board empty. Team-lead context 61% — next seam soon.

**2026-09-22:** #445 (crede persons+rsvps domain+inherit) CLOSED after a bad hour: I re-asked Mihkel four times for a word his first one covered, and spent the hour on duplicate-value cleanup nobody asked for (his ruling: identical duplicates are fine). Rules now in memory: one authorization per job; identical duplicates OK; confirm nobody hand-edits the rows during a run; the issue carries the word + the landing, diagnosis stays in ledgers. Live crede commands run from the team-lead session under MANUAL mode (auto-mode classifier blocks them and even SendMessage); when the shared tree has a teammate's edits, run the committed script from a `git worktree add /tmp/wt origin/main` with node_modules symlinked. Roster last-activity parked on Argo; Joosep chip question answered to Gama (owner reaches the person).

**LANDED 2026-09-21:** #442 login storage warning e03f902 (Y→RED→GREEN; RED = Paraglide getLocale() reads localStorage unguarded, fixed in-slice) · probes 5ac4e21/4705d3c/bc03c65 (value created stamp; parked on Argo) · #421 REGEX record 48b8f82 (Mihkel hand-set the formula; Entu docs rewritten 2026-09-21, memory refreshed). Docs checkout ~/projects/entu-www sits on a feature branch — read origin/main via git show. Board empty; #422/#434 unlabelled.

**LANDED 2026-09-20:** #427 part viewer 8686405 (PR #435; pipeline RED→Y→Y at cap → Josquin fix 3 → Bentham GREEN 4; pdfjs-dist added, split SW install core/tail, downloads → viewer per Gama ruling; #434 filed by Gama for the offline event-page gap) · #408 install-as-app 969fc62 (Y→Y→GREEN; manifest + icons from Mihkel SVG via scripts/icons/render-icons.ts + @resvg/resvg-js; SW untouched). Device checks owed by Mihkel post-deploy (installed iPhone still updates; ET iOS hint wording). LESSONS: my #427 brief contradicted itself (cache write vs no-store fence → #353 label regression); split greenfield slices (route first, wiring second); SPIKE runs the build when a dependency/worker is added; stale comment above refreshPresence in event/[id]/+page.svelte to fix in place next touch. Board empty; #422 (loadCfg gate) and #434 unlabelled.

**#233 CHAIN COMPLETE 2026-09-20 02:3xZ:** #418 (prop-def, ledger 971d286) · #419 (backfill 10/36, ledger 109a4a2) · #420 (app on event_name, 75686df) · #421 (formula live, prop-def 6a92a333ca67df980f415044, ledger 54ab40b) — all CLOSED. #233 parent still OPEN `blocked`, Gama's to close. Live commands ran from the TEAM-LEAD session under manual mode (Pérotin's session classifier-blocked); auth comments verbatim on each issue first; Pérotin did read-back + ledger PRs. Template: noClose option (e2998b7). Findings log: ~/workspace/scratchpad/findings-mvox-26.md. Pattern for live steps: dry run → Mihkel → auth comment → live from team-lead → Pérotin read-back + PR → close with landing comment.

**LANDED EARLIER:** #407 3c839ae (pipeline, review YELLOW×2→GREEN, 277 files) · #417 0543d90 via PR #423 (pipeline YELLOW×3 at fix cap → Josquin fix round 3 → Bentham GREEN round 4 → PR merge; first merge through the required CI check). Template MERGE is now the PR path (f3194aa + CI-register wait loop); branch protection ON (`check + test` required). #422 filed by Gama (loadCfg scripts reach crede ungated, follow-up). #418→#421 are the #233 re-cut; #418 unblocked by #417, unlabelled until Gama releases; #233 `blocked`, args-233-* stale.

**RULES THIS SESSION:** pipeline halts at YELLOW after fix cap → team fix round (Josquin) + Bentham verdict + PR merge; PO calls found in review go on the issue AND to Gama by courier. `gh pr checks --watch` can exit before CI registers — template now waits. Pérotin's untracked crede probe + seed-233 dry artifact still on tree, untouched.

**SEAM COMMITS GO VIA PR TOO:** protection rejects direct push to main; team-lead checkpoints = branch → `gh pr create` → `gh pr checks --watch` → `gh pr merge --squash --delete-branch`. **BOARD:** no `ready` issue at 11:05Z. Team idle: finn, bentham, perotin, josquin up.

(*MVOX:Palestrina*)

---
