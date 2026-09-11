# Auto-saving fields — inventory and four-state verdicts

**Status:** authored 2026-09-11 from a full code read at `97fa0d6` (research run `wf_4e49a9dc-a4a`, two read-only agents; supersedes the 2026-09-10 partial pass). This is #289's first deliverable — the catalogue its sub-issues are cut from. It is a **recurring QA class** (Mihkel, 2026-09-07, verbatim on #289): re-run the read when write surfaces are added; a surface missing from this file is unclassified, not exempt.

**The requirement (from #289):** a user can always tell whether their data is in the system. Four states, all distinguishable: **not yet attempted · saving · saved · failed**. Failure says what did not happen and leaves a retry. An optimistic surface may not leave an unconfirmed value on screen without saying so. A `disabled` control while pending is a **double-tap guard, not a state signal**.

## The reference — #267 `roster_show_real_names`

Contract: `src/lib/collective/rosterNames.ts` (spec: `rosterNames.spec.ts`); wiring: `src/routes/profile/+page.svelte:836-894` + markup `:977-1014`. No second pattern is invented; every fix propagates this one.

The four states in DOM/a11y terms:

| state | DOM |
|---|---|
| not yet attempted | control enabled, value = last server-confirmed; persistent sr-only `role="status"` region empty; no error node |
| saving | control `disabled`; status region cleared **at attempt start**; no error node |
| saved | control re-enabled, value = new (assigned **only in `.then`** — never before the await); status region announces saved on the **same persistent node** (aria-live fires) |
| failed | control re-enabled, value **restored to the pre-write capture** (never a re-read); status empty; `role="alert"` node with the truthful message |

A second, independently built instance of the same discipline exists: profile field edits / tier moves (`profileEditQueue.ts`, `fieldMoveQueue.ts`, `ProfileField.svelte:347-370`) — idle / "saving…" / saved-dot / `role="alert"`, never optimistic.

## Inventory

Verdicts: **COMPLIANT** (four states distinguishable) · **PARTIAL** (failure honest, but *saved* indistinguishable from *not yet attempted*) · **GAP** (a state is silent or a guard is missing) · **N/A** (not auto-save, or no server round-trip).

| surface | where | mode | verdict | gap |
|---|---|---|---|---|
| roster_show_real_names (#267) | profile/+page.svelte:855-1013, rosterNames.ts | server-confirmed | **COMPLIANT** | — (the reference) |
| profile field edits + tier moves | profileEditQueue.ts, fieldMoveQueue.ts, ProfileField.svelte | server-confirmed | **COMPLIANT** | — |
| admin collective name | admin/+page.svelte:357-390 | server-confirmed | **COMPLIANT** | — |
| roster structural writes (sections, member save) | roster/+page.svelte (pending flags + alert/status per its own comments, :1698-2557) | server-confirmed | **COMPLIANT** [sampled, not read end-to-end] | — |
| **links reorder (#256)** | links/+page.svelte:181-203, linkActions.reorderLinks | server-confirmed | **GAP — worst** | zero of four states: no pending flag (double-tap races the atomic renumber), no saving cue, refresh-lag with no busy signal, failure = `console.error` only — nothing re-renders, no alert, no retry hint |
| **repertoire/programme management** (event page + season panel) | event/[id]/+page.svelte:1732-1861 + routes/+page.svelte:1971-2096, shared `createRepertoireWriteQueue`, RepertoireElement.svelte | optimistic | **GAP** | failure fully silent (`console.error` + silent refetch); component has no failed prop at all; same defect on both pages via the shared primitive |
| **season conductor add/remove (#277)** | routes/+page.svelte:3635-3671 | optimistic | **GAP** | no pending/disabled guard at all — concurrent double-tap writes possible; failure text exists (:6448) |
| **admin/librarian add/remove** | admin/+page.svelte:443-497 | server-confirmed | **GAP** | failure surfaced, but no pending guard — double-click fires concurrent writes; no saving state |
| **RSVP (member Going/Not going)** | rsvpChangeQueue.ts, RsvpControl.svelte | optimistic | **GAP** | *saved* indistinguishable from *not yet attempted* (the epic's named hazard); pending = silent disable (PO-ruled, stays); failure reverts + alerts (good); no saved announcement |
| **attendance (conductor P/A/L)** | attendanceChangeQueue.ts, AttendanceSurface.svelte | optimistic | **GAP** | same as RSVP line for line; the optimistic tally also confirms nothing |
| season field edits (name/dates, #277) | routes/+page.svelte:3549-3608 | optimistic | **PARTIAL** | failure reverts + inline error (good); no saved cue |
| event inline field edits (#104) | event/[id]/+page.svelte:2427-2571 | optimistic | **PARTIAL** | per-field errors solid; no saved cue |
| event schedule items (#262) | event/[id]/+page.svelte:1863-2140 | optimistic | **PARTIAL** | per-row alerts (its own prior silent-snap-back bug fixed); no saved cue |
| event convert flow (#313) | event/[id]/+page.svelte:3121+ | — | **N/A** | explicit dialog + submit; progress line is a one-shot action's indicator |
| links create/edit/delete (#256) | links/+page.svelte:121-178 | — | **N/A** for #289 | explicit-submit forms. NOTE: they also swallow failure into `console.error` — a real defect, just not auto-save; carried on the links sub-issue as adjacent scope for the PO to keep or cut |
| agenda view toggle (#312) | routes/+page.svelte:7694-7722, agendaViewStore | — | **N/A** | localStorage device preference, no server write, no failure mode |

**Sweep coverage:** the write-queue families at HEAD are exactly `rsvpChangeQueue`, `attendanceChangeQueue`, `profileEditQueue`, `fieldMoveQueue`, and `createRepertoireWriteQueue` (5 instantiations), plus the ad-hoc onblur/onclick writers listed above. No other optimistic or auto-commit pattern was found (`grep` over `src/lib` + `src/routes` for queue/optimistic/pending idioms).

## Sub-issues cut from this inventory

Ordered by user harm; grouping follows shared primitives (one defect, one fix) rather than pages.

1. links reorder — all four states + double-tap guard (worst: silent loss, no recourse)
2. repertoire/programme silent failure — wire failure through the shared queue on both pages
3. missing pending guard on select/remove controls — conductor + admin/librarian (double-tap race)
4. RSVP — the saved state gets its own cue (epic-named)
5. attendance — the saved state gets its own cue (epic-named)
6. saved-cue for the PARTIAL class — season fields, event inline fields, schedule items

The #321 boundary: five pages carry both a write surface from this file and a capped read from #321's inventory (`routes/+page.svelte`, `event/[id]`, `roster`, `library`, `admin`). The two issue families stay separately scoped per the PO's ruling (2026-09-11): one reading pass may feed both, two deliverables come out.

(*MVOX:Palestrina*)
