# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-41 checkpoint 2026-10-11 22:40Z]

**State:** main 34ae059 (plus this seam commit), no branch open. Up: finn, bentham, perotin (idle). Nothing `ready`.

**Landed today:** #881 PDF download (#883, accepted, closed); #882 notes-only PRs skip the suite, only teams/mvox-dev/memory/ + inboxes/ (#884; live check #891 green in 6s); Run 400 #886-#889 (#892, cap 400, register machinery gone, exceptions empty); #893 invite parent-resolve merge (#895); #894 season/event create respect a collective switch (#896).

**Open:** #890 (Run 400 consolidation): duplicate scan done (consolidation-400.md, reported to Gama); waits on Mihkel's per-run word for the read-only #701 rights sweep on crede (script scripts/migrations/probes/probe-701-rights-sweep-crede.ts, run from team-lead session). #897 filed (season/event shell merge + collapse-refused test), unlabelled for Gama.

**Rules this session:** spawn implementers as `josquin-<N>`; release by shutdown_request. Closing an issue clears its labels (PR #879). CI YAML: an unquoted ": " in a run line breaks the whole workflow, and nothing local catches it.

**Loose ends:** josquin.md prompt still splits RED/GREEN by role; briefs have one Josquin do both. Untracked probe-701-...-committed.json in the app tree. Untested: agenda view toggle with no chips (AgendaListArea.svelte:87). Season panel h2 above agenda h1 (SeasonCardHeader.svelte:109).

(*MVOX:Palestrina*)

---
### [PREV — MVOX-40 checkpoint 2026-10-10 22:50Z]

**State:** main af6d279 (plus this seam commit), no branch open, no teammates up. Nothing `ready`. Restart at Mihkel's ask.

**Landed:** #876 (#878, af6d279, Sonnet, Bentham GREEN first pass): /profile picker offers passkey → auth/passkey/register; separate link removed. Closed after Mihkel's acceptance via po-team: #870, #871, #876.

**Watch:** Mihkel suspects an upstream Entu passkey issue; po-team says it waits, nothing for us now.

**Comms fix:** courier won't inject into a non-empty team-lead inbox and read_mail doesn't clear it; empty it after each read (mvox-wake §3.4, needs manual mode). Mail acceptance relays from po-team are enough to close issues (autoMode.allow rule in ~/.claude/settings.json).

**Loose ends:** untracked probe-701-...-committed.json in the app tree. Untested: agenda view toggle with no chips (AgendaListArea.svelte:87). Season panel h2 renders above the agenda h1 when open (SeasonCardHeader.svelte:109).

(*MVOX:Palestrina*)

---
