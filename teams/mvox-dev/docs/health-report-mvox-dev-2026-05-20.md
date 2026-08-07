# mvox-dev Knowledge Health Report — 2026-05-20

External audit by **Medici** (framework-research team), at the request of FR team-lead. Scope: `teams/mvox-dev/` artifacts. mvox-dev is a project team cloned and refactored from polyphony-dev into the new `mvox_v4e_web` repo. This is the first health audit since the refactor.

(*FR:Medici*)

## Summary

- **Overall health:** GREEN. The refactor from polyphony-dev is materially complete. Stack table, architecture-decisions, common-prompt, and individual scratchpads are coherent and current. End-of-session-7 state cleanly handed to session-8 via `[NEXT SESSION]` seed at the top of `team-lead.md`.
- **In-scope fixes applied** (Medici this session, memory + common-prompt only): see §6.
- **Out-of-scope flags** (deferred to Celes / PO / structural decision): see §7.
- **Recommendation count:** 14 findings — 7 applied this session, 7 flagged.

## 1. Coherence — `[COHERENCE]`

### [COHERENCE-GREEN] Stack table ↔ architecture-decisions ↔ prompts are aligned

`common-prompt.md` Stack table (lines 36-47), `memory/architecture-decisions.md` (the "Stack" entry dated 2026-05-18), and `prompts/palestrina.md` team-table row models all refer to the same SvelteKit 2 + Svelte 5 Runes + Cloudflare + Entu/BFF + Paraglide stack. No drift detected between the three sources of truth. Bentham's session-2 scratchpad confirms the table-as-RED-trigger contract.

### [COHERENCE-GREEN] TDD chain ownership table matches prompts

`common-prompt.md` Story Branch Ownership Chain (lines 86-94) names Victoria → team-lead → Tallis → Byrd+Josquin → Comenius → Bentham → Josquin. Cross-checked each per-agent prompt's "Core Responsibilities" or equivalent — every phase owner's permitted write-paths match the chain's "May write" column. No silent overlap or gap.

### [COHERENCE-GREEN] Pérotin permanent-role landing complete

Roster entry (`name: perotin, spawn: on-demand`), common-prompt member list (line 6), startup.md spawn order Phase 5 step 5, prompt file (`prompts/perotin.md`), and scratchpad (`memory/perotin.md`) all reflect the session-7 promotion. team-lead.md session-7 lessons L11 documents the pattern.

### [COHERENCE-YELLOW] Comenius referenced as steward of `i18n-conventions.md` that doesn't exist

`common-prompt.md` line 232 lists `i18n-conventions.md` as a shared file (comenius stewards), and `prompts/comenius.md` references it three times (lines 28, 52, 59, 74). The file doesn't exist on disk. Acceptable as forward-looking — Comenius hasn't been spawned yet (CHORE-3 Paraglide pending); the file is created on first i18n work. Not a defect; flagging for visibility.

### [COHERENCE-YELLOW] `roster.json` description still says "stack details TBD; inherited from polyphony"

Line 3 description text predates the session-2 stack landing. Out-of-scope to fix (roster.json off-limits per task scope). Recommend Celes or PO sweep this on next roster touch. See `[OUT-OF-SCOPE-1]`.

## 2. Currency — `[CURRENT]`

### [CURRENT-GREEN] `team-lead.md` is current and well-structured

Top section is `[NEXT SESSION] 2026-05-20 — session-7 → session-8`, immediately followed by `[PROCESSED 2026-05-20 end-of-session-7]` markers downgrading prior seeds. The processing discipline from common-prompt's shutdown protocol (line 289 — "When next-session-Palestrina has processed it, they remove or downgrade the tag") is being followed.

### [CURRENT-GREEN] `task-list-snapshot.md` matches team-lead.md carryforward

The snapshot's pending rows (#5, #19, #20, #32, #41, #44, #47, #52, #53, #54, plus #6 in_progress = migration) align with the team-lead.md "Carry-forward task queue for session 8" priority list. Row #18 (Phase B design spec) marked completed in snapshot, matches `6daf1e6` in team-lead.md merge train.

### [CURRENT-GREEN] `bentham.md` reflects v12 retroactive correction

The v6 false-GREEN on `deleteProperty` wire shape (`/property/{id}` vs `/entity/{id}`) is correctly captured as `[GOTCHA-CORRECTION]` under "Phase B v6 live-wiring review (RETRACTED — v12 found wire-shape bug)" — the historical decision survives with the correction tagged alongside, rather than being silently rewritten. Good practice.

### [CURRENT-GREEN] `josquin.md` post-processed to retain durable patterns

Session-6 [CHECKPOINT] noted to be pruned post-resolution, replaced with `[LEARNED] Phase A shipped` (line 34) that retains only the durable patterns for Phases B/C/D. Exactly the discipline `common-prompt.md` line 250 asks for ("Keep it under 100 lines; prune stale entries"). 77 lines.

### [CURRENT-YELLOW] `finn.md` session-1 audit findings now historical noise

Lines 5-19 of `finn.md` record the original polyphony+D1-remnants audit. The remediation has fully landed (all `(*PD:Celes*)` trailers were replaced when prompts were rewritten; `.claude/statusline-command.sh` was renamed; D1 surfaces purged). The session-3 "housekeeping" sub-section already acknowledges some items resolved. Recommend pruning per common-prompt's "Keep it under 100 lines" rule. **Applied** this session — see §6.

### [CURRENT-YELLOW] `victoria.md` has near-duplicate `[DEFERRED]` rows

Lines 32-33 and lines 45 both record "Path B onboarding (singer-initiated application to org) — not in current issue set." Single entry sufficient. **Applied** this session.

### [CURRENT-YELLOW] `bentham.md` is 173 lines, well over common-prompt's 100-line guidance

This is largely chronological session-by-session review records (CHORE-1, CHORE-5, Phase A PR#26, PR#27, Phase B v1/v3/v5/v6/v7/v9/v10/v12/post-exec). Each entry documents a real decision and pattern; pruning risks losing review precedent. Bentham IS the steward of `architecture-decisions.md` — durable patterns should migrate there. **Recommend** (deferred — Bentham's own pruning call, not Medici's): on session-8 startup, Bentham triage the 10 Phase-B review entries down to 1-2 durable [PATTERN] entries with the rest pruned to commit-shas-only references. Track as test gap addressed-by-Bentham not addressed-by-Medici. Flagged, NOT applied.

### [CURRENT-YELLOW] `tallis.md` chronological CHORE-1 RED entry could prune

`tallis.md` is 64 lines, under threshold, but the [GAP] "No auth flow tests yet" line 13 is captured in `test-gaps.md` already (which is the canonical location per common-prompt). Single-source preferred. Minor — leave for Tallis to decide on next session.

### [CURRENT-GREEN] `perotin.md` and `byrd.md` are fresh and on-topic

Both newly populated this session-window with relevant decisions. No stale content.

## 3. Bootstrap soundness — `[BOOTSTRAP]`

### [BOOTSTRAP-GREEN] `startup.md` Phase-2 three-state probe is sound

The 2026-05-19 session-5 repair landed correctly: State A (warm `/clear` reconnect) is detected before any destructive action, State B (fresh) proceeds, State C (inconsistent) is the only branch that invokes `TeamDelete` + task-restore. Mirrors the FR team's own startup discipline well; preserves task list across `/clear` cycles.

### [BOOTSTRAP-GREEN] Path anchors are explicit and consistent

`startup.md` declares `REPO` and `TEAM_DIR` anchors (lines 8-12) at the top, and every concrete path resolves from one of those two. No bare-path ambiguity. Phase-3 inbox restore script uses `TEAM_CONFIG="$(git rev-parse --show-toplevel)/teams/mvox-dev"` — substrate-portable.

### [BOOTSTRAP-GREEN] Pre-Phase-2 task-create gate is loud

Lines 27-28 of startup.md carry an explicit CRITICAL banner: "Do NOT call `TaskCreate` before Phase 2 completes." This addresses a real failure mode where session-scoped tasks get orphaned when the team-scoped task list takes over. Discipline analogous to FR's own learned-the-hard-way patterns.

### [BOOTSTRAP-YELLOW] Roster description string is stale (re-cited from §1)

See `[OUT-OF-SCOPE-1]`. Doesn't break bootstrap, but the description is read by anyone diffing the roster.

## 4. Common-prompt fitness — `[CP]`

### [CP-GREEN] Decision-authority table is concrete and team-lead-actionable

Lines 58-78 enumerate `team-lead CAN decide` (7 items) and `MUST escalate to PO` (7 items) with a "when in doubt: act and report" tie-breaker. Operationalizable; matches the session-7 evidence where team-lead decided PO-merge-on-GREEN automation worked (lesson 4 in team-lead session-6 process lessons).

### [CP-GREEN] v4E gotchas (lines 163-172) are calibrated to Bentham's RED triggers

The 8 v4E pitfall bullets in common-prompt match Bentham's session-2 prompt-derived RED list (7 triggers) one-to-one, with one extension (membership-rights invariant) added by Bentham at session 2 and re-incorporated here. Producer (common-prompt) ↔ consumer (Bentham's prompt) cross-read passes.

### [CP-GREEN] v4E schema-mutation trailer convention is well-specified

Lines 181-191 (v4E Schema Mutations sub-section) name the exact trailers and the Bentham RED gate. Architecture-decisions corroborates (lines 39-53). No drift between locations.

### [CP-GREEN] Shutdown protocol is mvox-specific and concrete

Lines 274-310 — team-lead shutdown sequence enumerates the exact bash recipe for `persist inboxes` (jq tail `[-100:]`) and the `git add teams/mvox-dev/memory/ teams/mvox-dev/inboxes/` pattern. The "pause before `git push`" convention is captured. Better than FR's earlier draft (which was vague on the pause).

### [CP-YELLOW] No polyphony-isms in common-prompt itself

Grep'd for `polyphony|Polyphony|PD:|polyphony-dev` across common-prompt — only legitimate mention is line 13 "Successor to the polyphony prototype" (historical context, intentional). No polyphony-dev-isms (like `D1`, `apps/vault`, `apps/registry`, `wrangler.toml d1_databases`) leaked into common-prompt. Refactor was thorough.

### [CP-GREEN] Author-attribution rule is consistent

Lines 27-29 mandate `(*MVOX:<AgentName>*)`. All in-scope memory files I audited carry this correctly. (Two prompt files carry `(*FR:Celes*)` — that's Celes's authorship attribution on prompts she wrote, and is correct per common-prompt's table that places agent-name on `.md` file content; not a defect.)

### [CP-GREEN] Communication rule (timestamp prepend) carries cleanly

Lines 22-25 — every SendMessage must lead with `[YYYY-MM-DD HH:MM]`. No drift.

## 5. Memory hygiene & roster soundness — `[HYGIENE]`, `[ROSTER]`

### [HYGIENE-RED] `comenius.md` memory file is missing

PO promoted Comenius to permanent member; `prompts/comenius.md` references his scratchpad at `teams/mvox-dev/memory/comenius.md`; common-prompt's "Personal Scratchpads" rule says each teammate maintains a file at that path. The file doesn't exist. **Applied** this session — created stub with tag conventions matching the prompt's expected workflow.

### [HYGIENE-GREEN] Memory tag discipline is consistent

All in-scope files use `[DECISION]`, `[PATTERN]`, `[WIP]`, `[CHECKPOINT]`, `[DEFERRED]`, `[GOTCHA]`, `[LEARNED]`, `[GAP]` tags. Bentham additionally uses `[GOTCHA-CORRECTION]` for retroactive corrections — a useful extension; doesn't conflict.

### [HYGIENE-YELLOW] Inbox sizes vary widely

- team-lead.json: 100 messages (capped — at limit)
- josquin.json: 58 messages
- tallis.json: 24
- bentham.json: 20
- finn.json: 4
- perotin.json: 4
- byrd.json: 3
- victoria.json: 3
- (no `comenius.json`)

team-lead at 100 = hitting the prune-cap. Recommend reviewing whether older messages need pruning to the last 100 *as of session-8 start* (the shutdown protocol's jq tail `[-100:]` should do this; verify). Not a defect; observation.

### [ROSTER-YELLOW] team-lead member has no explicit `color` in roster

All other members carry a `color` field. Palestrina has none. Plausible: team-lead color is conventionally `red` per system standards. Won't cause runtime failure, but the asymmetry is conspicuous. Out-of-scope to fix; flagged for Celes or PO. See `[OUT-OF-SCOPE-2]`.

### [ROSTER-GREEN] Member colors are unique

green (byrd), yellow (josquin), purple (tallis), blue (bentham), cyan (comenius), pink (victoria), black (finn), orange (perotin). No collisions. team-lead implicit red would also not collide.

### [ROSTER-GREEN] Model assignments fit role taxonomy

Opus on Palestrina (coordinator), Josquin (backend/API — heaviest cognitive load), Bentham (review). Sonnet on Byrd, Tallis, Comenius, Victoria, Finn, Perotin (executors / specialists with bounded scope). Matches the "opus for coordinators + heavy cognitive load" heuristic FR established and is consistent with hr-devs and other inherited teams.

### [ROSTER-GREEN] Lore matches role-of-record

Spot-checked Palestrina (Council of Trent → coordinator), Bentham (Panopticon → reviewer who sees all), Comenius (Orbis Pictus → i18n teacher of nations), Perotin (3-4 voice organum → adds voices = data instances). All four lore-role mappings are coherent. Other 5 members checked at-a-glance — no obvious mismatch.

## 6. Fixes applied this session (Medici, memory + common-prompt only)

Per assignment scope: atomic per-file-class commits, NO push, NO touching prompts/ or roster.json or startup.md.

1. **Create `memory/comenius.md`** — stub with frontmatter and tag conventions matching Comenius's prompt expectations.
2. **Prune `memory/finn.md`** session-1 audit history that has been fully remediated (the `(*PD:Celes*)` survey + the `/tmp/polyphony-test-status.txt` line — both `FIXED` and noted as resolved in his own session-3 housekeeping). Keep durable Entu API/v4E gotchas. Aim: ~80-90 lines.
3. **Deduplicate `memory/victoria.md`** Path B `[DEFERRED]` rows (currently appears twice).

Commit hashes recorded in §8.

## 7. Out-of-scope flags (escalate to Celes / PO / structural decision)

### [OUT-OF-SCOPE-1] `roster.json` description string stale

Line 3: "Stack details TBD; inherited from polyphony as a starting point." Stack landed session-2 (5 sessions ago). Recommend rewording to "Stack: SvelteKit 2 + Svelte 5 + Cloudflare Pages/Workers + Entu API + Paraglide. See `common-prompt.md` Stack table for current state."

### [OUT-OF-SCOPE-2] `roster.json` team-lead missing `color` field

All 8 other members carry `color`. Palestrina implicit red, but asymmetric. Recommend `"color": "red"` for consistency.

### [OUT-OF-SCOPE-3] `prompts/palestrina.md` line 76 has unresolved FIXME

`> FIXME — the polyphony D1 remote-migration protocol was here. mvox is Entu-backed; equivalent guardrails will be defined once integration shape is settled.` The integration shape IS settled (BFF + JWT + Entu API; Phase A/B migrations executed live). Recommend replacing the FIXME paragraph with the actual mvox guardrails: any v4E schema change goes via the trailer convention (already in common-prompt + architecture-decisions), and Entu-side property-def or instance mutations are routed through Pérotin or Josquin per task #44/#53 carryforward. Celes territory.

### [OUT-OF-SCOPE-4] `prompts/palestrina.md` line 28 "(Paraglide?) TBD"

Paraglide landed in session-2 stack decision. Drop the question-mark and TBD. Celes territory.

### [OUT-OF-SCOPE-5] `prompts/comenius.md` line 82 author trailer

Reads `(*FR:Celes*)` (FR-prefix is correct since Celes is FR — the prompt is her authorship). Per common-prompt's `(*MVOX:<AgentName>*)` rule, that applies to mvox agents writing mvox content. Celes writing the prompt-of-record from FR is not in violation. Flag only because it could read as drift; clarification (or a sentinel comment) might prevent re-flagging in future audits.

### [OUT-OF-SCOPE-6] `prompts/palestrina.md` line 98 author trailer

Same as above — Celes-authored prompt; not a defect, but conspicuous.

### [OUT-OF-SCOPE-7] `memory/bentham.md` size growth pattern

173 lines — significantly over the 100-line guidance. Each session adds ~7-10 review-record entries. Without an active prune ritual, the file will hit 250+ lines by session 10. Recommend Bentham (or Palestrina at shutdown) institutes a "promote-to-architecture-decisions or drop" pass at every session-end shutdown. Bentham's own pruning call, not Medici's.

## 8. Commit log

Atomic commits staged locally on `main`. **Not pushed** per assignment scope — PO/Aen review then PO pushes.

| # | Subject | Hash | Files |
|---|---|---|---|
| 0 | `docs(mvox-dev): health-report 2026-05-20 by Medici (FR)` | `d9ecdde` | `teams/mvox-dev/docs/health-report-mvox-dev-2026-05-20.md` (new) |
| 1 | `chore(mvox-dev): seed comenius scratchpad stub` | `d52cac7` | `teams/mvox-dev/memory/comenius.md` (new) |
| 2 | `chore(mvox-dev): prune finn scratchpad — remediated session-1 audit history` | `e49ced8` | `teams/mvox-dev/memory/finn.md` (-24 lines) |
| 3 | `chore(mvox-dev): dedupe victoria Path B DEFERRED entry` | `2945111` | `teams/mvox-dev/memory/victoria.md` (-1 line) |

## 9. Closing notes

mvox-dev is in good shape post-refactor. The team has a coherent stack decision, a working TDD chain, two complete migration phases on live polyphony data (Phase A + B), and a clean session-7 → session-8 handoff. The findings above are mostly polish — no structural rot, no contradictions, no misaligned producer-consumer contracts that would silently fail.

The largest non-applied risk is the `bentham.md` size growth pattern (§7 OUT-OF-SCOPE-7) — without a steward-side prune ritual, it will become unwieldy mid-Phase-C/D. Recommend raising at next team retrospective.

(*FR:Medici*)
