# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-24, seam checkpoint 2026-09-18 16:45 EEST]

**#362 PACK LANDED (wf_966a614f-827, 31 agents, 0 errors): #363 fb2c20d · #372 7315cdd · #400 7b4be2c · #365 d7b7dfe · #371 e27beb2.** All four gate children of #362 closed; epic's close is Gama's. Grant-trust paradigm ratified on #362; no-BFF corpus rewrite landed (772906a/35619e2 app, 2123058/d77aacc schema repo).

**QUEUE (args in ~/workspace/scratchpad/, all prepped, TURN DISCIPLINE on every prompt):** (1) ledger pack args-next-pack.json [402→401→367→344] — LAUNCH NEXT; (2) links args-links-374-375.json (one slice, closes both); (3) #233 args-233-pack.json [S1,S2,S3,S4 CODE slices] — live runs are Pérotin's on Mihkel's per-step authorization (S1, S2, then S2-rerun+S4), all after #402; S3 precondition = S1+S2 live ledgers on main; (4) #407 args-407.json LAST (358-file polyphony→history sweep, sampledb token, fence spec).

**TOOLS LANDED THIS SEAM:** teams/mvox-dev/scripts/context-health.sh (real context tokens per agent; merge Monitor prints it at every landing); .claude/workflows/research-pack.js (research template: contract-pinned verify agents + blast + clears `in research` itself); tdd-slice-pipeline.js TURN_DISCIPLINE baked into agentS. Memory: mvox-db-from-jwt-accounts (no PUBLIC_ENTU_DB), workflow-agent-background-gates-fail, context-health-at-seams, native-issue-types (types=kind, labels=movement only).

**LAWS ADDED:** grant-trust (Entu grants only authority; no BFF exists); research workflow clears its own labels, team-lead sets prepped only with args; §12/issue-standard.md is po-team's — done-when boxes are the contract; polyphony dropped from constraining us (crede-only schema work, one script per step, #407).

**Session record:** ~/workspace/scratchpad/findings-362-slice.md (+ research-*-digest.md, gist https://gist.github.com/mitselek/4a4401ecfc6606a6aa7e10552e3d683b).

(*MVOX:Palestrina*)

---
### [PREV — MVOX-20 tail]

**#322 LANDED before exit: db03a38, first-pass GREEN, closed, label cleared, notice sent.** Its args ADOPTED Bentham's pin-set close (ER-18..23 into UNTOUCHED_SHA256) — args-318 must NOT re-take it.

**MVOX-20 TALLY (19h session): 8 merged** — #315 e361173 · #313 d118cff · #317 d8651b9 · #256 9929de2 · #277 0732e85 · #320 6cbaf39 · #321 b178631 (7-commit recovery, Bentham RED→GREEN) · #322 db03a38. Plus: #289 inventory fe52c54 + SIX sub-issues cut #323-328 (all ready via Gama) · #329 filed+ready · #316 at 2/4 (doc = ER-1..ER-23 + two-layer guard fence).

**STANDING FROM MVOX-20:** epic-label-mirrors-tasks (durable memory; also: clear `in research` when research lands without immediate args). `disableArtifact: true` in ~/.claude/settings.json. Count semantics = probe-settled platform knowledge (ledgers committed; ER-doc candidate for future commission). Label contract v2 (in research → prepped → in process → cleared after landing). Resident loop armed; flags fresh-next/stay-down in ~/.claude/.

(*MVOX:Palestrina*)
