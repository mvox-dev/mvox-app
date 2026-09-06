# Pérotin Scratchpad

(*MVOX:Perotin*)

## [DONE] #265 roster_record shape proposal — posted, awaiting Mihkel's shape review (2026-09-06)

Full proposal posted: https://github.com/mvox-dev/mvox-app/issues/265#issuecomment-5561658869.
Condensed for future-me:

- **Branch (i) confirmed, not the two-entity fallback.** Source-read `entu-api` proves per-property
  `sharing` is resolved inside the per-property loop (`aggregate.js:112-120`), independent of
  sibling prop-defs on the same type; `cleanupEntity` (`entity.js:569-612`) serves the caller's
  tier-appropriate bucket. Live-corroborated on polyphony with a throwaway `_probe_mixed_sharing_265`
  type (one prop-def public, one private, one instance) — a genuinely ANONYMOUS read (no auth
  header, standing in for "domain-tier caller with no specific grant," since I can't authenticate
  as a real second member solo) showed the public field present and the private field COMPLETELY
  ABSENT. Full teardown confirmed (type re-GET 404). Ledger: `scripts/migrations/seed-results/
  probe-265-mixed-sharing-live-2026-09-06T19-36-05Z.json`.
- **[GOTCHA] surfaced by the probe, now load-bearing for every future mixed-sharing type**:
  omitting `_sharing` on a prop-def does NOT default to private — it auto-INHERITS the parent
  TYPE's own sharing at create time (`inheritParentProperties`). My first private-tier prop-def
  attempt silently came back `public` until corrected with an explicit write. Every admin-only
  prop-def on a domain-shared type MUST set `_sharing:private` explicitly, never omit it.
- **Shape**: new type `roster_record` (name echoes Mihkel's own "nimekirjakiht"), parent =
  `organization` (matches `member`'s own canonical shape, live-verified — on mvox_crede's
  single-collective model this resolves to the db entity itself, same as the R2 toggle's home),
  `person` reference + `name`(domain, required) + `phone`(private, required) + `email`(private,
  optional) + `birthdate`(private, optional, `type:datetime`). Type `_sharing:domain`,
  `inheritsRights:true`, `creators: parent_right _editor` — reuses the existing org owner/editor=
  admin rights model with zero new mechanism (verified against `entity.js`'s `_parent`-reference
  create-time check + `aggregate.js`'s rights-combine step, both already read for #264).
- **R2 toggle**: `roster_show_real_names` (boolean) on the organization/collective entity,
  `_sharing:domain` (every member's client needs to read it to render the roster; write needs no
  new mechanism, existing org rights already gate writes to the collective entity).
- **Provisioning**: type + both new properties may land on BOTH dbs (empty structure); real
  personal data blocked from mvox_crede pending Mihkel's all-test-data answer — restated verbatim,
  not assumed.
- **R4/R3**: design notes only (prefill = one-time plain-value copy at create, never a formula —
  formulas can't "compute once then freeze"; R3 = documented future contract, nothing built).

## [PROBE-RESULT] #264 item 6 — `_inheritrights` absence ≡ false, not inherit-by-default (2026-09-06)

Read-only, source-verified (`~/projects/entu-api`), reported to team-lead. **Corrects my own
older "absent default = true at create" note below** (Entu platform mechanics section) — that was
half-right and needs the missing condition attached:

- **CREATE-time** (`entity.js` `inheritParentProperties:296-325`): if the client's POST omits
  `_inheritrights`, the server auto-fills `true` on the new entity **ONLY IF at least one of its
  `_parent` targets already carries `_inheritrights.boolean === true`** at that moment. If no
  parent has it true, nothing is written — the property stays genuinely ABSENT, not defaulted to
  anything.
- **AGGREGATE-time** (`aggregate.js:168`): the parent-rights cascade (materializing `_parent_*`
  fields from the parent's `_owner`/`_editor`/`_expander`/`_viewer`) fires only on a strict
  `_inheritrights?.at(0)?.boolean === true` check. **Absent and explicit `false` are behaviorally
  IDENTICAL here — there is no inherit-by-default state.**
- **Propagation-time** (`aggregate.js:512`, re-queueing children when a parent's rights change):
  same strict `true` gate. A child sitting at absent/false is silently skipped forever — no
  self-healing on a later parent-rights change.

Live mvox_crede: db entity `_inheritrights:true` (platform's own `setupDatabase.js:110` bootstrap
default, not mvox's choice). ALL 7 sections show it explicitly `true` — NOT because
`sectionActions.ts` sets it (confirmed it doesn't), but because the create-time auto-fill kicked
in: every section's parent IS the db entity, which already carries `true`. polyphony spot-check
came up EMPTY — 0 `section` AND 0 `organization` instances live right now (confirmed via both
`_type.string=` and `_type.reference=`, not a query miss) — a substantial reset since my last full
audit that I didn't chase (out of scope here); checked `member` instead (only 2 live), both
`_inheritrights:true`, consistent with the same mechanism.

**Verdict passed to team-lead**: no live rights hole TODAY (the auto-fill happens to rescue
`sectionActions.ts`'s omission every time, because every section's parent is the db entity and the
db entity is true) — but it's a genuine unasserted dependency, not a designed default. Recommended
`sectionActions.ts` set `_inheritrights:true` explicitly (matching `inviteData.ts`'s existing
practice) rather than resting on an unwritten platform behavior team-lead's call whether that
earns its own issue.

## [DONE] #264 Soprano II `_parent` duplicate repair — LIVE, single-op, verified (2026-09-06)

PO-authorized (issue #264 REPAIR AUTHORIZATION comment) + team-lead's explicit "I authorize this
run": minimal single-DELETE variant (not the atomic-overwrite alternative). Guard read matched
exactly (both duplicate value ids present, no drift since stage-1) → `DELETE /property/
6a9d32a9ca67df980f41742e` → 200 → fresh read-back confirms Soprano II holds exactly ONE `_parent`
(`6a9d31cbca67df980f417425`, referencing the mvox_crede db entity) → all 7 sections' member counts
byte-identical before/after (5/4/4/3/1/3/1) — this op has no mechanism to touch membership, so
identity was the only expected result. Ledger written (not committed — tree is mid-#262-pipeline
on `feat/262-schedule-items-ui`, folding in at the next `main` seam):
`scripts/migrations/seed-results/repair-264-soprano-ii-parent-dedup-live-2026-09-06T09-56-38Z.json`.
Posted read-back verification as a comment on #264 myself (repair execution record convention):
https://github.com/mvox-dev/mvox-app/issues/264#issuecomment-5558468188. **Honest note, not
chased**: live-queried counts (Soprano I=5) don't match the issue's originally-cited 9/4/4/3/1
snapshot from report time — section `_parent` dedup can't move membership counts either way, so
this is someone else's drift to track, not a defect in this repair.

## [PROBE-RESULT] #264 stage-1 read-only round on mvox_crede (2026-09-06)

Read-only investigation (no writes), reported to team-lead by SendMessage (not posted on the
issue — team-lead composes the stage-1 report). Three findings:

1. **Soprano II holds a stranded duplicate `_parent`, confirmed live.** `_id 6a92a445...156a0`
   carries TWO `_parent` property-values, BOTH `reference: 6a8f471a...e5112` (the mvox_crede db
   entity — i.e. Mihkel's manual repair correctly landed Soprano II back at top-level), but as two
   DISTINCT property-value `_id`s (`6a9d31cb...7425` and `6a9d32a9...742e`). Soprano I (`_id
   6a92a444...15691`) has exactly ONE clean `_parent` value, untouched. This is the invisible
   damage mechanism (A) predicted — confirmed, not hypothetical. [speculative, beyond the raw
   read]: reads as Joosep's original indent leaving the pre-indent db-entity-ref value stranded
   (its paired DELETE denied) while ALSO landing a new Soprano-I-ref value; Mihkel's later manual
   outdent then added a THIRD, fresh db-entity-ref value without knowing to also clean up the
   original stranded one — netting two identical-target values instead of one.
2. **Joosep's actual rights are `_editor` (not `_owner`) uniformly, granted ONCE at the root and
   cascading down** — NOT missing expander/owner-class rights at the collective as mechanism (B)
   framed it. Confirmed via 3 direct entity reads: the mvox_crede db entity's OWN `_editor` array
   lists Joosep Loidap (`_id 6a92a3fd...565d`) as a direct (non-`inherited`) grant; Soprano I and
   Soprano II both show Joosep in `_editor`/`_expander`/`_viewer` with `inherited: true`
   (cascading via `_inheritrights: true` all the way down from the db entity). He appears in NO
   entity's `_owner` array. Per the established rights-tier model (`_editor` grants POST-
   props/DELETE-prop-value, sufficient for a plain reference-property write like `_parent`), this
   should in principle suffice for all four write kinds Gama enumerated — **which means mechanism
   (B) as stated doesn't match what the private bucket shows.** Flagged to team-lead as a genuine
   open puzzle for the code-research workflow, not resolved by me: something else in the write
   path (BFF-side check, an Entu reference-property rule I haven't previously observed, or a
   mis-surfaced error) must be the actual gate — not a bare insufficient-grant reading.
3. **Live mvox.eu is ≥ #253 (and ≥ #259).** No commit SHA is served in the HTML/JS (Path C SPA
   shell is the same for every route; roster's own lazy chunk never loads under an unauthenticated
   curl, so I couldn't hash-match at that granularity). `/_app/version.json` gives a build
   timestamp (`1788683384954` → 2026-09-06T08:29:44Z) that postdates BOTH #253 (2026-09-05
   11:29:22Z) and the most recent roster-touching commit, #259 (2026-09-06 01:24:59Z) — cross-
   referenced against `git log` timestamps, not asserted from the number alone. Current main HEAD
   (`94b2033`, #262 work) is ~1h AHEAD of the live build timestamp — expected, that pipeline hasn't
   deployed yet. `wrangler pages deployment list` timed out (no interactive CF auth in this
   shell) — didn't chase further since the timestamp cross-reference already answers the question
   cleanly.

## [DONE] Schema-of-record home proposal — filed as #263, ruled, follow-ups landed (2026-09-06)

Dispatched by team-lead to draft the durable schema-of-record home proposal (common-prompt.md
"Schema Evolution" item 5, open since the 2026-09-06 upstream-retirement ruling), building on the
#246 premise-check/salvage plan below and grounded in a fresh read of how #246 actually landed
(`0a6e946` def+docs, `1d088d4` primitive+seed). Full comment-ready text sent to team-lead for
routing to Gama; condensed here for future-me:

1. **Type-definition home**: ratify the shape #246 already proved, don't re-design — `scripts/
   migrations/lib/mvox-schema-extensions.ts` (definitions, `MvoxEntityDef` per type) + `docs/
   architecture/mvox-schema-extensions.md` (narrative companion) + `scripts/migrations/lib/ensure-
   schema-type.ts` (idempotent type+prop-def CREATE primitive). Confirms the workspace-app-native
   lean from the earlier draft over the "second entry in entu-research's setup-entity-types.ts"
   alternative (rejected — still cross-repo/cross-team, just a side door).
   **Drift flagged in passing**: `seed-246-*`'s ledgers write to `scripts/migrations/ledgers/`, not
   `seed-results/` (my own prompt file's named convention) — happened without a deliberate call,
   surfaced for a decision (dedicated location for type-provisioning runs vs. fold back into
   `seed-results/`).
2. **Flow for future types**: commission (PO sign-off on issue) → define (`MvoxEntityDef` +
   narrative section, one PR, `PO-Approved:` trailer, no live mutation) → provision (one `seed-
   <issue#>-<type>-type-<db>-<date>.ts` PER target db, composing `ensure-schema-type.ts`'s existing
   primitives — no new tooling needed unless a genuinely new wire-shape appears) → dry-run then
   live per-db under the standing authorization gate → ledger per run.
3. **Commissioning issue vs. durable record**: split cleanly — the issue is the **adjudication**
   record (debate, ruling, concessions — doesn't change once settled); `mvox-schema-extensions.ts`/
   `.md` is the **shape-of-record** (current truth, kept in sync with what's provisioned). Each
   `MvoxEntityDef.commissionedBy` is the permanent pointer from shape back to adjudication.
4. **mvox_crede-inclusion default** — named as a SEPARATE open question, not resolved by 1–3:
   should new types auto-provision onto mvox_crede alongside polyphony, or does every type need an
   explicit separate call? Recommended: **no default-yes** — #246 itself named both dbs explicitly
   rather than assuming inclusion; keep that deliberate checkpoint.
   ~~given mvox_crede's real-PII posture~~ **[CORRECTED 2026-09-06]**: my original grounds cited
   mvox_crede's real-PII posture — #263's ruling on this point explicitly declined that premise
   (unconfirmed-pending-Mihkel, see the register + Session MVOX-12 correction below). The
   no-default-yes recommendation still stands, ratified, but on **commission-audience grounds**
   instead (every new type getting a deliberate per-db call is good practice for a distinct
   real-world pilot deployment regardless of its data-sensitivity status) — not on an unconfirmed
   PII claim.

Not self-posted anywhere — draft only, routing is team-lead/Gama's call. **[RULED 2026-09-06,
#263]**: all four points approved, home proposal ratified as #246 proved it. Two follow-ups
landed: ledger fold-back (#246's 4 ledger files moved `ledgers/` → `seed-results/`, path refs in
both seed-246 scripts updated) and this privacy-register correction.

## [DONE] #246 schedule_item — home settled, built, seeded LIVE on both dbs (2026-09-06)

Gama SETTLED the home proposal below point-by-point (approved as recommended,
`(a)` workspace-app-native / definition-in-this-repo). Executed end-to-end same
session: `scripts/migrations/lib/mvox-schema-extensions.ts` (definition, local
`MvoxEntityDef` vocabulary, no schema.ts import) + `docs/architecture/mvox-
schema-extensions.md` (narrative, salvaged README prose adapted) + NEW
`scripts/migrations/lib/ensure-schema-type.ts` (idempotent type+prop-def CREATE
primitive — meta-type ids resolved PER-DB via query, never hardcoded; confirmed
live that polyphony (`69bcfd8e...8034`/`...8048`) and mvox_crede
(`6a8f471a...50cc`/`...50e0`) genuinely differ, as expected for distinct dbs).

Dry-run clean on both dbs → team-lead's dispatch itself carried the explicit
"I authorize this run" (both dbs named) → live 4/4 clean on both:
- polyphony: type `6a9ccea4ca67df980f4173c5`, name `...73d0`, datetime `...73df`
- mvox_crede: type `6a9cceabca67df980f4173ee`, name `...73f9`, datetime `...417408`
Both `add_from: event` wired. Independently read-back verified (fresh GETs, not
script self-report) + idempotency re-confirmed (post-live dry-run reports
found/already-wired on both, no dupes).

**One correction against the salvaged draft**: schema.ts's literal declared
`sharing: 'public'` (aspirational). Live-probed `program_item` (the sibling
"identical rights posture" is measured against) — its actual type-def
`_sharing` is `domain`, not `public`. Created schedule_item at `domain` to
genuinely match the ruling's intent over the stale literal field. Also set
`add_from: event` live for schedule_item even though live `program_item`
itself lacks that wiring (observed gap in the sibling, not replicated).

2 commits (`0a6e946` def+docs, `1d088d4` primitive+seed+ledgers), both pushed,
both `PO-Approved: 2026-09-06 mvox-app#246`. Completion comment:
https://github.com/mvox-dev/mvox-app/issues/246#issuecomment-5556340832

Superseded the [WIP] draft below (kept for the premise-check + salvage-plan
reasoning, which held up unchanged through execution).

## [WIP] #246 schedule_item — mvox-side home proposal, DRAFT ONLY, parked on PO wake (2026-09-06)

Ruling change: Mihkel — "the PR at entu/research is out of place — we shouldn't bother to adjust
the upstream V4E schema." entu/research#54 closed (branch `feat/v4e-schedule-item` kept). No
mutation, no issue post — this is queued for team-lead to relay once PO confirms.

**Premise-check before drafting (same-turn read, not recall)**: team-lead's framing cited
`mvox_collective` as an "already skips entu/research" precedent for a mvox-side home. Verified this
is only half true. `mvox_collective`'s definition lives INLINE in
`~/projects/entu-research/scripts/setup-entity-types.ts` (authored `(*ER:Codd*)`, lines ~3097-3106,
self-disclosed via its own description: "App-level marker entity... not part of the canonical v4E
schema" / "ei kuulu v4E baasstruktuuri hulka"). "Skips the entu/research flow" has only ever meant
skips `schema.ts` + PR + `Schema-Change`/`PO-Approved` trailers — not "lives outside entu-research."
The literal precedent is still a foreign-repo, foreign-team-owned file. Flagged this to team-lead
as the crux of (a) below rather than silently following the precedent as stated.

**(a) Where the definition lives as record — recommend workspace-app-native, not the literal
mvox_collective route.** New file, e.g. `scripts/migrations/lib/mvox-schema-extensions.ts` (or a
docs-flavored `docs/architecture/mvox-schema-extensions.ts` if that reads better to team-lead),
holding the `schedule_item` object literal in the same `EntityDef`-shaped vocabulary the team
already reviewed on #246 (`parents`/`properties`/`creators`/`notes`) — reused as familiar
documentation shape, not imported from `schema.ts` as a real dependency (`creators`/`parentCard`
are pure documentation even in real v4E, per `entu-api` source — nothing is lost by not binding to
the actual module). **Alternative, stated fairly**: add `schedule_item` as a second inline entry
next to `mvox_collective` in entu-research's `setup-entity-types.ts`. Real advantage — reuses the
ALREADY-proven, single, idempotent provisioning pipeline (3963 lines, battle-tested across
polyphony + the 2026-08-27 crede provisioning) instead of building a second type-creation capability
from scratch; one operator script instead of two. Real cost — still touches a different team's file
in a different repo, the same cross-repo dependency shape the PO just called out, just via a side
door instead of the `schema.ts` front door. Recommending against it given today's explicit
"mvox evolves its own schema" framing, but naming the cost honestly since it's not a slam dunk.

**(b) Seeding flow for polyphony/mvox_crede.** Correcting the dispatch's premise: I have no "usual
setup-entity-types.ts pattern" — that tool is Codd's/entu-research's, not mine; I've never authored
one. Every script I've shipped in `workspace-app` is instance-level (widen sharing, seed rows,
retire/delete) — full type-def + prop-def creation from scratch isn't something I've built here.
The one prior tool that DID do this (`lib/v4e-translator.ts`) exists only in the legacy `~/workspace`
repo (Phase B/C/D era), never migrated to `workspace-app`. If (a) lands workspace-app-native, the
live-creation capability is new work: a type-def CREATE (`_type.reference` → the "entity" meta-type
`69bcfd8e9c031ab8e6ce8034`) + two prop-def CREATEs (`_type.reference` → the "property" meta-type
`69bcfd8e9c031ab8e6ce8048`, each carrying its own `entity`/`name`/`type`/`sharing`), idempotent
check-then-create — same discipline as every seed script I've shipped, just a new primitive (type
level, not instance level). Run independently per db (Entu type catalogs are per-db — confirmed by
`setup-entity-types.ts`'s own design, "run against the new database"): once against polyphony, and
against mvox_crede only if PO actually wants the type there — real-pilot collectives don't
automatically inherit every schema addition, flagging not deciding. A second use of the
type+prop-def CREATE primitive would trigger my standing toolkit-extraction practice — propose to
Josquin then, not build into his lib pre-emptively.

**(c) Shape changes, app-extension vs canonical v4E.** None functional: same 2 required properties
(`name`, `datetime`), same rights posture (`parent_right _editor`), same `_sharing` cascade, no
`ordinal` — all survives untouched. Only the documentation layer changes: mirror `mvox_collective`'s
own self-disclosure convention — description states outright "mvox app extension, not canonical
v4E" (bilingual EN+ET, matching the established description convention). Side effect worth flagging:
the closed branch's README diff also drafted a full narrative section (entity-catalog entry, org
tree line, rights-matrix row, bucket-exposure row — all written, see (d)) that has no natural
canonical home once this leaves `schema.ts`. Not required for the type to function; worth a
deliberate call on whether an equivalent narrative belongs in `docs/architecture/` rather than
silently dropping it.

**(d) Closed branch's text — salvage plan.** `feat/v4e-schedule-item` @ `e460fb7` (entu-research)
already carries the FULLY UPDATED object literal with my ordinal-drop ruling baked in verbatim
(verified via `git diff main..feat/v4e-schedule-item` — the note already reads "no `ordinal`
(mvox-app#246 ruling: ...)"), so no further editing needed before lifting it. Salvage: (i) the
`schema.ts` diff's `schedule_item: EntityDef` object literal (~32 lines, drop only the surrounding
`SCHEMA`-array wiring, which is `schema.ts`-specific) → lands verbatim in whichever home (a)
settles on; (ii) the `README.md` diff's prose (entity-catalog `#### schedule_item` section, org-tree
line, rights-matrix row, bucket-exposure-table row — all already written) → candidate content for
the (c) narrative-home decision if PO wants one; (iii) `schema.json` diff is a generated artifact of
`schema.ts`, not needed if `schema.ts` stays untouched. Once both diffs are copied out, the branch
has no remaining utility — delete it (team-lead's call/access, not mine; no entu-research write
scope here and this is draft-only).

## [DECISION] #246 schedule_item — ordinal conceded/dropped (2026-09-05)

Gama's named challenge: "name a case where display order must diverge from chronological order, or concede." Tested 4 candidates (simultaneous items, whole-day/no-time items, retrospective reorder-after-time-change, multi-day) — all either resolve via the `name` tie-break already on offer or don't apply to `schedule_item`'s semantics. Conceded. Settled shape: `schedule_item{name: string required, datetime: datetime required}` — no `ordinal`, sort by datetime + name tie-break. Two required props (was three), converges with Mihkel's minimal-change steer independently of the #253-renumbering argument. `event.start_datetime` unchanged (required, directly writable, sole sort key) — formula-over-children route stays disqualified per #233 (formula overwrites unconditionally + silently drops POSTs). Comment: https://github.com/mvox-dev/mvox-app/issues/246#issuecomment-5554613242. Schema not yet landed — `entu/research` PR is team-lead's to author next; no seed until it merges.

## [CHECKPOINT] Schema sitting 2026-09-05 — #246/#242/#256 (read-only, in progress)

- **#246** (multi-time event, schedule-item child): posted `schedule_item` sketch mirroring
  `program_item` (parent=event required 1/0..N, `name`+`datetime`+`ordinal`, `creators: parent_right
  _editor`, `_sharing` cascades). Flagged open question: `event.start_datetime` should stay as-is
  (directly writable, sole sort key) rather than become a formula deriving MIN(child datetimes) —
  ties directly to the #233 finding (formula unconditionally overwrites, no compute-when-empty; a
  formula can't be conditionally present only on events that have schedule_item children). Comment:
  https://github.com/mvox-dev/mvox-app/issues/246#issuecomment-5550986002

- **#242** (standalone-event default type): verdict NO SCHEMA — verified `eventCreateType =
  $state('rehearsal')` (`+page.svelte:3213`, reset at `:3342`/`:3379`) is a hardcoded literal;
  vocabulary (`CANONICAL_EVENT_TYPES`) is already app-owned (`eventTypeLabels.ts`), `event_type` is
  free-text on the wire with no schema vocabulary property. Mihkel's "requiring schema migration"
  framing does not hold — pure Svelte default-value change. Comment:
  https://github.com/mvox-dev/mvox-app/issues/242#issuecomment-5550988505

- **#256** (lingikogu / link collection, collective-level, Mihkel-ruled canonical): posted `link`
  sketch — parent=organization required 1/0..N, `name`+`url`(string, matches `website`/
  `external_link` precedent)+`description`(text)+`display_order`, `creators: parent_right _editor`
  (flagged as a guess, not a decision — issue's own open Q1 admin-vs-member unresolved). Comment:
  https://github.com/mvox-dev/mvox-app/issues/256#issuecomment-5550990189
- **All three schema-sitting items done, read-only, nothing built, no mutation.**

## [PATTERN] Ledger fields: record observed, not intended (2026-09-02, Bentham review of #20)

Routed to find the #20 widen-member-refs live ledger for Bentham's open carry item — it existed
(`seed-results/widen-member-refs-2026-08-07-live-2026-08-07T15-24-56-647Z.json`, commit `241ea1a`)
but had never reached him. Sent it; **verdict GREEN, carry closed.** Bentham verified against the
raw file rather than my summary (his standing calibration) and it held up — worth noting the
critique he sent back, since it's a real gap in my ledger-writing habit, not just this run:

`propDefEntries[].name` in that ledger is the script's own label copied from `PROPDEF_TARGETS`,
**not** a value read back from the entity — it only attests a POST landed at that id, not that the
id's name matches. The actual identity proof lived in a separate function
(`verifyPropDefsAbsent`, a live pre-write check that refuses on name mismatch) that wasn't
reflected in the ledger schema itself. Bentham cross-checked parentage against an independent
same-week probe (`probe-48-structural-inventory-2026-08-08`) rather than re-running a live query,
which is the right no-live-ops way to settle it.

**Going forward**: when a ledger field could be read either as "what we intended to hit" (a config
constant echoed into output) or "what we observed" (a live read-back), name/shape the field so a
reader can tell which without reading the source — e.g. `propDefTargets` (intended) vs
`propDefTargetsVerified` (post pre-write check) as separate keys, not one ambiguous list.

## [CHECKPOINT] Session MVOX-12 startup (2026-09-01) — mvox_crede gap surfaced

> **[CORRECTION 2026-09-06, #263 PO ruling]**: the bullet below asserts "mvox_crede is real, not
> synthetic" / "real member names + real emails" as settled fact. Gama's #263 ruling explicitly
> did NOT ratify that premise — the standing record is Mihkel's all-test-data correction; a
> posture change (declaring mvox_crede's data real) is his to make, surfaced through the PO
> channel, not something I should treat as confirmed off a runbook read. Read this entry (and the
> "CREDE PII audit" entry below it) as **unconfirmed-pending-Mihkel**, not asserted fact, until his
> word lands. The precautionary actions taken under the old premise (externalizing seed-186's
> name/email fields, gitignoring `seed-results/` for CREDE runs) stay in place — caution costs
> little and reversing it isn't urgent — but don't cite "mvox_crede holds real PII" as settled
> going forward. (*MVOX:Perotin*)

Fresh spawn. Standing-concerns scan found two things not yet in this scratchpad:

- **mvox_crede is real, not synthetic** [now: unconfirmed-pending-Mihkel, see correction above].
  Per `docs/runbook/provisioning.md` + team-lead.md:
  a second live Entu database, "Kammerkoor Crede" (real choir pilot), provisioned 2026-08-27,
  re-seeded clean 2026-08-29 — 21/21/21 person/member/profile, 7 sections, 19 menus, 1 library,
  41 events. Migrated from polyphony.uk (their prior Cloudflare/D1 system) — **real member names
  + real emails**, not `@example.ee` synthesized data. This is a materially different privacy
  posture from everything else in this file's privacy-boundary register (all polyphony-scoped,
  all synthetic) — treat any mvox_crede-targeting script as real-PII from now on. Runbook itself
  is PO-authored (`*PO:Gama*`), not mine, but I execute against it — cross-ref for future me.
  `scripts/migrations/seed-results/` was gitignored for this reason (commit `fa9ec16`, #185):
  seed reports may carry real names/emails, so the "every run produces a committed result
  artifact" half of my standing convention (common-prompt / perotin.md core responsibilities)
  no longer applies to mvox_crede runs by design — the SCRIPT (no PII) still should be committed.
- **6 CREDE seed scripts sit uncommitted** on disk right now: `seed-178-crede-members-2026-08-27.ts`,
  `seed-182-crede-sections-2026-08-27.ts`, `seed-184-crede-members-menu-2026-08-27.ts`,
  `seed-186-crede-profile-emails-2026-08-27.ts`, `seed-187-crede-content-menus-2026-08-27.ts`,
  `seed-188-phase3b-crede-sections-2026-08-29.ts` — all untracked (`git status` `??`), despite
  team-lead.md recording live runs for #178/#182/#184/#186/#187/#188 already landed against
  mvox_crede. The git audit trail for this work is currently incomplete. Flagged to team-lead,
  not self-committed — current tree is on `feat/199-event-type-localized-picker`, not `main`
  (single-tree serialization protocol: not my branch to touch).

## [CHECKPOINT] CREDE PII audit + redaction plan sent (2026-09-01)

Full read-through of all 6 uncommitted CREDE scripts (team-lead's pre-commit PII guard had
already caught one). Only `seed-186-crede-profile-emails-2026-08-27.ts` has inline PII: a
20-row `TARGETS` array hardcoding real full names + real personal emails. The other 5
(178/182/184/187/188) are clean — either read PII at runtime from an already-gitignored
`scripts/migrations/snapshots/*.json` (178) or contain only Entu entity ids + non-identifying
config (182/184/187/188). Plan sent to team-lead: externalize seed-186's name+email fields to
`scripts/migrations/snapshots/crede-profile-emails-2026-08-27.json` (matches seed-178's existing
snapshot-read pattern; also flagged `seed-results/` as team-lead's alternative, equally
gitignored, their call). Also noted (not yet actioned): seed-186 is the only one of the 6 with
no `DRY_RUN` guard. Design only — no edits made, execution waits for a tree-free window between
pipelines (tree currently serves #199 branch work).

**[DONE] Executed 2026-09-01, commit `d924e4d` (main, `16b857c..d924e4d`, pushed).** Ran the full
locked sequence as git actor once team-lead confirmed #199 merged + tree clean on `main`:
redacted seed-186 (`TARGETS` name+email → `scripts/migrations/snapshots/crede-profile-emails-
2026-08-27.json`, `personId` inline, `readFileSync`+`JSON.parse` per seed-178 pattern, added the
`DRY_RUN` guard it lacked) → grep-verified zero residual PII in the .ts → lifted both `309bc9b`
gitignore shield lines → staged the 6 scripts + `.gitignore` **by explicit path** (no `-A`/`.`,
per team-lead's instruction to not collide with Bentham's parallel `architecture-decisions.md`
edit) → confirmed `git diff --cached --stat` matched intent → committed → pushed → confirmed
`git status --porcelain` empty post-push. Audit-trail gap for #178/#182/#184/#186/#187/#188 is
now closed. Snapshot JSON stayed gitignored throughout (verified via `git check-ignore` both
before and after the shield lift).

## [PROBE-RESULT] Invite-acceptance grants NO self-`_editor` (2026-09-01, read-only, #193)

Dispatch asked me to live-GET a polyphony invite-created person's `_editor` set. Halted the live
probe before running it — two premise problems: (1) the only candidate (#189/#191, Joosep Loidap)
is `mvox_crede`-scoped, not polyphony; (2) Joosep's self-`_editor`, even if present, would be
contaminated evidence — #189 step 2 is an explicit manual `POST _editor:self` done by our own
mint script BEFORE redemption, so a live read can't distinguish "Entu's invite-acceptance branch
grants this" from "we granted it ourselves." Read `~/projects/entu-api/routes/auth/index.get.js`
source instead — settles it without live data: `createUserForAccount` (auto-provision, L289)
ends with an explicit `setEntity(..., [{type:'_editor', reference: person._id}])` (L330,
Finn's existing citation); `replaceInviteWithCredentials` (the actual invite-ACCEPTANCE function,
L279, invoked from the `query.invite` verify branch ~L216/223) only swaps the invite-marker
`entu_user` prop for real OAuth creds — **zero `_editor` involvement anywhere in that function or
its callers.** Verdict: auto-provision grants self-`_editor`; invite-acceptance does not. This is
already correctly reflected in `docs/architecture/invite-flow.md:44` as **[CONV]** (mvox's own
`inviteData.ts` grants it at MINT time, not Entu at redemption) — my read just adds the missing
`[SRC]` proof for that line (not applied — outside my write scope, flagged to team-lead/whoever
owns that file). No findings-doc written: `docs/migration/findings/` no longer exists in this
repo (confirmed empty, stale legacy-repo convention) and the canonical home already covers this.

## [CHECKPOINT] #132 _inheritrights mutation HALTED — premise mismatch (2026-08-13)

Authorized single-entity mutation (EFK org `69c7f8718489bfcb0e81b065`, `_inheritrights`
false→true, for epic #132 rights-inheritance design) — probed before writing, found the value
**already `true`** (`_id` `6a7dc25923dc1d97bb8f20d1`). Dispatch's stated premise ("live db has
`_inheritrights: false` on all org entities") is wrong for this entity. Halted, no write, posted
evidence to issue #132, reported to team-lead. Did not extend scope to check other orgs (single-
entity authorization, not a batch). Reinforces the standing discipline: probe-before-write catches
premise drift the dispatch text can't see.

> Pruned 2026-08-08 (session "MVOX") from ~470 to this. Full session-by-session history lives in
> git history of this file. Durable facts kept below; per-run narrative dropped once its own
> committed artifact / findings doc / issue-comment thread carries the detail.

## [CHECKPOINT] #127 Baritone follow-up — consolidate+nest+delete, LIVE, complete (2026-08-13)

PO's ruling on Baritone flip-flopped twice in one session — worth recording the sequence since
it's a good example of "scope corrections after dry-run are normal, re-run don't argue": (1)
initial ruling "keep standalone, untouched"; (2) changed to "nest under Bass" — I built an
ADDITIVE dual-parent script (both RAM+TAM Baritone get a second _parent to Bass/EFK, no merge),
dry-ran it, sent for authorization; (3) team-lead relayed a further PO correction before I got
authorization — "consolidate first, then nest, one surviving Baritone, not two". Rewrote the SAME
script file (same filename, `git commit` history preserves both versions) to the
consolidate-then-nest-then-delete pattern (identical shape to the main #127 script's
RETIRE_TO_SURVIVOR + nest + not-empty-gated-delete). Never ran the additive version live — only a
superseded dry-run ledger exists for it (commit `bb7cfd9`). Live-executed the corrected version
(commit after `6a4cfea`) after fresh authorization: 7/7 ok, TAM Baritone's 2 members → RAM
Baritone (1 was already dual-linked from the original data mess — "mibiri" — deduped, only 1
genuinely new move), RAM Baritone nested under Bass/EFK, TAM Baritone deleted. Independently
verified: 0 dangling refs, 241 members unchanged, RAM Baritone now 19 (not 20 — mibiri was
already counted in the original 18). Full report:
https://github.com/mvox-dev/mvox-app/issues/127#issuecomment-5276352494
**#127 is now fully done**: 17 sections → 12 (Soprano/Alto/Tenor/Bass EFK-anchored with 7 nested
sub-sections including Baritone under Bass; Admin untouched). Only remaining checklist item
(F2+F3 TU.6 re-verification) is outside data-manager scope, flagged twice now, not chased further.

## [CHECKPOINT] #127 section cleanup — Phase 2 LIVE, complete, verified (2026-08-13)

Executed `scripts/migrations/section-cleanup-127-2026-08-13.ts` with `DRY_RUN=false` after
team-lead's "I authorize this run". 53/53 ok, 0 failed, 0 aborted. Full result + independent
post-execution verification (fresh queries, not just the script's self-report) posted to
https://github.com/mvox-dev/mvox-app/issues/127#issuecomment-5272996731 — not re-narrated here.
Durable facts:
- **17 sections → 13**: 4 orphan sections deleted (RAM Bass, TAM I/II Tenor, TAM Bass), all
  gated on a live re-check finding zero members still linked before delete.
- **0 dangling `_parent` refs** to the deleted section IDs across all 241 members (full re-scan);
  **241 members unchanged** — no loss/duplication. Consolidated counts matched predicted math
  exactly (e.g. Bass/EFK 14→24 = 14+24-14 dual-link overlap, confirming the #124-SPIKE-divergence
  read from Phase 1 was correct).
- Hierarchy nesting is ADDITIVE (`_parent` gains the new parent-section link, org-parent link
  stays) — Soprano I/II now `_parent=[Sireen org, EFK Soprano]`, same pattern for Alto I/II and
  RAM I/II Tenor under EFK Tenor.
- Baritone (RAM 18 + TAM 2) and Admin (1) confirmed untouched — same ids/counts pre/post, per
  PO ruling (no EFK equivalent for Baritone; Admin is a system fixture, out of scope for all 3).
- Script pattern worth reusing: Phase-0 drift check (re-verify every frozen id's name+org against
  live before any write) + retire→survivor map + additive nest map + not-empty-gated delete, all
  in one script, ledger-per-run. Clean template for the next "merge N near-duplicate entities into
  one canonical" task.

## [WIP] #127 section cleanup — Phase 1 investigation posted (2026-08-13)

Read-only, no writes. Full findings on issue #127 comment
(https://github.com/mvox-dev/mvox-app/issues/127#issuecomment-5272879201) — not re-narrated here,
just the durable facts:
- **17 sections exist, not 16.** Extra "Admin" section (EFK, `_sharing:public`, no `display_order`,
  1 member = db-root dev-admin fixture) wasn't in #124's SPIKE — system fixture, not a voice part,
  out of scope for A/B/C pending explicit call.
- **#124 SPIKE's member counts are stale** — live section↔member link counts diverge (RAM I Tenor
  15→13, Bass/EFK 0→14, etc.) because **15 member entities carry a stray `_parent` link into a
  DIFFERENT org's identically-named section** on top of their own-org link (14 on Bass: cluster of
  EFK+RAM+TAM members all also linked to `Bass/EFK`; 1 on Baritone: "mibiri"/EFK also linked to both
  `Baritone/RAM` + `Baritone/TAM`). Read as a partial, unfinished by-hand start on Step A's Bass
  consolidation (target = EFK's Bass entity), not corruption — old per-org link was never removed.
  **Lesson for counting section membership going forward: always compute "clean" (member's own
  org-parent == section's org) counts, not raw `_parent` link counts** — raw counts overstate.
- Proposed target structure (5 top-level + 4 nested = 9 survivors) posted to the issue, with
  explicit survivor entity IDs. **Open, not decided by me**: Baritone has no EFK equivalent (EFK=SATB,
  RAM/TAM=TTBB-style) — 3 options laid out on the issue (fold into Bass / keep standalone / delete +
  orphan the 11 RAM members), needs a PO/team-lead call before Phase 2 touches Baritone or the Admin
  section.
- Org structure for context: EFK+Sireen under umbrella Eesti Kammerkooride Liit; RAM+TAM under
  umbrella Eesti Meeskooride Liit — 4 independent peer collectives, EFK is the product-focus org per
  the single-collective pivot, not a structural parent of the other 3.
- Issue body's org names ("Voces Musicales, Collegium Musicale") are placeholders — don't match live
  data (real orgs: EFK/Sireen/RAM/TAM). Corrected on the issue comment.

## [CHECKPOINT] Session close 2026-08-12 — #117 TD.1 audit (read-only, no writes)

Full 3-dimension `_sharing` audit for epic #116 (member-seat readability), posted as two comments on
issue #117 (audit trail lives there, not re-narrated here): name visibility, entity type labels,
entity-level visibility. Feeds TD.2 (#118 name propdefs), TD.3 (#119 labels), TD.4 (#120 instance
visibility). Durable findings worth keeping independent of the issue thread:

- **Two root-cause classes for member-seat hex-IDs**: (a) no `name` propdef exists at all — by
  design (attendance/invitation/member/rsvp; member's identity path is via `member.person`, already
  domain-readable) — not fixable by a `_sharing` write. (b) `name` propdef exists, carries real
  values, but sits at private/absent tier (event/lending/library/organization/season/section) — same
  shape as the #20 roster-crash root cause and the T6.2 "propdef widen ≠ instance re-aggregation"
  lesson; needs BOTH a propdef `_sharing` write AND a re-aggregation touch-save sweep on existing
  instances.
- **`label` field 3-way split** (feeds TD.3): every type entity carries `name` (machine key, fine),
  `description` (already fully populated EN+ET for all 20 types — #48 work, NOT a gap), and `label`
  (short UI display name — the actual problem). Only `person`+`profile` have a correct short-bilingual
  `label`. The other 18 have exactly one value, **zero language tag** — 9 are short-but-untranslated
  (2 of those, repertoire_item/program_item, are raw un-humanized camelCase), 9 have the full
  `description` text duplicated into `label` instead of short chrome.
- **Event creation defaults to private**: 21/22 live events are `_sharing:private`; only one test row
  is public. Looks like the create path never sets `_sharing` explicitly — flagged to team-lead as a
  Josquin-territory question, not something I fixed (read-only task).
- **Library "empty for member" root cause is instance-level, not propdef**: the ONE `library` entity
  in the db is itself `_sharing:private` — that alone hides it regardless of the propdef state.
- **Organization structure confirmed via `_parent`**: 2 umbrella federations (Eesti Kammerkooride
  Liit, Eesti Meeskooride Liit) + 4 real collectives under them, no test/throwaway orgs, all already
  `_sharing:domain` — should all stay member-visible; only gap is the name propdef.
- **[GOTCHA] my own startup prompt has a stale path**: `perotin.md` startup step 4 points at
  `$REPO/docs/migration/findings/*.md` (`$REPO`=workspace-app) but that directory has zero git
  history in workspace-app — the two referenced findings docs (phase-b-api-probes-2026-05-20.md,
  entu-api-key-expiry-2026-05-20.md) only exist in the legacy `~/workspace` schema repo, never
  migrated in the 2026-08-07 split. Read them from there this session; flagged to team-lead, not
  self-corrected (not my file to edit under current scope rules). **Fixed this session** — team-lead
  committed `9991309` correcting the path.
- **[DEFERRED, not mine]** an uncommitted, read-only, all-PASS probe pair sits in the legacy
  `~/workspace` repo (`probes/probe-tr1-prereq-verify-2026-08-10.ts` + result artifact), authored
  Palestrina, apparently superseded by the already-merged `#78` (`4f5eef1`) in workspace-app. Flagged,
  not actioned — wrong repo, wrong author under the current split.

## [CHECKPOINT] Session MVOX-5 close (2026-08-09/10)

Four items this session, all committed to main, no active WIP:
- **#68 Phase 1+2**: inventory + backfill script done, STRUCTURALLY BLOCKED on first live canary
  (403 — see updated entry below). Awaiting a decision on mechanism, not mine to make. Script is
  ready to re-run as-is once one exists.
- **#70**: Configuration menu (Entities/Menu/Plugins) restricted to admin-only. LIVE, 3/3, done.
- **#48**: all 160 meta descriptions (20 types + 140 prop-defs, EN+ET) drafted + shipped LIVE,
  160/160, done. A delegated fork drifted off-task (wrote unwanted script files instead of content)
  and later stalled — drafted the content directly myself instead of waiting on it further.
  **[LEARNED]** for next time: for a bounded, well-specified content-drafting fork, set a tighter
  leash (or just draft directly) rather than trusting a >160-item structured-output task to run
  to completion unsupervised — verify its actual file output early, don't wait on a notification
  that may not come.
- **Urgent (unticketed)**: person type-def was missing `name`/`email` prop-defs entirely (breaking
  the Entu UI rights picker's search) — created both with `search:true`, matching organization's
  existing pattern. LIVE, verified. **Caveat flagged to team-lead, still open**: this only adds the
  searchable FIELD DEFINITIONS — the 132 existing person entities have no `name`/`email` VALUES to
  search against yet. Search will return empty until that's backfilled (separate task, not started).

## Repo location — IMPORTANT (2026-08-07)

Two distinct repos are in play:
- `~/workspace` → `mvox-dev/mvox_v4e_web`. Holds `teams/mvox-dev/` config + this scratchpad.
  Legacy/team-infra surface now — my May–early-Aug scripts live here (80 seed-results, 29 probes),
  but this is NOT where current app work happens.
- `~/workspace-app` → `mvox-dev/mvox-app`. **The live app.** `$REPO` for my live seed/probe
  scripts now resolves here (team-lead fixed `teams/mvox-dev/prompts/perotin.md` accordingly,
  commit 603b129). Scratchpad now at `~/workspace-app/teams/mvox-dev/memory/perotin.md` (team config
  moved to app repo 2026-08-07).
Cross-ref: `~/.claude/projects/-home-ai-teams/memory/mvox-app-slice1-resume-state.md` (team-lead's
auto-memory, authoritative cross-session resume vehicle — read that first, not this file, for
"what's the current state of the app").

## Entu platform mechanics (durable — verified empirically, cite findings docs for detail)

**Two DELETE endpoints, never interchangeable**: entity `_id` (incl. prop-def entities) →
`DELETE /entity/{id}`. Property-VALUE `_id` (one of a multi-valued property's values) →
`DELETE /property/{id}`. Conflating them caused two real bugs historically (Phase B v12, #56).

**POST APPENDS, never replaces.** All non-formula string/reference/boolean properties are
implicitly multi-valued. Replace semantics = DELETE existing value `_id`(s) first, then POST.
Applies to `_sharing`, `_inheritrights`, boolean flags, everything non-formula.

**CREATE requires explicit `_type`**: `{type:'_type', reference:'<type-entity-id>'}` in the POST
body — omitting it is a 400, and CREATE has no dry-run-visible failure mode (only surfaces live).

**Formula properties**: no `_id` on their value (virtual/computed). Cannot be directly written —
Entu accepts the POST (200) but immediately re-evaluates and silently overwrites. Materialized
formula values PERSIST after their SOURCE property is deleted (not recomputed on read) — re-eval
only fires on (a) prop-def formula-expression change, (b) any non-formula POST on the instance
("touch-save"), or (c) a source-prop write. To convert formula→plain: `DELETE /property/{formulaValueId}`
off the **prop-def** entity (not the prop-def itself) — new instances become plain-writable; a
direct POST cleanly replaces any stale formula-cached value on existing instances (no pre-delete
needed, cached values have no `_id` to collide with).

**`_sharing` create-time materialization**: `inheritParentProperties` auto-copies the PARENT's
`_sharing` onto a new child UNLESS the create payload explicitly sets `_sharing` (explicit wins,
even against a domain/public parent). If parent is private/absent, child gets no `_sharing`
property at all (absent = private). `DELETE /property/{sharingValueId}` leaves it permanently
absent — no async re-materialization from parent on a later read. Type-def `_sharing` is NEVER
copied to instances (checked directly — it's not the source of create-time copy, the immediate
parent ENTITY is).

**`_inheritrights` is a CHILD-side property.** Controls whether that entity inherits rights from
**its own parent**. An org's own `_inheritrights:false` blocks cascade INTO the org from its parent
(umbrella/db) — it says nothing about whether the org's CHILDREN inherit from the org; that's
controlled by each child's own `_inheritrights` (sections/members/agenda nodes are `true` by
design, so org `_viewer` grants cascade down through them). (Session-39 entry corrected an earlier
wrong model that had this backwards — this is the settled version.)

**[CORRECTED 2026-09-06, #264 item-6 audit, source-verified against `entu-api`]**: "absent default
= true at create" was imprecise — the real mechanic is `entity.js` `inheritParentProperties`
(:296-325): omitting `_inheritrights` on a CREATE POST auto-fills `true` on the child **only if a
`_parent` target already carries `_inheritrights.boolean === true`**; otherwise the property stays
genuinely ABSENT (no default written at all). And absence is NOT inherit-by-default at read time —
`aggregate.js:168`'s cascade and `:512`'s rights-change-propagation queue both gate on a strict
`=== true` check, so **absent behaves exactly like explicit `false`**, permanently, with no
self-healing on a later parent-rights change. See the `[PROBE-RESULT]` entry above for the full
mvox_crede/polyphony live comparison and the verdict passed to team-lead.

**Rights tiers**: `_editor` grants LIST/GET/POST-props/DELETE-prop-value but NOT `DELETE /entity`
(needs `_owner`) and NOT writes to any `rightType` property (`_noaccess/_viewer/_expander/_editor/
_owner/_sharing/_inheritrights` — all need `_owner`). Auto-provisioned persons
(`createUserForAccount`) get `_editor:self` only, never `_owner:self` — they can never write
`_sharing` on their own person via that path. No per-VALUE `_sharing` override exists anywhere —
domain/public bucket membership is uniform per prop-def across every instance of a type; per-record
field visibility is structurally unrepresentable today.

**CREATE has NO parent-rights check, for anyone, ever.** `routes/[db]/entity/index.post.js` only
gates on `entu.user` existing; `checkEntityAccess` no-ops when `entityId` is undefined (i.e. on
create); `inheritParentProperties` reads the parent's `_sharing`/`_inheritrights` via a direct Mongo
query, bypassing rights entirely. v4E schema's `creators: CreatorRule[]` (self/system/cron/
parent_right/bilateral/custom) is DESIGN-DOCUMENTATION ONLY — zero entu-api enforcement. The
README's repeated "BFF creates the member" language implies these rules were always meant to be
enforced by a server component mvox (browser-direct, no BFF) doesn't have. Findings:
`docs/migration/findings/invitation-member-creation-rights-2026-08-06.md`.

**`add_user` vs `invitation` — two unrelated mechanisms.** `add_user` (private prop on the db
entity) gates `createUserForAccount`: on first-time OAuth sign-in with no existing `accounts`
match, auto-provisions a new `person` as a child of `add_user.reference`. `invite=` query param on
the SAME `/auth` endpoint is a totally different path (re-links real OAuth creds to a
PRE-EXISTING entity via a server-minted 7d JWT stored as a property) — presence of `invite=` alone
(regardless of validity) SKIPS the auto-create branch. v4E's `invitation` entity is a third, separate
thing (app-level bilateral-consent design, zero platform enforcement — see above). `add_user` was
permanently DELETED 2026-08-06T13:13:47Z (task #22/T4.1) — polyphony's OAuth auto-provisioning
window is now closed; no new person can be created via plain OAuth sign-in until a replacement lands.

**API key vs JWT**: `entu_api_key` is permanent (SHA-256 hash on a person entity, no auto-expiry,
rotated only by overwrite). JWT minted from it is 48h, IP-bound via `aud` claim (mismatched egress
IP = silent 401). An `entu_api_key` on a person with NO OAuth account always returns an anonymous
floor JWT (`accounts:{}`) — the key is not identity-linked, cannot synthesize a real member JWT.
Real cross-user rights testing requires an actual second OAuth login (confirmed working method,
session 37).

**Pagination/search**: list envelope is always `{entities, count, limit, skip}` — `count` is total
corpus size, `skip`+`limit` is the only mechanism (no cursor, no observed cap to `limit=500`).
`name.string=X` = exact case-sensitive NFC match (correct for FK lookups). `q=X` = case-insensitive
substring across all string props.

**File properties**: two-step (`POST` announce with ALL of `filename`/`filesize`/`filetype`
required — omit any and you get a silent empty-shell property with no upload field — then `PUT` to
a DigitalOcean Spaces S3-compatible signed URL, 60s TTL, no retry). Required S3 headers: ACL,
Content-Disposition, Content-Type; do NOT set Content-Length explicitly. `DELETE /property/{id}`
does NOT delete the S3 object (confirmed orphan) — Spaces cleanup isn't implemented anywhere in
entu-api. `_thumbnail` = signed download URL for `photo[0]`, no resize pipeline, same 60s TTL.
Findings: `docs/migration/findings/file-property-wire-shape-2026-05-23.md`.

**`mandatory:true`** on a prop-def is a UI hint only — checked `entu-api` source directly, never
enforced server-side on create or update. Order-of-operations for schema/code changes doesn't need
to wait on it.

**Formula-as-rights-bypass** (useful pattern): `_referrer.<type>.<prop> COUNT` and sentinel-reference
+ per-value COUNT formulas both read across rights boundaries — safe for AGGREGATES (tallies,
counts) even when the underlying records are private; never project raw values this way (leaks).
Arithmetic operators on formula-derived values are broken (string-concat instead of math) — use
separate COUNT formulas for totals, never `*`/`+` on a formula output. Single-hop traversal only.

**Bucket exposure is a 3-gate AND, not just the entity's own `_sharing`.** A property value reaches
a non-owner reader only if ALL THREE hold: (1) the PROP-DEF's own `_sharing` (uniform per type,
established above), (2) the TYPE entity's own `_sharing` — a CAP (`aggregate.js:94/115`: if the type
has no `_sharing` at all, it nukes domain/public exposure for EVERY prop-def on that type regardless
of gate 1), (3) the INSTANCE's own `_sharing`. Missing gate 2 is an easy-to-miss apparent-success
trap: a script can "successfully" set gate 1 and still change nothing. **Missing gate 3 is the same
trap one level down**: a touch-save re-triggers aggregation but does NOT change tier — if the
instance's own `_sharing` never moves, nothing becomes visible no matter how clean gates 1+2 are
(real incident: T6.2, 2026-08-08 — see session digest below). Always read-verify ALL THREE gates
live before trusting a partial fix; a visibility scope is only complete when it names all three.

**Buckets are write-time SNAPSHOTS, not read-time computed** (`aggregate.js` runs `aggregateEntity`
on every write, materializing `private`/`domain`/`public` onto the stored document). A prop-def
`_sharing` fix does NOT retroactively fix any already-aggregated instance — every existing instance
needs a genuine re-write (touch-save: atomic single `POST entity/{id}` carrying an existing
property's own `_id` + its own value, re-asserting not changing it — `insertProperties` soft-deletes
+ re-inserts in one call, zero multi-value risk) to pick up the new bucket assignment. New instances
created AFTER the prop-def fix get it for free. Cross-ref `docs/architecture/entu-rights-and-
visibility-model.md` §1/§3 (mvox-app) for the full source citations.

**Artifact hygiene during iterative script fixes**: don't leave multiple near-identical dry-run
artifacts committed while a script is still being revised pre-authorization — team-lead's review
picked up a stale one instead of the current one this session (real confusion, real time cost).
Delete superseded pre-authorization dry-run artifacts as you go (they're draft churn, not audit
history yet); keep exactly one current one until the live run lands its own artifact.

## Seed / probe script catalog (current, both repos)

**`~/workspace` (legacy, stable, not extended):** seed-voices/collectives/po-member-ekf/
librarian-bundle/menu-items/rsvp-tally/mvox-collective-marker · cleanup-* scripts · Phase B/C/D
migration body (complete, polyphony v4E-aligned as of Phase C/D closeout). `perotin-toolkit.ts`:
`isDryRun()`/`writeResultArtifact()`/`replaceProperty()`/`findOrCreateByName()`.

**`~/workspace-app` (active):** every §8.6 script from 2026-08-07 onward lives in
`scripts/migrations/` + `scripts/migrations/lib/`, one entrypoint+lib pair per task, one committed
result artifact per run (dry AND live) in `scripts/migrations/seed-results/`. Full inventory =
`git log --oneline -- scripts/migrations/` — don't re-narrate individual scripts here; the commits +
artifacts + #37/#54 issue comments ARE the audit trail. Standing patterns worth naming once:
- **`BASELINE_*_IDS` frozen-set drift-check**: hardcode a population snapshot, compare live re-reads
  against it every run, name deltas individually rather than folding into a bare count. First used
  #20 (245 member ids), reused throughout.
- **Canary-first + read-back verify**: touch/widen one representative row (or one per type, when a
  batch spans multiple types), hard-verify single-value-survives, BEFORE the full sweep. Throws (not
  a ledger entry) on canary failure.
- **Ownership pre-check now standing practice** (learned #44/#45, applied proactively from T6.2
  onward without being asked): before any new instance-touching mutation, scan `_owner` across the
  full target population for non-db-root ownership. Live entrypoints hard-abort pre-write if found.

## Currently deferred / not scheduled

- **Real member-seat empirical verification** — recurring theme across #20/#44/#45/#46/#47/T6.2/T6.2b:
  every live run I execute is db-root-omniscient (always reads the private bucket regardless of
  tier), so "write landed + property _id rotated" is NOT the same as "a real non-owner member sees
  it." `ENTU_ADMIN_KEY` is CONFIRMED an anonymous-floor JWT (#44), not a usable second seat — I have
  no way to close this gap myself. Every §8.6 ledger states this caveat explicitly; T6.5's live gate
  (real browser, real member) is where it finally gets tested for the library slice. The pre-existing
  **22-vs-11 menu discrepancy** (#37, 2026-08-07 walkthrough, mechanism "unknown") and the "no library
  entries visible" symptom (2026-08-08, both hypotheses I checked refuted) are both instances of this
  same unresolved class — needs Mihkel's actual browser, not more schema inspection from me.
- **#68 db-root `_owner` backfill — STRUCTURALLY BLOCKED, confirmed 2026-08-09.** Phase 1 inventory
  (1444 entities swept, 72 flagged) + Phase 2 script (canary-first, no-owner-first, re-aggregation
  diff gate, idempotency guard — all landed post-Bentham-review) both committed and authorized, but
  the FIRST live canary (no-owner `profile` cohort, deliberately ordered first) 403'd on the `_owner`
  POST. Root cause is now confirmed, not hypothesized: `_owner` is a rightType property — writing it
  requires ALREADY holding `_owner` on the target. db-root holds `_owner` on none of the 72 flagged
  entities (that's the whole premise of #68), so a plain db-root-JWT POST is chicken-and-egg for the
  WHOLE population, not just the no-owner cohort (didn't burn more live writes re-confirming cohorts
  1/2 against the same predicted 403 — see architecture-decisions.md "Rights tiers"). Zero writes
  landed; verified byte-identical pre/post. Script ready to re-run (`db-root-owner-backfill-2026-08-
  09.ts` + lib) the moment a different mechanism is found — needs an Entu admin/systemUser override,
  manual action via Entu's own admin UI as a genuine platform superuser, or PO acceptance that these
  72 stay unfixed via API (template-transformation checklist item instead). Not self-serviceable via
  API as currently authenticated. Superseded the prior (softer) framing of this same gap below.
- **#9 (T4.8 EntuUser.name prefill)** — Mihkel-blocked, not data-manager work.
- **`lib/v4e-translator.ts` `translatePropertyDef`** never sets `_sharing` on new prop-def entities —
  flagged to Josquin (his lib territory), harmless today, would silently under-share future prop-defs.

## Privacy boundary register

- Estonian choir names (EFK/Sireen/Rahvusmeeskoor/TAM/EKBL/EMKL) — real, publicly-associated,
  acceptable per architecture-decisions.md.
- Seed persons — synthesized Estonian-style names, no real PII, `@example.ee` domain where emails set.
- polyphony is confirmed SYNTHETIC end-to-end (PO 2026-08-05: "no real data in Entu; import is
  last") — supersedes an earlier stale "production-shaped, 116 real members" line in
  architecture-decisions.md (not mine to edit, flagged only).
- Real persons IN the db: db-root/PO (`69bcfd8e...8079`), Mihkel's own OAuth-domain identity
  (`6a2fc05e...5ddc`), Test User (`6a097dcc...d6dd`, no OAuth link, pre-add_user-reversibility
  fixture), fixture "B" (`6a7591cc...8de`, real T4.9-walkthrough OAuth signup). All real,
  team-owned, out of the synthetic-seed population.
- **mvox_crede — unconfirmed-pending-Mihkel (corrected 2026-09-06, #263 PO ruling).** The
  2026-09-01 "real choir pilot, real member names + real emails" call (see the [CORRECTION] on
  the Session MVOX-12 checkpoint below) was NOT ratified by #263 — Gama's ruling on point 4
  explicitly declined the real-PII premise as grounds; a posture change is Mihkel's to declare.
  Do not assert mvox_crede holds real PII as settled fact until his word lands through the PO
  channel. The existing precautionary handling (redacted seed-186, gitignored CREDE result
  artifacts) stays as-is — low-cost caution, not a claim.

## Authorization gate — canonical statement (cross-ref `[[feedback_authorization_gate]]`)

Explicit inbound `"I authorize this run"` SendMessage **from team-lead** is the only valid gate —
not dry-run-clean, not Bentham GREEN, not task-assignment wording that merely states authorization
happened elsewhere, not a prior categorical "go ahead" covering a DIFFERENT script than the one
about to execute. Content AND routing (`from: team-lead`) both must check out. Re-verify per new
script/target-set even under a standing "go ahead," since a live write can hit a corner neither
dry-run nor code review caught — this has happened for real, more than once (Phase D sub-op 1
briefly nulled PO's name; T4.10 caught two separate real conflicts across two independent dry-run+
verify rounds that never went live). If >15 min pass past an expected authorization, send a status
ping — never self-authorize. **Some chains hold on a FURTHER gate past team-lead authorization**
(e.g. T6.2b: "execution HOLDS on Mihkel's explicit nod" even after Bentham+team-lead GREEN) — read
the dispatch's exact wording for any extra hold condition, don't assume the standard 2-party gate is
always the full chain.

## Recent sessions — 2026-08-07 (T3.1 #17 + #20 fix, condensed)

T3.1: 130 clean v4E members vs 115 orphan legacy (name-carrying, pre-v2 leftover, still written by
current `inviteData.ts`). Ran bundles 1+2+3 live: 128 domain profiles created, 128 members
private→domain, `name` prop-def removed from `member` type — all independently re-verified, zero
mismatches. T4.10 profile-migration arc ran two dry-runs, caught two real conflicts each round,
never went live (Mihkel: superseded).
#20: roster-crash root cause was `member.person`/`member.section` prop-defs carrying no `_sharing`
(NOT person-entity tier, an initially-proposed red herring) — see 3-gate-AND mechanics above. Live
fix executed 245/245, 0 failures, independently re-verified. Left 3 near-duplicate dry-run artifacts
mid-fix, caused a review mix-up — captured as the artifact-hygiene habit above.

## #68 db-root _owner backfill — Phase 1 inventory (2026-08-09)

Full-db sweep (1444 entities, every registered type incl. system types) via
`_type.reference=<id>` looped over every row from the `entity` meta-type
registry — one loop covers content instances + prop-defs + type-defs +
menu/plugin rows + the db entity itself, no type left uncovered. 72 flagged
(not db-root-owned), three cohorts: **(1) 58 schema/meta entities** (db entity
+ 5 type-defs + 52 prop-defs) owned by the **database entity itself**
(self-referential platform bootstrap root) — new finding, distinct mechanism
from the known real-OAuth gap; **(2) 11 owned by Mihkel's real-OAuth person**
`6a2fc05e...5ddc` (the person itself + 10 `rsvp` rows) — matches the
pre-existing #44/#45-class gap; **(3) 3 `profile` entities with NO owner at
all** (empty `_owner`). Artifact:
`seed-results/probe-68-db-root-owner-inventory-2026-08-08T21-49-01-000Z.json`,
commit `e677bbb`. Phase 2 (add-only backfill) awaits review + authorization.

## Entu meta-schema ids (verified 2026-08-08, #41)

Prop-def entities (per-type field declarations) are `_type.reference`'d to the **"property"**
meta-type entity `69bcfd8e9c031ab8e6ce8048` — NOT the "entity" meta-type `69bcfd8e9c031ab8e6ce8034`
(that id is the meta-type for TYPE-DEFINITIONS themselves — person/member/organization/etc. are
`_type.string=entity`, 27 total = 22 content types + 5 system types: database/entity/menu/plugin/
property). Menu (`_type.string=menu`, 23 rows) and plugin (`_type.string=plugin`, 4 rows) are their
own top-level content kinds, siblings of "entity"/"property", not children of anything.

## #48 member display-config LIVE (2026-08-08) — list:true+ordinal:1 on person, descriptions PARKED

Split decision: fix the 1-write display gap now, park the 160 description writes (authored content,
Mihkel's call on wording, not mechanical). Combined verify+write+read-back: `member.person` list
(absent)→true, ordinal 4→1, both read-back confirmed. Admin member list now shows the linked person
first instead of only `section`. Artifact:
`seed-results/member-display-config-2026-08-08-2026-08-08T12-50-47-647Z.json`.

## #48 meta-polish inventory (2026-08-08, read-only) — clean 0% baseline, display-config mechanism found

20 content types (post-#45, was 22), all 20 missing `description`. 140 prop-defs across those types,
all 140 missing `description` — a clean 0% baseline both levels, no partial coverage anywhere. Found
the Entu admin list-display mechanism: prop-def `list:boolean` + `ordinal:number` control which
fields render as list/table columns (not a separate config entity). `member`'s 4 prop-defs: only
`section` has `list:true` — with no `name` prop-def (removed T3.1 bundle 3) and `person` not
list-flagged, **the admin member list shows only a Section column today, no way to identify which
member a row is**. Recommended fix (not executed): `list:true` + lower `ordinal` on `member.person`.
Scope estimate: 160 description writes (20 types + 140 prop-defs) + 1-2 display-config writes ≈ 161-
162 total. **Named explicitly for the parking decision**: unlike every other §8.6 mutation today,
description text needs actual AUTHORING (content quality), not a mechanical tier-flip — "low risk"
(correct, cosmetic) doesn't mean "low effort-shape-match to what's shipped so far." Artifact:
`seed-results/probe-48-meta-polish-inventory-2026-08-08T12-48-20-000Z.json`.

## 2026-08-08 session digest — epic #37 (data/config cleanup) + epic #54 (Library 1.0)

All items below shipped/were-found today; full row-by-row detail lives in the commits, result
artifacts (`seed-results/`), and the #37/#54/#41-46-47-53-55-56-57 issue-comment threads — this is
the compressed pointer, not the audit trail.

**Epic #37 — orphan/config cleanup, in dependency order:**
- **#41 inventory** (baseline for everything below): 246 members (245 domain + 1 private), 132
  persons (128 T3.1-synthetic + 4 real), 115 orphan members, exact-name partition = 18 with-twin / 97
  without-twin, person 18 domain-tier prop-defs, member 4 (all domain), 3 empty-shell menu entries,
  `_probe_bulletin` 3 inert rows. Artifact: `probe-epic37-phase1-inventory-2026-08-08T02-19-47-000Z.json`.
- **#43/#44 credential work**: db-root's own `entu_api_key` is NOT domain-exposed (instance-tier
  private caps it); carries 3 stacked historical values (aware-only). `ENTU_ADMIN_KEY` confirmed dead
  as a member-seat proxy (anonymous floor JWT). `narrow-person-refs`: 18 person prop-defs →private,
  131/132 touched, 1 failure (Mihkel's real-OAuth person, rights gap — see deferred item above).
- **#45 D2+D5**: menu "Applications" privatized; `application` specimen+type+4 prop-defs deleted
  (specimen delete initially 403'd on the same rights gap, Mihkel deleted it manually, I fixed a
  script bug — `verifyAllTargets` unconditionally re-checked already-landed steps — with a targeted
  `verifyStep3Only`); `_probe_bulletin` type+3 prop-defs+3 instances deleted, 7/7. D2+D5 complete.
- **#46 orphan-115 disposition**: ownership pre-check found all 115 db-root-owned (no rights-gap risk,
  unlike #44/#45's real-OAuth entities). Loose-match found 0 new beyond the 18 exact; the ORIGINAL
  corroboration check (name+section via the legacy `section`/`current_section` PROPERTY) was
  mechanically empty because 0/131 twin members ever populated that property. Gama's correction:
  section membership lives in the CANONICAL `_parent`-reference shape instead (each member has an
  `organization` parent + a `section` parent, distinguished by `entity_type`) — re-run against that
  signal, **7/18 corroborate** (comparing by reference id, not name string, correctly excluded 6
  same-name-different-org-section false positives). Phase C hid all 115; **#53** later deleted the 7
  corroborated ones live (7/7) — final state: 7 deleted, 108 hidden.
- **#47**: 3 more empty-shell menu entries (Repertoire/Programme/Attendance) privatized, 3/3 live.
- **Menu-bucket-mechanism probe** (urgent, triggered by Mihkel seeing no library entries despite
  T6.2b): checked whether `menu`-type prop-defs lack `_sharing` (the #20 pattern) — REFUTED, they're
  all `_sharing:public`. Re-checked T6.2b for regression — also clean. **Root cause still unresolved**,
  likely same class as the pre-existing 22-vs-11 discrepancy (below).
- **Open, unresolved**: the 22-vs-11 menu-visibility discrepancy (2026-08-07 walkthrough) and the
  "no library entries visible" symptom (2026-08-08) are both instances of "real member-seat behavior
  diverges from what schema inspection predicts" — see the deferred item above, needs Mihkel's
  browser, not more schema reads from me.

**Epic #54 — Library 1.0, T6.1→T6.2→T6.2b (data layer now complete):**
- **T6.1 grooming** (#55): re-verified work/edition/copy/lending prop-defs live. Corrected the epic's
  own framing — `work` (6/9) and `edition` (10/16) already had fields domain-tier OUTSIDE the ruled
  set (none of them the actual title/composer/name/publisher targets, which were still private).
  `copy.location` doesn't exist as a field (ruling named it, schema doesn't have it). `lending.copy`
  flagged as probably-required for "availability per copy" despite not being in the literal ruling.
  Gama's rulings on #54 resolved all of this: `edition.cost` narrows to private (product decision,
  bookkeeping not browse data); the other 15 already-domain fields stay domain deliberately;
  `lending.copy`/`assigned_until`/`returned_at` join the widen set (mechanics of the ruled outcome);
  no new `location` field this slice.
- **T6.2** (#56): 12 prop-def writes (11 widen + edition.cost narrow) + 586-instance touch-save
  re-aggregation, 598/598 clean. **Gama's STOP**: touch-save re-asserts the SAME value — it re-triggers
  aggregation but doesn't change TIER. All 586 instances stayed `_sharing:private` (gate 3) the whole
  time, so nothing was actually member-readable despite the clean execution. **Lesson: a visibility
  scope is complete only when it names all 3 gates** (prop-def / type / instance) — T6.2's scope only
  ever asked for prop-def widen, gate 3 was never in question until Gama's audit caught it.
- **T6.2b** (#57): closed gate 3 — verified gate 2 (all 4 TYPE entities already `domain`, never the
  blocker) then genuinely replaced (not touch-saved) all 586 instances' `_sharing` private→domain,
  canary-per-type, full chain incl. Mihkel's explicit nod (held execution on that line even past
  Bentham+team-lead auth, per the dispatch). 586/586, zero failures. **The full 3-gate-AND now clears**
  for T6.1's ruled field set — T6.3 (browse surfaces) has real domain-visible data to render against.
  Still unconfirmed by an actual member seat (see the menu-bucket probe above — something in the
  member-visible chain still isn't rendering as expected; not yet root-caused).

**Two single-tree collisions today, both handled correctly**: `feat/52-nav-shell` (mid-#53) and
`fix/gate-findings` (mid-menu-probe) — halted immediately on `git branch --show-current` mismatch,
reported branch+status+log evidence, did NOT switch/stash/work around, resumed only after team-lead
confirmed the tree was back on `main`. This is the pattern to repeat — the branch check before every
commit is not decorative, it caught two real concurrent-chain collisions in one session.
