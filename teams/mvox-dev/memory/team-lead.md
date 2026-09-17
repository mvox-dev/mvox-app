# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-24, post-regroup index 2026-09-18 02:35 EEST]

**Team:** solo wake 2026-09-16 (Mihkel: no roster members); `companion` (sonnet, blank, no role) spawned as the only teammate. Regroup basis still pending from po-team — no dispatch until it lands.

**ISSUE MODEL (#384, closed, Gama):** four kinds = GitHub types Task/Bug/Feature/Epic. Forms in `.github/ISSUE_TEMPLATE/{task,bug,feature,epic}.yml`; enforcement in `scripts/roadmap/issue-model.ts` (parses form `### Heading` sections AND legacy `---` frontmatter; refuses with named missing fields, never throws). Task = slugline+lead (Estonian) + What + Done-when (checkable lines) + Parent epic (`#N`) + rights-rules (ER ids, optional). Bug = what was seen + where + who (role, never a name). Feature = the request verbatim, unshaped. Epic = slugline+lead+story; children via native sub-issues (no Children field, #391). Forms no longer assign kind labels — the type says it (#393). Motion labels orthogonal to kind: ready/blocked/in process/in research/prepped/needs-po. **Per-person GitHub accounts since 2026-09-18** (Gama files as `gamamvox`); author = login for new issues, body marker for old. `[TASK]` title prefixes stripped. Rulebook change: issue-standard §9/§10 wording lives in the form descriptions now.

**GROOMED BACKLOG (20 open):**
- Epic #390 in-app feedback (Gama, Mihkel rulings 2026-09-15): #388 roster PII capture · #394 drawing component (strokes only) · #395 feedback entity (member's child, domain-visible) · #361 name-bearing surfaces · #392 CLOSED (rebadge of #357, d1891fb). Compose-and-send task cut after children land.
- Epic #362 gates read Entu grants: #372 RSVP control asks may-write · #363 canSeeTally · #365 season-summary opens on rights.
- Epic #334 offline parts: #367 agenda presence badge (ready) — rest closed.
- Epic #333 doodling: no children yet (#394 is the reusable stroke component, filed under #390).
- No epic: #233 event_name formula (ready, old) · #270 crede person.email reminder · #370 Bug RSVP 'try again' · #371 grantSelfEditor (ready) · #373 roadmap reads kind from type · #374/#375 Features (link scheme / relative path).
- **ready:** #233 #344 (`good readable issue`) #367 #371. `in research`: none.
- **DELETED:** #358 #359 (→ #394 #395) · #364 #376–#380 #382 #383. **Branch fix/382-merge-prompt-git-facts @ b451cbc is orphaned** (issue gone) — needs Mihkel's word: delete or re-home.
- Closed this window: #366 doc fix (7a93e14 retires ER-24/25), #369 crede RSVP bug, #384, #392.

**LAWS (unchanged, durable memory):** app-not-docs; decision-vs-permission; ruling=posture-never-mechanism; gate-first merges; types show kind, labels show movement (Mihkel 2026-09-18, supersedes both-forever); .string bakes PII.

(*MVOX:Palestrina*)

---
### [PREV — MVOX-20 tail]

**#322 LANDED before exit: db03a38, first-pass GREEN, closed, label cleared, notice sent.** Its args ADOPTED Bentham's pin-set close (ER-18..23 into UNTOUCHED_SHA256) — args-318 must NOT re-take it.

**MVOX-20 TALLY (19h session): 8 merged** — #315 e361173 · #313 d118cff · #317 d8651b9 · #256 9929de2 · #277 0732e85 · #320 6cbaf39 · #321 b178631 (7-commit recovery, Bentham RED→GREEN) · #322 db03a38. Plus: #289 inventory fe52c54 + SIX sub-issues cut #323-328 (all ready via Gama) · #329 filed+ready · #316 at 2/4 (doc = ER-1..ER-23 + two-layer guard fence).

**STANDING FROM MVOX-20:** epic-label-mirrors-tasks (durable memory; also: clear `in research` when research lands without immediate args). `disableArtifact: true` in ~/.claude/settings.json. Count semantics = probe-settled platform knowledge (ledgers committed; ER-doc candidate for future commission). Label contract v2 (in research → prepped → in process → cleared after landing). Resident loop armed; flags fresh-next/stay-down in ~/.claude/.

(*MVOX:Palestrina*)
