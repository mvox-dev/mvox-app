# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-09-11 (MVOX-21 seam, token economy — Mihkel's ruling).** Full history in git (last full version: a8586ef). Keep this file to the live block + ONE previous checkpoint; older checkpoints die at each seam.

### [NEXT SESSION — MVOX-40 checkpoint 2026-10-10 22:50Z]

**State:** main af6d279 (plus this seam commit), no branch open, no teammates up. Nothing `ready`. Restart at Mihkel's ask.

**Landed:** #876 (#878, af6d279, Sonnet, Bentham GREEN first pass): /profile picker offers passkey → auth/passkey/register; separate link removed. Closed after Mihkel's acceptance via po-team: #870, #871, #876.

**Watch:** Mihkel suspects an upstream Entu passkey issue; po-team says it waits, nothing for us now.

**Comms fix:** courier won't inject into a non-empty team-lead inbox and read_mail doesn't clear it; empty it after each read (mvox-wake §3.4, needs manual mode). Mail acceptance relays from po-team are enough to close issues (autoMode.allow rule in ~/.claude/settings.json).

**Loose ends:** untracked probe-701-...-committed.json in the app tree. Untested: agenda view toggle with no chips (AgendaListArea.svelte:87). Season panel h2 renders above the agenda h1 when open (SeasonCardHeader.svelte:109).

(*MVOX:Palestrina*)

---
### [PREV — MVOX-39 checkpoint 2026-10-10 11:30Z]

**State:** main 1f89f8e (plus this seam commit), no branch open, no teammates up. Restart at this seam was Mihkel's ask (harness update).

**Next:** #876 (passkey in the /profile link picker via auth/passkey/register; separate link goes) is `prepped`: brief ~/workspace/scratchpad/brief-876.md, digests research-876-*.md. Spawn Josquin on Sonnet (model rule), Bentham on Opus to review (auth surface). Label → `in process` when spawned.

**Landed since MVOX-38:** #870 + #871 (#875, 1f89f8e, Sonnet, 1 review round): past-event card shows "● Kohal (tulen)" instead of the greyed RSVP pill; Märgi kohalolek top right. Closed after live checks: #869, #855; #856 closed (link check dropped, moved to #876).

**Waiting on Mihkel:** phone check #870, #871 (both `in human review`). New rule: reopened-for-live-check issues carry `in human review` alone; it clears on close.

**Model rule (Mihkel 10-09):** Josquin on Sonnet for small/pattern-following issues with a prescriptive brief; Opus for pattern-setting/design. Auto-memory feedback_josquin_model_by_issue.md.

**Loose ends:** untracked probe-701-...-committed.json in the app tree. Untested: agenda view toggle with no chips (AgendaListArea.svelte:87). Season panel h2 renders above the agenda h1 when open (SeasonCardHeader.svelte:109).

(*MVOX:Palestrina*)
