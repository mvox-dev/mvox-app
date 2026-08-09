---
name: bentham-scratchpad
description: Bentham's personal notes — review calibration and open items for mvox-dev
metadata:
  type: project
---

# Bentham scratchpad

## 2026-08-09 — Session MVOX-5 reviews (all GREEN)

[#68 Phase 1 inventory @ e677bbb — GREEN + YELLOW-68.1] 1444 entities swept, 72 flagged in 3 cohorts.
Methodology sound (all instances of all registered types, pagination + truncation guards). YELLOW-68.1:
comment's 58/11/3 cohort split vs histogram's 59/10/3 — Mihkel's person entity is owned by the
DATABASE entity (other-owned), not by Mihkel-the-person. Cosmetic, no operational impact.

[#68 Phase 2 backfill @ 623c096 → f25e4b5 — GREEN] Add-only POST `_owner=db-root` on 72 entities.
3 YELLOWs on 623c096 (no fresh re-check per write, canary order, single-specimen spot-check) — all
CLOSED at f25e4b5 (fresh GET per write with idempotency skip, no-owner-first sort, full-entity
before/after diff gate per canary). Code GREEN; live run = distinct authorization.

[#70 config-menu admin-only @ 65d02ba — GREEN] DELETE `_sharing` value on 3 Configuration menu rows
(Entities/Menu/Plugins), matching Billing's existing admin-only shape. Clean #45/#47 pattern replay.
No YELLOWs.

[PATTERN — full-entity canary diff gate (established #68 f25e4b5)] For any mutation that should be
side-effect-free: snapshot full entity before/after (no `props=` scope), diff all keys except the
intended change, HALT if anything else moved. Stronger than a single-field spot-check — proves
side-effect-free per TYPE. Combine with no-owner-first ordering (prove the hardest access case first).

(*MVOX:Bentham*)

## 2026-08-07 — #20 widen-member-refs — CODE reviewed, LIVE RUN NOT reviewed

[WIP — carry] The live run was authorized 2026-08-07 but no live ledger has crossed my desk. Two
things to verify when it lands: (1) canary ledger line (touchSaveCanary), (2) last-mile visibility
check used a non-omniscient identity. See git history of this file for the full review narrative.

[DEFERRED — non-blocking carry for the #20 script] (a) `verifyMemberTypeSharing` halt message only
explains the absent case, not the `'private'` case. (b) `MEMBER_TYPE_ID` not verified as parent of
the two prop-def ids. Cheap close: assert `_parent === MEMBER_TYPE_ID` in `verifyPropDefsAbsent`.

(*MVOX:Bentham*)

---

# Durable review knowledge (consolidated 2026-08-07)

Pre-slice-4 per-PR narratives pruned at team-lead's approval. Only rules that change a FUTURE
review decision survive below. Full historical detail is recoverable from git history of this file
(`git log -p -- teams/mvox-dev/memory/bentham.md`).

## Review method — how I establish ground truth

- **[GOTCHA-BRANCH-MOVED-UNDER-REVIEW]** Re-derive the branch's real HEAD; never trust a SHA quoted
  in a handoff. Capture `git rev-parse HEAD` + `git status -s` BEFORE and AFTER any gate run in the
  SAME command so a mid-review move is detectable. Read diffs from committed blobs (`git show
  <sha>:<path>`), never the working tree — untracked WIP shadows commit content invisibly. To test
  an old state, use an isolated detached `git worktree`, never mutate the shared checkout. When HEAD
  moves mid-review, re-gate and report the corrected SHA + test count explicitly. Fired twice
  (#7-signin f4f199e→a9e8919; #36 a755ceb→a25e78d).
- **[CALIBRATION-DO-NOT-FABRICATE]** Every claim in a verdict must quote a line I read THIS pass from
  THE REAL FILE. No claim survives a cancelled/aborted tool batch. Enumerate branches with
  `git for-each-ref refs/heads` and confirm the tip's commit SUBJECT before reviewing — the dispatch
  names the chore, not the branch, and not the phase. If the GREEN task is still pending, the correct
  response is "not ready, awaiting GREEN," not a review. If verdict and file disagree, the FILE wins.
- **[CALIBRATION-NEVER-CAVE-TO-AUTHORITY]** When team-lead's report conflicts with my clean read,
  present the RAW conflict plus a deterministic cross-check — do NOT "corroborate" to be agreeable.
  Content hashes (`git rev-parse <tree>:<path>`, `git cat-file -p <blob>`, `git hash-object`)
  arbitrate; they survive a flaky stdout channel where rendered file text does not.
- **[CALIBRATION-GATE-CLAIMS]** Iron rule: before any gate claim, READ the gate-result file in the
  SAME turn and quote the exact line. If I haven't read it this turn, I have no number to report —
  say the verdict is static-provable and gate-independent instead. Run each commit's `pnpm check` as
  its OWN discrete Bash call (never `&&`-chained across commits — ELIFECYCLE on a middle command eats
  the failure and `tail -N` then misattributes the previous commit's `COMPLETED N FILES E ERRORS`).
  **Test-runtime success ≠ type-check success**: vitest passing never underwrites a failed/missing
  `pnpm check`; they cover different surfaces.
- **[CALIBRATION-MERGE-SHAPE]** Run `git log --oneline <branch>..main` on EVERY branch review.
  Non-empty ⇒ the branch is behind main and the squash diff WILL carry negative deltas for anything
  added on main during the gap — RED pending rebase/merge-from-main unless the deltas are shown
  intentional. Especially load-bearing when team-state/memory files land on main mid-feature. A prior
  merge-from-main in the branch's history gives a FALSE sense of caught-up if it predates the new
  commits. Also check the **staged set**: scratchpads/memory files in a feature diff must be dropped
  from the squash.
- **[CALIBRATION-PRUNE-TIMING]** Prune this scratchpad at session END, not START — keep current-arc
  entries until the work they document is CLOSED. Lift broad patterns to `architecture-decisions.md`
  BEFORE pruning them from here.

## Tests that pass while the code is broken — the recurring family

All of these are "the test/mock and the code agreed on a lie." Treat as one family.

- **[GOTCHA-VACUOUS-ASSERTION]** A `render → querySelector → if(found){assert}else{noop}` shape is a
  vacuous-pass tell: the `else` branch means the assertions never ran. Same for a
  `not.toContain(<value>)` when nothing in the fixture could ever produce that value. **Green test
  COUNT is not a verdict input** (RED-35.1: 1127/1127 green while the headline accept path 403'd
  always). Demand the awaited transition actually renders the element, or `throw` if absent.
- **[GOTCHA-PARTIAL-ASSERTIONS]** `expect.objectContaining({...})` hides the field carrying the bug.
  Assert full shape (`toEqual`) and drive the REAL producer. Caught the season description-wipe.
- **[GOTCHA-PARTIAL-PATCH-FULL-SNAPSHOT]** Danger triad for any clear-then-set / PATCH path:
  (a) consumer's "should I touch this field" gate is `!== undefined` (so `''`/`0`/`false` count as
  real values), (b) producing form emits ALL fields unconditionally, (c) one field has no pre-fill
  source. Result: that field is silently reset on every save. Fix either end — true-partial diff, or
  give the field a pre-fill source. Worked close-example: #87 `RehearsalPatch`.
- **[GOTCHA-STORE-CONTRACT-SEAM]** When a store has a status union AND a consumer branches on
  `status===X && <field-condition>`, verify the PRODUCER can actually emit that (status,field) tuple.
  Audit = grep the store's `.set(` calls, enumerate emittable tuples, cross-check every consumer
  branch. A unit test that HAND-SETS a state the producer can never emit passes for an unreachable
  input while the real path is dead. Fix-direction default: ONE empty representation (`ready:[]`) and
  let the consumer's existing gate pick the UI. Close it with a test driving the REAL producer.
- **[GOTCHA-FABRICATED-MOCK-WIRE-SHAPE]** Any new Entu response-type assertion (`as { ... }`) must be
  cross-checked against a live probe or Entu source. Mocks returning an ASSUMED shape are the failure
  mode. Instances: `_type` create-POST string-vs-reference; accounts dict-vs-array-vs-token-claims;
  the #29 mock that FABRICATED an `add_user` the live db lacked.
- **[GOTCHA-AUTHORED-BUT-DEAD-I18N]** An i18n key present in all locales but referenced ONLY in a
  spec's i18n MOCK = a DROPPED REQUIREMENT, not dead copy. The mock defining a key is the opposite of
  evidence the feature is wired. Audit: `git grep <key> <tip> -- src/`; only `*.spec.ts` hits ⇒ the
  production wiring is missing. (Caught RED-86.1: confirm-delete copy authored ×4, rendered nowhere.)
  Inverse case also real: string IN `src/` but NOT in locales (hardcoded English).
- **[CALIBRATION-STRUCTURE-BEATS-RUNTIME-BELT]** When a prior bug was "consumer used a value the
  producer didn't actually supply," the strongest fix makes the value a REQUIRED TYPED FIELD on the
  producer's contract — then the cast can't lie, and a caller CANNOT forward what the type lacks.
  Prefer that over "add a test that would've caught it." Corollary: don't credit a near-vacuous
  runtime assertion as the proof when the TYPE is doing the proving.
- **[STANDING MOVE]** For any page that calls a data-fn with a value derived from decoded/projected
  state: demand a PAGE-level test that drives the click and asserts the data-fn received the REAL
  value. A unit test of the data-fn alone never proves the page passes the right args.

## Severity calibration

- **[CALIBRATION-SELF-HEALING-≠-BENIGN]** Ask: does it recover WITHOUT a user reload, within the
  session? "Self-heals on reload" is NOT self-healing. A bug that forces a reload to regain function
  is a real UX defect — at least YELLOW-with-repro, arguably RED for a headline interaction. Don't let
  "no data corruption" downgrade a stuck-interaction bug. (Missed on the RSVP double-tap; the live
  gate caught it.)
- **[CALIBRATION-FOLD-IN-VS-DEFER]** If a YELLOW's fix is sub-10-line AND the file's own author
  comment already points at the fix, prefer FOLD-IN pre-merge over a post-merge follow-up — the
  post-merge cycle (hotfix commit + dispatch + re-review) costs more than the fold-in.
- **[CALIBRATION-LIVE-GATE-IS-EXPECTED]** A static review gate is not designed to catch integration
  and live-behaviour defects; a PO-live-test → hotfix-cycle window is EXPECTED after any
  architectural rewrite, not an exception. Budget it in the plan rather than treating hotfixes as
  review failures.

## TDD / merge-shape rules

- **RED-phase shape**: the RED commit should land a minimal STUB (`throw new Error('not implemented')`)
  of any new module so it RESOLVES and types check — tests then fail on ASSERTIONS, not on module
  resolution. A RED commit that imports a not-yet-created file fails `pnpm check` and breaks
  per-commit-GREEN (YELLOW, not RED — the tip is what merges, but bisect value is lost).
- **Per-commit-GREEN applies to the RED commit too** — `pnpm lint:fix` is not a GREEN-agent-only duty;
  a spec committed lint-dirty at RED sails to merge-review because GREEN's lint:fix only touches files
  GREEN edited.
- **[STANDING — required-field-fold exception]** Adding a REQUIRED field to a shared type AND its
  first producer in ONE commit is the correct per-commit-GREEN shape, not a TDD violation — a separate
  RED asserting the field would itself fail `pnpm check`. Don't YELLOW the collapse; note any
  lane-crossing without penalising it.
- **Mechanical test updates during GREEN are allowed** iff (i) pattern-alignment/mechanical reason is
  stated in the commit body AND (ii) spec INTENT is unchanged (same behaviours pinned). Rewriting the
  ASSERTIONS themselves is RED. Adding a missing key to an i18n mock so a component renders is
  mechanical, not assertion-gaming.
- **[CALIBRATION-SPEC-MOVES-WITH-THE-FIX]** When the production value the spec pinned was ITSELF the
  bug, the spec's attested MECHANISM flips while its INTENT is preserved — a legitimate same-slot
  intent-correction, not a weakened test. Distinct from a fixture pinning a STABLE production default
  (which must not become a tautology). For env-lift cases prefer the NEGATIVE form
  (`expect(urls.every(u => !u.includes(<default>))).toBe(true)`) — it also catches a hardcoded literal
  left alongside the new env read.
- **Don't over-pin**: assert `/\bz-\d+\b/` (any value) rather than a specific `z-30`; the implementer
  picks the value.

## Entu / v4E wire + rights mechanics (verified, reusable)

- **Single-entity GET** `GET {db}/entity/{id}` returns `{entity:{...}}`; the SEARCH form `entity?...`
  returns `{entities:[...]}`. (Confirmed against Entu's reference frontend.)
- **[GOTCHA-ENTU-TYPE-CREATE-WIRE]** CREATE requires `_type` as a REFERENCE to the type-entity `_id`;
  `{type:'_type', string:'<typename>'}` returns HTTP 400. Asymmetric with READ, where search filters
  use the materialized `_type.string`. A create-wire mock asserting the string shape passes green
  while live 400s ⇒ new entity types want a live/preview smoke-create, not just mocks.
- **[GOTCHA-ENTU-DATE-ISO-NOT-BARE]** Entu returns `date`-typed values as FULL ISO
  (`YYYY-MM-DDTHH:MM:SS.sssZ`), not bare `YYYY-MM-DD`. Normalize at the mapper (`?.date?.slice(0,10)
  ?? ''`) if any consumer feeds `<input type="date">`, does a lexicographic compare against a bare
  date, or does `Date.parse(x + 'T…Z')` (double-suffix ⇒ NaN).
- **POST appends** on multi-valued props ⇒ **revoke by IDENTITY, not by value-id.** A roles-as-rights
  revoke must GET the grant prop, filter ALL entries matching the person, and DELETE each; a single
  stored `propertyValueId` deletes one duplicate and leaves the person still granted. Grants should be
  idempotent (skip POST if already present). List fns should dedupe by personId.
- **Rights list endpoint pre-filters by access**: `routes/[db]/entity/index.get.js:567`
  `filter.access = { $in: [entu.user, 'domain', 'public'] }` in the `$match` pipeline. A private
  entity/property is excluded from a different reader's list results SERVER-SIDE. This is why a
  client-side `if (_sharing==='private') skip` is security theatre — if the data crossed the wire the
  leak already happened. Rely on the server boundary and make the reliance EXPLICIT with a
  sharp-edge test rather than adding a client filter.
- **`inherited: true`** distinguishes cascaded from direct rights grants on the wire — so "list the
  DIRECT grantees of role R on entity E" is computable. Note a direct `_owner` has `inherited`
  *undefined*, not false, so a bare `!inherited` wrongly admits it; filter on
  `property_type === '_editor' && inherited !== true`. Granting `_editor` also materializes
  `_expander`+`_viewer` (query the `_editor` prop specifically; `_viewer` is noisy). Rights propagation
  lags ~1.5-3.5s PER level ⇒ immediate write-then-read on a grandchild is flaky; want a poll window.
- **DELETE is `_owner`-tier**; `_editor` can GET, POST props and `DELETE /property/{valueId}` but
  CANNOT `DELETE /entity` (403). Where a role table calls an editor's access "full," the enforced
  mechanics win. **Cascade-delete over a MULTI-PARENT entity must filter on the SPECIFIC parent**
  (e.g. the series), or siblings under a shared parent get swept.
- **Endpoint split**: entity `_id` (incl. prop-defs) → `DELETE /entity/{id}`; property-VALUE `_id` →
  `DELETE /property/{id}`. Never share one helper.
- **`'send-invite'` is a magic `entu_user` string** on `POST /[db]/entity/[_id]` (add-property-to-
  existing) — it triggers Entu's SES email path. Inert on the create endpoint (`POST /[db]/entity`),
  which is all mvox uses. mvox deliberately mints with `'trigger invite token'`; any future code
  writing `entu_user` via the `[_id]` endpoint must avoid the literal unless SES sending is intended.
- **Mandatory is a UI hint**: the create path has NO `mandatory` enforcement, so dropping a
  "mandatory" property won't fail live.
- **OPEN QUESTION (unresolved)**: does Entu's POST-with-file-fields re-link a pre-existing S3 object,
  or always require a fresh upload? Probe with `_probe_` against a throwaway entity carrying a real
  file value before trusting ANY delete-then-post migration on file properties. Related standing RED:
  a DELETE-then-POST migration touching file properties without round-tripping the full file payload
  (md5 / S3 key / content-type / filesize / filename).

### v4E RED triggers (canonical 7)

1. Multi-hop formulas (anything beyond `propertyName.*.property` or `_parent`).
2. `type: reference` on a formula property (silently coerces to string).
3. Formula projecting raw values across rights boundaries (aggregates OK; CONCAT of names leaks).
4. New route running in elevated mode without an entry on the enumerated elevated-ops list.
5. `_owner`/`_editor`/`_viewer` grant on an org-subtree entity without an active `member`.
6. Client code calling `https://entu.app` outside the documented Path-C call paths.
7. Flipping an `_inheritrights: false` boundary without a v4E schema change.

**Schema-mutation gate**: a PR touching v4E entity types/properties/formulas/rights defaults needs
`Schema-Change: entu/research@<sha>` + `PO-Approved:` trailers. **Carve-out**: schema-ALIGNMENT PRs
(live data → already-landed schema) do not. Per-value `_sharing` warning DROPPED per PO calibration.
mvox-app-specific marker/config types are app extensions, not canonical v4E — they skip the flow.

**Entities created directly under an organization must set `_inheritrights: true` explicitly** (Entu
checks `=== true`; absent means false).

## UI / responsive / a11y review triggers

- **[GOTCHA-OVERFLOW-FORCES-AUTO]** `overflow-x: hidden` on a box whose `overflow-y` is `visible`
  forces the other axis to compute to `auto` (CSS Overflow L3 §3.2), turning the box into a clip
  container that CUTS `absolute`/`fixed` descendants painting outside it (dropdowns, `top-full`
  panels). RED on any dropdown/popover host. Correct horizontal-overflow control for a flex row is
  `min-w-0`+`truncate` on flexible children + `flex-shrink-0` on fixed children — never a parent clip.
- **[CALIBRATION-STRUCTURAL-TEST-BLINDSPOT]** jsdom has no layout engine, so class-presence tests
  can't catch a broken COMPUTED display. A `sm:`/`md:`/`lg:` display utility with NO paired base
  `hidden` renders in the element's default display BELOW the breakpoint. Audit every `data-testid`
  element carrying a responsive display class for a paired `hidden`; the spec must assert BOTH halves.
- **Z-index adequacy** = sweep the WHOLE codebase for values `>=` the proposed one AND check whether
  any tie/higher hit can CO-OCCUR by route/auth-state — not just whether ancestors have stacking traps.
- **[GOTCHA-CONTRAST-SWEEP-ALL-STATES]** A per-token contrast sweep must cover the empty / skeleton /
  error / loading branches, not just populated rows. Judge large-vs-normal by actual px+weight
  (handwriting faces like Caveat lean to the stricter normal bin). Against paper `#f7f1e1`:
  ink 13.34 / ink-2 8.52 PASS; ink-3 4.25 / ink-4 2.32 / ink-5 1.62 FAIL. On `#f7e58a`: ink 11.84 /
  ink-2 7.56 PASS.
- **Desk-readability POLICY**: `data-desk-text` styles NOTHING — it is not a conformance mechanism.
  An element conforms by having a real opaque-colored-bg ancestor OR by being a genuine big-display
  title. A marker on an element that ALREADY conforms is redundant → YELLOW (remove). A marker on
  bare-on-desk small/body text is a LIE → RED. Gradient/bg-image coverage does NOT count as
  conformance; it must also declare a `background-color` fallback.
- **[CALIBRATION-i18n-IMPORTED-BUT-PARTIAL]** A `.svelte` file that imports paraglide AND uses `m.*()`
  for most strings but hardcodes a subset is a real i18n regression at non-en locales (tests pass
  because they assert the English literal). Discretionary YELLOW asking "why isn't THIS string wired?"
  — hot-RED only if the gap is load-bearing copy (headline/CTA). Also scan for English words anywhere
  on a line containing `{...}` — a suffix to a templated value (`{n} members/section`) doesn't LOOK
  like a string and slips past i18n review.
- **Vertical-skin neutrality**: domain vocabulary lives in i18n VALUES, never in component/type/
  test-id names. Standing audit grep on any new UI feature.
- **Loop-safety mechanic**: a `$effect` calling a fn that WRITES store X is loop-safe iff the effect
  never READS X and X's writer doesn't write the effect's own dep. Guard vars must be plain `let`
  (NOT `$state`) to stay out of the dep graph.
- **[GOTCHA-OPTIMISTIC-WRITE-NEEDS-SAME-REQUESTID-GUARD]** Whenever an optimistic-write/mutation
  handler writes state that a requestId-guarded LOAD also owns, the WRITE handler's `.then`/`.catch`
  needs the SAME generation guard (capture at handler top). Check BOTH paths. Free the pending slot
  BEFORE the guard so nothing gets stuck. **DISPOSITION: do NOT re-RED this family under the
  single-collective pivot — there is no picker, so the cross-collective clobber is unreachable.
  Re-open only if multi-collective returns** (applies to YELLOW-RSVP.1, CARRY-T4.5.1, YELLOW-T4.8.1).

## Process / authorization

- **Authorization gate**: live-mutating data-manager ops require an explicit "I authorize this run"
  SendMessage routed by team-lead. A Bentham GREEN on the CODE is NOT a substitute and must never be
  read as one. Refuse to GREEN a live-execution path until the token lands. When PO authorizes in
  conversation, team-lead must re-route it — a `from: <not-team-lead>` message doesn't satisfy the gate.
- **Live probes of an "admin cannot read X" claim must use a NON-OMNISCIENT identity**, never db-root.
- **Branch discipline is load-bearing** for multi-author handoffs and risky changes; it is ceremony
  for a single-author cosmetic refactor implementing a reviewer-spec'd YELLOW with a clean minimum
  diff — there, lean "accept-as-is + coach the path" over "reset + redo."
- **Stewardship**: when authoring `architecture-decisions.md` text during a same-session branch
  review, RE-READ the source files the new text cites BEFORE the steward commit. A stewardship lift
  with a downstream consumer is high-priority within its session — `lift → commit → spec cites by SHA`
  beats a dangling forthcoming-citation.
- **Migration-script anti-patterns** (still live for Pérotin's scripts): every op kind needs an
  explicit dispatch branch plus an "every op kind reaches a handler" assertion; narrow bare-catch
  scope to the one call whose failure it can recover; list-endpoint "are there instances?" probes need
  a high `limit`, not 10; **empty-probe-today ≠ safe-to-defer** — review the dead path AS IF it will
  fire, because the gap between dry-run and live-run is exactly when new values land; split a bundled
  migration by blast radius when one layer is RED.

(*MVOX:Bentham*)
