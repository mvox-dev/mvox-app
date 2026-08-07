---
name: bentham-scratchpad
description: Bentham's personal notes — review calibration and open items for mvox-dev
metadata:
  type: project
---

# Bentham scratchpad

## 2026-08-07 — #20 widen-member-refs PRE-EXECUTION review (main @ 5d49a6a, 247 planned live writes) — YELLOW, one precondition to close first. **[RESOLVED @ bdcb21d — YELLOW-A closed, run AUTHORIZED at session end; result NOT yet reviewed by me, see [WIP] below.]**

[WIP — first thing to pick up next session] The live run was authorized 2026-08-07 ~15:35 but had not
completed/been reported when I shut down. **I have reviewed the CODE only; no live ledger has crossed
my desk.** Two things to look at when it lands: (1) the **canary ledger line** specifically —
`touchSaveCanary` is the hard gate that proves the replace mechanic on one member (re-reads, asserts
exactly ONE surviving `_sharing`, value `'domain'`, THROWS rather than logging) before the other 244
run; if it threw, nothing after it executed. (2) whether the **last-mile visibility check used a
genuinely non-omniscient identity** — not db-root, and not an account that happens to hold `_owner`
on these entities, or it proves nothing (see the proof-of-write≠proof-of-visibility note above).
Guard resolution at `bdcb21d`: `verifyMemberTypeSharing` reads the member TYPE entity live and the
fresh dry-run recorded `memberTypeSharingObserved: "domain"` — gate 2 measured, not assumed; 28 specs;
canary + population disambiguation (245 total / 245 unchanged / 0 new / 115 orphans) all landed.

[DEFERRED — two carry-forward notes, non-blocking, for whenever anyone next touches that script]
(a) `verifyMemberTypeSharing` HALTs unless the type is `'domain'`/`'public'`, which is deliberately
STRICTER than the mechanism (a truthy `'private'` would actually pass a prop-def `'domain'` through).
Fail-safe direction so I did not ask for a change — but the halt MESSAGE only explains the absent
case, so an operator hitting it on `'private'` could "fix" it by needlessly widening the TYPE
entity's sharing. (b) `MEMBER_TYPE_ID` is a third hardcoded id; nothing verifies the two prop-def ids
are actually CHILDREN of that type. Cheap close: have `verifyPropDefsAbsent` also request `_parent`
and assert it equals `MEMBER_TYPE_ID`. Also noted on record: the count drift guard loosened from
exact-match to shrink-only, so unexpected GROWTH now proceeds (named as `newSinceBaselineIds`) rather
than halting — right trade, but a real one-directional loosening.

[GOTCHA-ENTU-BUCKET-EXPOSURE-IS-A-THREE-GATE-AND (VERIFIED at entu-api source) — standing, applies to
EVERY prop-def `_sharing` change] A property value reaches a non-owner reader's domain/public bucket
only if ALL THREE hold. Checking one or two is the trap:
1. **The prop-def's own `_sharing`** — projected during aggregation (`aggregate.js:86`).
2. **The entity TYPE's own `_sharing`, acting as a CAP** — `definitionSharing =
   definitionEntity?.private?._sharing?.at(0)?.string` (`aggregate.js:94`), then `:115`
   `if (!definitionSharing) { sharing = undefined }`. **A type with no `_sharing` silently nukes the
   prop-def setting for EVERY prop-def on that type.** Only the `domain`-caps-`public` case narrows;
   any truthy type `_sharing` lets a prop-def `'domain'` through.
3. **The entity's own `_sharing`** — second retention gate (`aggregate.js:269-275`) deletes
   `newEntity.domain`/`.public` wholesale unless the instance itself is at that tier.
Review move: on any prop-def sharing fix, demand a guard on gate 2 (the TYPE entity), not just the
prop-def. Its absence is a SILENT no-op — writes land, ledger reads clean, nothing becomes visible.
Ours is documented in `docs/architecture/entu-rights-and-visibility-model.md` §3 lines 63-83.

[GOTCHA-ENTU-INCLUDE-_id-TO-REPLACE — VERIFIED, supersedes the naive read of the POST-appends rule]
`POST entity/{id}` with `_id` INCLUDED in a property object is a genuine atomic REPLACE, not an
append: `utils/entity.js:441` pushes that `_id` to `oldPIds` and strips it, `:52` inserts the NEW
value, `:54` `markPropertiesDeleted(oldPIds)` soft-deletes the old, `:55` `aggregateEntity` re-runs
unconditionally. Three consequences worth carrying: (a) it's the correct single-call replace — no
DELETE-then-POST round trip and no multi-value append; (b) the order is **insert-then-soft-delete**,
so an interrupted request leaves a DUPLICATE, never a MISSING value — the "entity loses its
`_sharing` and silently defaults to private" failure mode is structurally impossible; (c) because
`aggregateEntity` runs on every write, re-asserting a property's OWN existing value under its OWN
`_id` is a legitimate **touch-save** to force re-aggregation (buckets are write-time snapshots).
`markPropertiesDeleted` filters `deleted:{$exists:false}`, so it's idempotent. `_sharing` is in
`rightTypes` (`:27`) ⇒ needs `_owner`, and `checkEntityAccess` runs BEFORE any write ⇒ a 403 is a
clean per-record failure with zero partial state.

[REVIEW NOTE — "proof of write" ≠ "proof of visibility"] A ledger built from a db-root/`_owner`
credential can never observe what a non-owner domain reader receives (`cleanupEntity`'s first branch
always serves the private bucket to an owner). A rotated property `_id` proves a write happened and
that aggregation re-ran — nothing more. Last-mile confirmation always needs a genuinely
non-omniscient identity. Pérotin pre-declared this one honestly in both code and artifact; hold that
standard for any future rights-tier ledger.

(*MVOX:Bentham*)

## 2026-08-07 — #20 roster error-message honesty fix (fix/18-roster-orphan-crash @ 8652be0) — GREEN + YELLOW-20.1 (user-visible untranslated throw message) + a framing correction.

[GOTCHA-THROWN-MESSAGE-IS-USER-COPY 2026-08-07 — standing trigger] A thrown `Error`'s message stops
being dev-facing the moment a page does `loadError = e.message` and renders it through a localized
wrapper — here `roster/+page.svelte:49` + `:88` `{m.roster_load_error({ message: loadError })}`. The
WRAPPER is translated ×4; the interpolated PAYLOAD is hardcoded English. Net: et/lv/uk users get a
localized frame around English jargon, plus whatever internal ids the message names. **Review move:
whenever a diff changes a thrown message, grep for `e.message`/`err.message` reaching a template
before judging it dev-facing** — if it does, the change is user-visible copy and the usual i18n +
information-disclosure questions apply. The honest fix is a split: rich detail to console for
developers, generic localized string to the user. Cheap to miss because a `throw new Error(...)` in a
data-layer `.ts` LOOKS internal.

[FRAMING CORRECTION — #18/#20: the 115 legacy orphans CANNOT reach this throw.] The issue was briefed
as "roster crash on legacy-orphan members — 115 exist by design." Verified false in source this turn:
`listActiveMembers` queries `entity?_type.string=member&status.string=active&...`, and the orphans
carry NO `status` → they never match → never reach the resolver. Independently matches my own #18/#19
note and Pérotin's population probe. The crash that actually fired was a rights-tier case (consistent
with Mihkel's finding). Keep this straight: a future recurrence must NOT be diagnosed as orphan data,
and orphan handling in this path needs no "fix" because it is unreachable.

(*MVOX:Bentham*)

## 2026-08-07 — Pérotin's RECONSTRUCTED T3.1 result artifact (mvox-app 84af649) — YELLOW ×4. New review class: a record, not a PR.

[PATTERN-RECONSTRUCTED-ARTIFACT 2026-08-07 — standing] Reviewing a *backfilled* audit record is a
distinct job from reviewing code: the question is not "does it work" but "does every field's
confidence match its evidence." The move that worked: **sort each field by provenance tier and check
each tier differently** — (1) git-derived (SHAs/timestamps) → re-derive from `git log`, and verify
timezone conversion, not just SHA existence (Pérotin's three UTC conversions were all correct);
(2) source-derived (`EXPECTED_PUBLIC_PERSON_COUNT`, the endpoint choice, a precondition) → grep the
committed source at the cited SHA; (3) **console-only** (live-resolved entity IDs, histograms,
read-back lists) → these can NEVER be re-derived from the repo when the script resolves IDs at
runtime rather than hardcoding them, so they rest entirely on operator attestation. Tier 3 is where a
reconstructed artifact silently over-claims: a top-level `"overallVerified": true` reads as
machine-checked when it is operator-attested. **Standing ask: a reconstructed artifact must either
cite a retrievable location for its tier-3 values (the persisted inbox/message record), or label the
attestation tier per field.** Also: the `writeResultArtifact` convention shares one timestamp between
filename and an `executedAt` payload field — a reconstruction that fills the filename slot with the
RECONSTRUCTION time and omits the payload field puts a misleading date in the conventional
"when did this run" position. Demand an explicit `reconstructedAt`.

[CALIBRATION-CITATION-PRECISION-RECURS 2026-08-07] Third instance of "pointer wrong, substance right"
(after the finn.md invite-allowlist ref). Both defects here were citation-side: an auto-memory cited
as flagging a gap it never mentions, and a path written `src/routes/.../inviteData.ts` when the file
is `src/lib/invite/inviteData.ts`. In a document whose entire VALUE is its citations, a wrong pointer
is not cosmetic — the next auditor follows it, finds nothing, and discounts the whole record. Review
move: follow EVERY citation to its target and confirm the target says what it is cited for — existence
of the file is not confirmation of the claim about it. Cheap: one grep per citation.

(*MVOX:Bentham*)

## 2026-08-07 — #36 invite-path reduction (feat/36-invite-domain-member, worktree ~/workspace-app-t36) — GREEN at HEAD a25e78d + COORDINATION FLAG: handoff's frozen SHA a755ceb FAILS the YELLOW-T4.4.1 guard. **[CLOSED 2026-08-07 — #36 merged 10:17; flag resolved, nothing outstanding. The technique it taught survives as [GOTCHA-BRANCH-MOVED-UNDER-REVIEW] below.]**

[#36 2026-08-07 — GREEN at a25e78d] member create → `_sharing:'domain'`, DROPS `name` prop + `_viewer` grant (aligns invite path to the ruled target model that the roster #18/#19 reads). Admin form reduced to org-select only (memberName+email fields removed; email already dead since #34). Security-sound: member `_sharing:'domain'` exposes only membership-fact + person-ref + status (name lives on the domain PROFILE, not the member) = the intended domain-shared membership; dropping `_viewer` is safe (domain sharing covers the invitee's own read — no access regression, she was read-only via _viewer before, read-only via domain now); `_inheritrights:true` keeps admin management via org inheritance. Mandatory-name concern MOOT: entu-api create path has NO 'mandatory' enforcement (grep utils/entity.js + index.post.js empty — consistent with [[entu-creation-rights-unenforced]]), so dropping `name` won't fail live regardless of #17-bundle-3 timing. i18n (Byrd's own, not Comenius): all 4 locales drop name_label+email_label + rework bearer_warning {email}→"the invited person" identically; Estonian verified correct directly ("kutsutavale isikule"), lv/uk match the pattern + internally consistent — no error, formal Comenius pass optional. YELLOW-T4.4.1 holds at a25e78d (inviteData no 'profile', profileData UNCHANGED, resolveTypeId only person/member; soleCreatePath.spec UNCHANGED). Fixture hygiene task #8 closed as fallout: `_omitsMemberName` removed, `_omitsOrgId={}` now errors precisely on the sole missing field — resolves my old #34 stray-email fixture-precision YELLOW. RED 222e724 tests-only, staged-set clean.

[COORDINATION FLAG — branch moved under review; handoff's frozen SHA is BROKEN. verify-load-bearing-identifiers caught it.] Handoff said "frozen a755ceb, test 489 pass." But worktree HEAD is a25e78d, ONE AHEAD. a755ceb's inviteData.ts:287 comment = "...profiles are the sole name source..." → `'profiles'.includes('profile')` true → soleCreatePath.spec:72 `expect(content.includes('profile')).toBe(false)` FAILS. So a755ceb has a FAILING test — "test 489 pass" could not have been at a755ceb. a25e78d (`fix(#36): reword ... drop the banned 'profile' substring`) rewords "profiles"→"a separate per-visibility-level entity", clean. a25e78d is NOT the "unrelated uncommitted comment edit" the handoff described — it's the load-bearing guard fix, committed, tagged fix(#36), and MUST be the merge target. Practical risk low (merging the branch tip = a25e78d includes it), but the stated frozen SHA + gate claim were both off — surfaced to team-lead. Reinforces [[GOTCHA-BRANCH-MOVED-UNDER-REVIEW]]: re-derive the real HEAD, never trust the quoted SHA.

## 2026-08-07 — #18/#19 T3.2/T3.3 roster (feat/t3-roster @ 83d54fd) — GREEN, no findings. Security-boundary review; Gate A verified at entu-api source. **[PARK LIFTED 2026-08-07 — #29 closed, ready-order reached, #18/#19 both closed + roster merged live. The park condition held correctly.]**

[#18/#19 2026-08-07 @ 83d54fd — GREEN, PARKED] Roster: lists status:'active' domain members, resolves name from domain profile + email via resolveField, renders name+email only. Built against the RULED TARGET model (members domain-shared, no member.name, name/email from profiles) NOT the shipped pre-#29 shape. 8 files off c681df6; RED f59e38f (stubs throw ×4) → GREEN 83d54fd. profileData/soleCreatePath/completionGate ALL UNCHANGED (hasDomainName reused verbatim). Clean, client-pure, i18n 5×4, staged-set clean.

[THE SECURITY BOUNDARY IS 100% SERVER-SIDE — and I VERIFIED it's real, not asserted.] The whole point: an ordinary domain reader lists another member's profiles (`listProfilesForPerson`→`listMyProfiles`, `_parent.reference=personId&props=name,email,_sharing`) and relies ENTIRELY on Entu to never return the private profile. **Gate A VERIFIED at entu-api `routes/[db]/entity/index.get.js:567`**: `filter.access = { $in: [entu.user, 'domain', 'public'] }` in the `$match` pipeline (`:597`) — a private profile (access = owner-only) is excluded from a different reader's list results server-side; endpoint doc `:4` "Properties are filtered by access rights." So a domain reader's profile-list query CANNOT return X's private profile. The reliance is well-founded. [Reusable [SRC] fact for any rights-boundary review: the entity LIST endpoint pre-filters by `access $in [user,'domain','public']`.] The client has ZERO private request (queries project only name/email/_sharing + person/current_section — no notes/idcode/birthdate/phone) and ZERO client-side filtering — and that's CORRECT: an `if(_sharing==='private')skip` would be security theater (data already crossed the wire = leak already happened). [ARCHITECTURE NOTE — "zero-client-defense + sharp-edge test" pattern: rather than a client private-skip, they make the server-boundary reliance EXPLICIT via a non-vacuous test (Test 14) that hands toRosterRow a private-tier profile and POSITIVELY asserts `row.email==='leak@x.com'` — proving resolveField's narrower-wins (private=0 sorts first) WOULD prefer it if it ever arrived. The test's naming forbids "fixing" it with a client filter. This is the right architecture for a rights-enforcing backend + matches Path-C. Live enforcement of the boundary = T3.4/#29 gate.]

[Other 5 points verified:] #28 nameless handling is a COMPLETENESS gate not privacy (toRosterRow returns null via hasDomainName; the member's existence stays domain-readable, accepted/ruled — not silently double-hidden). name uses the domain-only inline scan NOT resolveField (public-bucket-duplication trap, same as completionGate/#28); email uses resolveField (narrower-wins = correct "whichever tier she shared it at"). Query shape: `status.string=active` naturally excludes the 115 orphan legacy members (no status field → don't match → never reach the resolver, no crash); NEVER projects member.name (ruled off); no person.reference fetch-all shortcut (lists all active members = intended domain roster, then per-person scoped profile reads). Fail-loud: loadRoster Promise.all → any per-member read reject propagates → whole-roster failure (a member the app couldn't verify never silently vanishes). Page: proper empty-state message (rows.length===0 → roster_empty, not a broken blank), load-error+retry, generation guard, missing-token fails loud, runes, on bg-paper. check0/test515. **PARKED per Gama — GREEN recorded but NOT a merge/deploy trigger; stays until #29 closes + ready-order (#17 provisioning + #36) reached.**

## 2026-08-07 — #29 T4.9 invite-parent fix (feat/t4.9-invite-parent-fix @ 99d7b93) — GREEN, security-sound. Closes the live invite bug #22 deleted add_user exposed.

[#29-parentfix 2026-08-07 @ 99d7b93 — GREEN] The T4.5 live bug: resolvePersonParentId read the `add_user` prop #22 DELETED → createInvite threw live at person-parent-resolve (mocked tests hid it — the mock FABRICATED an add_user the live db lacks). Fix: resolve the parent from the database entity's OWN `_id`. Diff +15/−10 on inviteData.ts (resolvePersonParentId only) + spec; createProfile/soleCreatePath untouched. Verified all 5: (1) `add_user` GONE from query (`props=add_user` dropped), from the parsed type (`{_id?:string}`), AND from logic (returns `entity._id`) — only doc-comment mentions remain → a stale/future-restored add_user is STRUCTURALLY incapable of influencing this path (the security invariant); the stale-add_user test is non-vacuous (injects add_user, asserts id==='db-entity-1' AND `.not.toBe('stale-add-user-ref')`). (2) returns entity._id; the old add_user-absent throw REMOVED (no-add_user is now the normal post-#22 path). (3) failure modes kept (non-2xx→http, empty→not-visible) + NEW _id-absent contract guard (2xx entity w/o _id → throw reason:'contract', never POST a person with empty _parent). (4) **VERIFIED at entu-api source**: setupDatabase.js:184-190 sets `_parent=databaseId` for parentless entities at bootstrap (so entity._id IS the canonical root parent); index.get.js:295-301 auto-create requires a db entity with `add_user.reference $exists` → keeping add_user deleted keeps public auto-provision DISABLED, and the fix reads _id (not add_user) so it works WITHOUT re-arming it. NOTE: native auto-create parents to `add_user`, the fix parents to `databaseId` — coincide for polyphony (empirically self-ref, NOT code-enforced; runbook §0 overstates "valid self-referencing add_user" per team-lead — code only checks $exists). databaseId is arguably the MORE principled parent (canonical bootstrap root, independent of the security-sensitive add_user). (5) createInvite just receives the differently-resolved parent; person-payload test _parent updated parent-1→db-entity-1. RED fe9a06d tests-only; mock corrected to carry NO add_user (matches live reality — the exact test-integrity fix I flagged). check0/test489 (inviteData 24/24). The empirical databaseId==correct-parent for polyphony gets its FINAL confirmation at the live gate (AC1: createInvite proceeds end-to-end against real polyphony) — my review confirms the CODE + source-premise; the live run confirms polyphony's data matches. [Live gate is team-lead+Pérotin; admin-cannot-read probe MUST use a non-omniscient identity, never db-root — my standing advice.]

## 2026-08-07 — #30 T4.10 db-root EXCLUSION delta (feat/t4.10-scope-exclude-dbroot @ 7130d19) — GREEN, clean. Resolves my prior visibility-flag observation.

[#30-exclude 2026-08-07 @ 7130d19 — GREEN] Mihkel ruled (b): EXCLUDE db-root/PO (`…8079`, private) from the migration → the private→domain name promotion I flagged is GONE. Diff +51/−11 on t4-10-plan.ts only (base b2ae840 == prior-GREEN 1fdf14d content; all data-safety guards byte-unchanged; profileData/soleCreatePath untouched). The SHARP part (Josquin caught): shrinking EXPECTED_TARGET_IDS alone would HALT — `…8079` passes the `_sharing!=='public'` selector so the drift guard would reject it as "unexpected." Fix: new `EXCLUDED_TARGET_IDS` filtered out of `reals` BEFORE the drift check. Verified all 6: (1) `reals = nonPublic.filter(!excludedSet.has(id))` removes …8079 before drift/multi-value/return → can't reach a create; (2) drift NOT weakened — excludedSet is a FIXED 1-id allowlist, any OTHER non-public person stays in reals → still trips exact-set drift HALT (tested: unexpected 4th non-public → HALT, zero writes); (3) stale-exclusion HALT both sub-cases, fail-loud, naming the id — (a) excluded id absent from live non-public → throw, (b) present but `_sharing!=='private'` → throw (refuse on a stale premise); (4) EXPECTED→2 domain ids (OAUTH+TESTUSER), both domain-tier so no ⚠ visibility-change flag remains; (5) COVERAGE preserved+strengthened — multi-value guard re-pointed PO→OAUTH (stronger: a multi-valued excluded PO could never reach the guard, so testing an in-scope person is the real risk), private-tier buildPlan coverage re-pointed PO→`synthetic-private-1` (branch stays live for any future private member), + 3 new exclusion-mechanism tests; (6) prior guards intact. RED 8769921 tests-only (hard-coded ids → fails on assertions not imports). check0/test489 (migration 33/33). **YELLOW-T4.10.1 (idempotency) UNCHANGED by this delta — migrateOneGroup untouched — still a live-gate carry.**

## 2026-08-07 — #30 T4.10 name/email→profile migration SCRIPT (feat/t4.10-migration @ 1fdf14d) — GREEN (script/build) + YELLOW-T4.10.1 (idempotency) + 1 low TOCTOU note. Highest-stakes review of the wave (live-mutation tool, deletes real person values).

[#30 2026-08-07 @ 1fdf14d — GREEN for the SCRIPT/BUILD] BUILD only (script + mocked specs; NOT run live — execution is a separate PO/Pérotin gate). 11 files off #28 (ff5c93d); RED a014c4f (stub throws) → GREEN 42fbbe6 → fix 1fdf14d. YELLOW-T4.4.1 HOLDS incl. the scripts/ guard-blind-spot closed MANUALLY: t4-10-plan.ts:17 imports createProfile from $lib/profile/profileData + calls it :259 with `_inheritrights:false` as the typed input arg (never hand-rolls the payload); profileData.ts byte-unchanged, soleCreatePath.spec unchanged. No committed secrets (creds env-sourced; test api-keys are fake literals). Specs use vi.fn() mocked fetch (no live network).

[DATA-SAFETY CORE — NO practically-reachable data-DESTRUCTION path survives. The 2 self-fixed bugs HOLD:]
1. **Multi-value copy-one/delete-all (was silent 'moved')** — TWO layers: enumerateTargets HALTs the WHOLE run (zero writes) if any in-scope person has >1 name/email value; getPersonFieldValueIds throws at DELETE time if the live re-read finds >1 (belt for a value added post-census). A multi-valued field can NEVER reach silent 'moved' — either whole-run HALT or per-record fail-loud.
2. **Wrong-host (frozen-host bug)** — loadCfg fails LOUD if PUBLIC_ENTU_API_BASE is unset OR ≠ ENTU_API_URL. The $env shim (env-dynamic-public.ts) freezes the host at import; assigning it in loadCfg would be DEAD, so the guard refuses rather than mint a JWT for one host while writes/deletes target another.
[Other guards verified:] create-before-delete + DUAL read-back — step-3 readbackProfileFieldPresent GATES step-4 deletePersonField (delete unreachable until profile write server-confirmed); create-ok/delete-fail → named `duplicate-hazard` (profileId+valueId+repairHint), never swallowed. Synthetic-exclusion is belt+suspenders: `_sharing!=='public'` + EXACT EXPECTED_TARGET_IDS set-equality (any missing/unexpected → HALT) + count===length page HALT — the 128 can't be swept (public→excluded; non-public synthetic→'unexpected'→HALT). Visibility-per-field: name→domain ALWAYS (T4.8 gate reads domain bucket), email→sourceTier (never widened — private email stays private); a private→domain NAME promotion is FLAGGED `⚠ VISIBILITY CHANGE` in renderPlan (intentional per T4.8; note only db-root/PO is private-tier → its name becomes domain-visible; PO reviews at the dry-run gate). ownerIds:[personId] grants the member _owner (needed under _inheritrights:false). LIVE-WRITE SAFETY: DRY_RUN defaults TRUE (only exact 'false' disables); dry path = read-only enumerate + pure plan/render + exit(0), NO migrateOneGroup → cannot mutate; entrypoint exits non-zero on ledger.hasFailures(); MigrationLedger per-record, no aggregate 'done', completion = per-record read-back.

[YELLOW-T4.10.1 — NOT idempotent under PARTIAL failure; a naive re-run mints a DUPLICATE profile. **STATUS 2026-08-07: #30 CLOSED. If a live run happened it went through the explicit-authorization gate per protocol — I have NOT independently verified that; flag to team-lead if evidence surfaces otherwise. The durable lesson (a create-before-check migration step is non-idempotent; recovery is per-record repair, never a blind re-run) stands for any future live-mutation script.**] migrateOneGroup ALWAYS createProfile's (step 1) with NO pre-create check for an existing target-tier profile (listMyProfiles is used only in the post-create readback, not as a "does a target-tier profile already hold this field?" guard). Under a CLEAN all-moved run a re-run is a safe no-op (persons have no name/email left → buildPlan yields no groups). BUT after a partial failure (duplicate-hazard, or verify-fail leaving a created+populated profile) the person still holds the value → a re-run selects it → creates a SECOND target-tier profile = duplicate. NOT data-destruction (recoverable; T4.8 gate / T4.7 dup-repair would surface it), and the intended recovery is operator MANUAL per-record repair per the ledger repairHint — NOT re-run — under a supervised one-shot gated run. So non-blocking, but the re-run semantics must be explicit to PO/Pérotin at the live gate: "repair per hint, do NOT blindly re-run." Clean fix if ever automated: a pre-create idempotency check (reuse/skip an existing target-tier profile already holding the field).

[LOW NOTE — census-vs-delete TOCTOU, unreachable in the supervised context.] The value COPIED to the profile is value[0] from the enumerateTargets census; the value DELETED is the delete-time getPersonFieldValueIds re-read. If a person's name/email CHANGED between census and its delete, the NEW value is deleted while only the OLD (census) value lives in the profile → the new edit is lost, record still reads 'moved' (readback checks the profile holds the CENSUS `expected`). Requires concurrent mutation of a specific real person during a supervised one-shot run (3 persons, seconds) — effectively unreachable; the operator controls the run, no users editing db-root/Test User meanwhile. A delete-time value-equality check (current person value still === census value before delete) would close it. Surface for awareness only; not a blocker.

[STANCE for the live RUN gate — my GREEN is for the CODE. The run is a DISTINCT authorization (my authorization-gate + polyphony-dev-collective memories): even on dev/synthetic polyphony it touches the 3 real persons + deletes values, so it needs the explicit per-run "authorize this run" token + PO review of the dry-run plan (esp. the name→domain visibility-change flags + the re-run semantics above) → Pérotin executes → per-record read-back. Do NOT let a GREEN-on-code be read as a live-run authorization.]

(*MVOX:Bentham*)

## 2026-08-07 — #28 T4.8 mandatory-completion gate (feat/t4.8-completion-gate @ 979592b) — GREEN + 1 low fwd YELLOW. Gate-completeness independently re-derived.

[#28 2026-08-07 @ 979592b — GREEN] Mandatory-completion GATE (reshaped from "fallback" by Mihkel): a signed-in member without a `name` on her DOMAIN-`_sharing` profile is redirected to /profile + NOT shown as a member until filled. 15 files off #27 (54e9148); RED e55a833 (completionGate stubs throw 'not implemented' ×4) → GREEN 6501a16 → fix 979592b. profileData.ts ENTIRELY untouched (createProfile byte-unchanged, soleCreatePath.spec unchanged) — YELLOW-T4.4.1 trivial: the gate is READS-ONLY (completionGate.ts client-pure, no create machinery). Staged set clean.

[GATE COMPLETENESS — THE load-bearing check, independently re-derived, recon's "S1 only" HOLDS.] Grepped every membership consumer across src: `membership:'loading'|'member'|'non-member'` is resolved in EXACTLY ONE place — `+page.svelte` (home agenda) via `findMyMemberId` — and gated before AgendaList via `gatedMembership = membership==='member' && $completionGateStore!=='complete' ? 'loading' : membership`. FAIL-SAFE by construction: requires the gate to be POSITIVELY 'complete' → both 'loading' AND 'incomplete' keep the RSVP disabled (NO flash, default-deny). No OTHER member-display surface exists: no roster/member-list route renders members (roster/notices are ComingSoon placeholders), RSVP tallies are anonymous counts, RSVP write-paths are gated upstream (she can't click a disabled control). Defense-in-depth: +layout.svelte EFFECT B redirects 'incomplete' → /profile app-wide (loop-safe: `path!=='/profile'`; scoped to `/`+isProtectedPath so public/auth pass through; acts only on RESOLVED 'incomplete', never 'loading'). SSOT: `completionGateStore` is the ONE answer; every surface subscribes, single layout read + single redirect — no surface re-derives.

[THE 4 SELF-FIXED DEFECTS — each re-verified HOLDS:]
1. **Bidirectional gate re-close.** `refreshCompletionGate()` (bidirectional resolveGate re-read) called on BOTH removal paths: reconcile for a confirmed DOMAIN save (the `name!==''` guard DROPPED → an empty-save that clears the name re-CLOSES to 'incomplete') AND onMoveConfirmed for a `name` move off the domain tier (T4.7). So S1 can't re-light for a nameless member.
2. **First-save duplicate-on-retry.** applyProfileSave's Case-2 post-condition (`assertDomainNameIfCompletion` → `assertDomainNamePersisted` re-read) runs AFTER the first-save shell-create; a throw is RE-WRAPPED as `ProfileSaveError(msg, profileId)` so the queue records the id → retry UPDATES the shell (existingId set), no 2nd domain profile. Re-edit branch throws raw (no shell minted → no dup risk). Loudness via failedLevels.
3. **Two-case classifier + transition window.** Case 1 (nameless-at-runtime incl transition window) = passive read/route via `hasDomainName`, NEVER throws, NEVER checks `_created`/epoch → a pre-gate #26 profile is uniformly 'not yet completed' (Gama's time-qualification, no false defect). Case 2 (write reports success yet name absent) = `assertDomainNamePersisted` write-post-condition, `DomainNameInconsistencyError`, dev-facing. Genuinely separate paths — the read path never runs Case 2, so the transition window can't manufacture a false Case 2.
4. **Minors:** `hasDomainName` TRIMS (whitespace-only name → 'incomplete'), `assertDomainNameIfCompletion` also trims (no spurious Case-2 throw on a clear); banner clears after successful save.

[SCOPE — exactly name-on-domain, verified.] `hasDomainName` reads ONLY the `_sharing==='domain'` entity's own name — NEVER `resolveField` (comment cites entu-api aggregate.js:152-155: a public name lands in BOTH domain+public buckets, so resolveField would let a public-only name PASS — but the direct domain-bucket read is correct regardless of that citation's exactness). So a public-only name does NOT satisfy the gate. No email substitution, no person.name fallback (post-T4.3 unreadable cross-member; the non-display IS the mechanism). resolveGate FAIL-SAFE: any read throw → 'loading', never a false 'incomplete'. RED genuine, i18n 1 key ×4, client-pure. check0/test448/build (team-lead-reported); my GREEN static-provable.

[YELLOW-T4.8.1 — low, forward-looking, multi-collective-ONLY (mirrors YELLOW-RSVP.1 family, unreachable under single-collective pivot).] `refreshCompletionGate()` (profile/+page.svelte) does an async resolveGate re-read then `completionGateStore.set(state)` with NO generation guard. It fires from generation-guarded callbacks (reconcile/onMoveConfirmed), but the ASYNC READ inside isn't guarded: a collective switch DURING the post-save read window could land a stale OLD-collective 'complete' onto the store while she's now in a NEW (incomplete) collective → brief gate hole (RSVP briefly enabled / redirect suppressed) until the next EFFECT A/trigger. The layout EFFECT A is separately gateGen-guarded; refreshCompletionGate is not, and gateGen lives in +layout (not shared with the profile page). NOT a blocker (single-collective ⇒ no switch ⇒ unreachable; same disposition as RSVP.1/T4.5.1). Fix if multi-collective returns: capture a generation (the profile page's `generation` is bumped on switch via loadForSelected) and gate the store.set — or route the in-session re-read through the layout's gateGen path. Also worth a glance at the T4.9 live gate.

(*MVOX:Bentham*)

## 2026-08-07 — #27 T4.7 visibility moves (feat/t4.7-visibility-moves @ 725d7f6) — GREEN + 1 low YELLOW. Hardest branch; 3 self-fixed defects all independently re-verified to hold.

[#27 2026-08-07 @ 725d7f6 — GREEN] Visibility MOVE = change one field's level = TWO non-atomic writes to TWO entities (no Entu txn). 15 files off f7ae1a2 (docs anchor). Clean shape RED d126bd6 (stubs throw 'not implemented' ×3 fieldMove/×3 queue) → GREEN 5bf0690 → i18n 4d34071 (34 profile_ keys ×4 full parity, 18 new) → fix 725d7f6. Staged set clean; new files client-pure (no server/node imports).

[YELLOW-T4.4.1 — BEST outcome + guard STRENGTHENED.] New modules fieldMove.ts/fieldMoveQueue.ts import ONLY createOwnProfile+saveProfileFields from profileData; every move write funnels through a T4.6 primitive (no entuFetch, no POST/DELETE, no `_inheritrights`, no resolveTypeId(...,'profile')). profileData.ts purely ADDITIVE (+50, zero deletions → createProfile + all T4.6 fns byte-unchanged); the add is the pure narrower-wins READ resolver (NARROWNESS {private:0,domain:1,public:2}, resolveField). soleCreatePath.spec MODIFIED but STRENGTHENED (+16): new describe asserts fieldMove/fieldMoveQueue contain NO `_inheritrights`/NO profile-type-resolve AND pins `EXEMPT` toEqual the SAME 2 entries (positive "allowlist did not grow" assertion — directly guards the failure mode I warned of). Non-vacuous (reads real file content + the real EXEMPT const).

[THE 3 SELF-FIXED DEFECTS — each independently re-verified HOLDS:]
1. **Create-phase orphan-shell recovery.** applyFieldMove step-1 dstId-null: `createOwnProfile`→try saveProfileFields→catch throws `FieldMoveError(...,'create',shellId)`. Page onMoveFailed(create-phase): records the shell into loadedProfiles at pendingMoveTo[field] (name:'',email:'' → resolver IGNORES it since only non-empty holders count) → retry's onmove finds dst=that shell → dstId set → add-branch UPDATES, no 2nd shell. A bare createOwnProfile failure propagates WITHOUT createdTargetId → retry re-creates. Distinction precise (mirrors T4.6 recordCreatedId).
2. **Cross-queue write-lock (scariest).** move's saveProfileFields vs T4.6 card's saveProfileFields on a SHARED entity. Fix at PAGE: `writesInFlight=$derived(busy||pendingLevels.size>0)`; onmove/onrepair `if(writesInFlight)return`; cards `canSave && !busy`; icons `disabled={writesInFlight}` (VISIBLE). Airtight given single-threaded JS: busy/pendingLevels set SYNCHRONOUSLY before the async write dispatches, and both entry points check the combined signal — neither orchestrator can start while the other is in flight. fieldMoveQueue is also SINGLE-FLIGHT (one move/repair at a time, provably clobber-proof for 2 fields×3 levels; serialize-by-entity would be insufficient for a non-atomic whole-pair rewrite).
3. **Distinct-value conflict surfacing.** Root: resolveField.holders (value-AGNOSTIC, drives move) vs planLoadedDuplicateRepairs (value-EQUALITY, drives banner) disagreed. Fix: `isConflict = holders>1 && planFor===undefined` cleanly splits same-value duplicate (→ active red repair BANNER, role=alert, "Finish now" completes the delete on wider entity, preserve-on-error) from distinct-value conflict (→ amber `≠` marker + named note on the row, wider levels shown, NOT hidden). narrower-wins still renders the narrowest (safe) value. Movable only when exactly 1 holder; else icons VISIBLY disabled (no silent no-op click).

[AC1 create-before-delete — structurally enforced.] applyFieldMove awaits step-1 (create-in-new) fully + fires onPhase('created') BEFORE step-2's await (delete-from-old). Delete NEVER issued until create server-confirmed → interruption leaves a DUPLICATE, never a LOSS. Whole-pair `pair(field,val,sibling)` preserves the sibling on every write; srcSibling/dstSibling sourced from real loadedProfiles → no GOTCHA-PARTIAL-PATCH clobber. AC3 privacy repair genuine: applyDuplicateRepair serial fail-loud clears wider holders (retracts a real API-readable exposure — narrower-wins only hides it on OUR render); a delete-phase move failure reloads → surfaces the banner. Generation guard on move settle frees inFlight/busy BEFORE the gen check (never wedged); reset() on switch. Runes-only, full Tailwind classes, a11y (aria-pressed/busy/label per icon state, role=alert banner). check0/test416/build (team-lead-reported); my GREEN static-provable.

[YELLOW-T4.7.1 — low, non-blocking, LIVE-GATE candidate (T4.9). Unsaved level-card draft is silently discarded by the post-move reload.] Every successful move → onMoveConfirmed → loadForSelected → resetState() → draft=emptyDraft() → repopulate from server. Moves stay ENABLED while a card has a dirty-but-unsaved draft (an unsaved draft isn't in pendingLevels, so writesInFlight is false). So: type in a level card without saving → do a visibility move → move succeeds → the unsaved typing is discarded, no signal. NOT server data loss (only uncommitted input), uncommon interleaving, recoverable by retyping — hence YELLOW not RED. But silent-discard-of-typed-input sits against the team's fail-loud standard elsewhere. Options: block moves while any card isDirty (visible reason) OR preserve dirty drafts across the post-move reload OR accept as known. Flag at T4.9 live gate.

(*MVOX:Bentham*)

## 2026-08-07 — #26 T4.6 profile edit UI (feat/t4.6-profile-edit @ 78282a8) — GREEN, no findings (strongest branch of the wave)

[#26 2026-08-07 @ 78282a8 — GREEN] Per-level (public/domain/private) profile edit; each level = its own `profile` entity, created LAZILY on first save. 13 files off merged #34 (cf66173). Clean shape: RED 430678a (stubs throw 'not implemented' — verified all 3 source files: applyProfileSave/profileEditQueue/createOwnProfile+listMyProfiles+profilesByLevel+saveProfileFields all `throw`, tagged RED STUB) → GREEN 2a2736c → i18n 8106fac (17 profile_ keys ×4, full parity) → fix 78282a8. Staged set clean (only messages/ + src/{lib/profile,lib/components/profile,routes/profile}); client-pure (no server/private/node imports).

[YELLOW-T4.4.1 — the whole ballgame — CLEANEST possible outcome: soleCreatePath.spec UNCHANGED.] The design put `createOwnProfile` as a sibling INSIDE the allowlisted profileData.ts (funnels through createProfile with `{personId, _inheritrights:false, _sharing:level}`, NO ownerIds → member self-owns via Entu caller-add). Because the `_inheritrights` literal + `resolveTypeId(cfg,'profile')` stay confined to profileData.ts, the guard passed WITHOUT modification (allowlist still {profileData,inviteData}, still non-vacuous). Verified: createProfile BYTE-UNCHANGED (single additive diff hunk after line 102, all T4.4 guards intact); the new files contain zero `_inheritrights`/zero profile-type-resolve. **saveProfileFields (UPDATE path) is create-free**: GET name/email value-ids → DELETE stale → POST new; NEVER sends _type/_parent/_inheritrights/_sharing (only name/email) → correctly OUT of the sole-create-guard scope. **SANCTIONED PATTERN for T4.7/T4.10**: a new profile-create wrapper belongs INSIDE profileData.ts (keeps the literal confined, guard untouched); a create wrapper in a NEW file would trip the marker (must not be added to EXEMPT) — that's the guard working. saveProfileFields-style field-only updates are guard-exempt by construction (no create props).

[PROACTIVELY CLOSED the YELLOW-RSVP.1 write-path residual — recognize it.] profileEditQueue mirrors rsvpChangeQueue (#15) but goes further: the write-settle handlers (.then AND .catch) re-check `getGeneration()` vs the gen captured at dispatch and no-op their UI callbacks on mismatch, while STILL freeing the `pending` slot BEFORE the guard (never stuck-pending). `reset()` clears the pending set on collective switch (page not remounted on same-route switch → a stale request would keep its level's backstop closed and swallow a fresh same-level save = AC2's "major" fix). Page wires it: loadForSelected() does resetState()(clears pendingLevels markers) + queue.reset() + bumps `generation` (plain non-$state let, loop-safe — effect depends only on `selected`). So a switch-mid-save can't leave a level stuck-disabled (page cleared markers) NOR bleed cross-collective (gen guard). This is EXACTLY the 2-line-mirror-of-loadForSelected fix I specced for the RSVP residual — they applied it on the write path. [Reachable only under multi-collective switching (single-collective pivot doesn't hit it) → forward-looking, but correctly built, not left as a carry like RSVP did.]

[AC2 honest round-trip — sound by construction.] draft (bound to inputs) vs confirmed (last server-confirmed id+fields) split; "Saved" = `savedLevels.has(level) && !isDirty(level)` (can't sit next to a dirty field — the (b) fix); reconcile (saved flip) ONLY in queue.then after server-confirmed id; onsave fails LOUD on missing token/collective (was silent return — the (a) fix). **Honest partial-failure**: first save = createOwnProfile(shell) then saveProfileFields; if field-write fails AFTER shell create, ProfileSaveError carries createdProfileId → queue.recordCreatedId sets confirmed[level].id (leaves fields unconfirmed) → retry takes existingId path (saveProfileFields only, NO duplicate entity). If the SHELL create itself fails, raw throw (not ProfileSaveError) → id stays null → retry creates fresh. Distinction is precise. Scope clean: NO T4.8 mandatory-completion gate (canSave allows name-blank if email set; no block-member-display). Card = runes ($bindable/$props), full Tailwind classes, feedback-as-reason (pending/saveFailed/saved distinct, RsvpControl lesson), saved is a pure prop (page decides). All on bg-paper (desk-readability trivially met; route auth-guarded, outside public gate). Gates team-lead-reported check0/test379/build; my GREEN static-provable. Minor non-issue: listMyProfiles has no count-truncation guard (cf inviteData.listOrganizations) but max 3 profiles vs limit=10 → ample, appropriate, not a gap.

(*MVOX:Bentham*)

## 2026-08-06 — #34 invite mint uses trigger CONSTANT not invitee email (feat/34-invite-constant @ 738ee39) — GREEN + 1 calibration note + 1 test-hygiene YELLOW-ish

[#34 2026-08-06 @ 738ee39 — GREEN] Privacy hardening on T4.5: `entu_user` person-create prop now carries `INVITE_MINT_TRIGGER='trigger invite token'` instead of `input.email`; email DROPPED from `CreateInviteInput` + the `@`-guard removed; admin page keeps email as client-side-only state (bearer-warning display) and stops forwarding it. Diff 4 files +46/-29 off merged #31 (6cbc494). Merge-shape clean: RED 05a8d3d (tests-only) → RED-fix 4eb138b (tests-only, aligns lib specs to no-email type) → GREEN-lib d3c8a49 (sole source change to inviteData.ts) → GREEN-svelte 738ee39. Staged set clean (4 expected files). **entu-api VERIFIED this turn**: mint path utils/entity.js:462 `if(type==='entu_user' && property.string)` inspects ONLY truthiness → any truthy string mints an identical `{db,entityId}` JWT + deletes the string; the string VALUE is never read on the create path ⇒ the constant produces a byte-identical token to what the email would have. No functional regression; the email simply never leaves the browser now. All invariants hold: inviteData still zero 'profile' (YELLOW-T4.4.1), entu_user create literal sole to inviteData:211, resolveTypeId(cfg,'profile') sole to profileData:76; person+member still hit the CREATE endpoint ('entity', no [_id]). RED integrity sound — the two DELETED tests (`@ts-expect-error _omitsEmail` pin + "rejects email without @" guard) legitimately pinned the REMOVED contract: keeping the `@ts-expect-error` would itself fail `pnpm check` (TS2578 unused-expect-error, since omitting email no longer errors) — so deletion is forced, not coverage-hiding. GREEN added a POSITIVE `not.toHaveProperty('email')` on the admin-page createInvite call args.

[GOTCHA-ENTU-SEND-INVITE-SES-LITERAL 2026-08-06 — standing] `'send-invite'` is a MAGIC entu_user string on the `POST /[db]/entity/[_id]` (add-property-to-existing) endpoint: index.post.js:122 `isSendInvite = body.some(p=>p.type==='entu_user' && p.string==='send-invite')` → :135 triggers Entu's SES email-send path (maps `{...p, email}`). It is inert on the create endpoint (`POST /[db]/entity`) which is all mvox uses. mvox correctly picked `'trigger invite token'` (≠ 'send-invite') so even if the value ever flowed to the [_id] endpoint it wouldn't fire SES — which is what we want (mvox shares the link MANUALLY, admin copies show-once link; we do NOT want Entu emailing invites). Review trigger: any future code writing entu_user via the [_id] endpoint must avoid the `'send-invite'` literal unless it intends Entu-side SES email.

[CALIBRATION-STRUCTURAL-IMPOSSIBILITY-BEATS-RUNTIME-BELT 2026-08-06] team-lead pointed at the body-level `JSON.stringify(personCall.body).not.toContain('mari@example.com')` as "the un-foolable test" — it is actually the WEAKEST of the 3 email-leak guards: given the email-less INPUT fixture, nothing feeds 'mari@example.com' into createInvite, so that assertion can't fail (near-vacuous in isolation). The genuinely un-foolable guarantee is STRUCTURAL: `CreateInviteInput` has no `email` field → a caller CANNOT forward it (compile-time impossibility), backed by the admin-page `not.toHaveProperty('email')` positive assertion on the sole caller. Goal IS soundly met (stronger than a runtime test because it's compile-time-impossible) — but don't credit the body-contains test as the proof. Sibling to the vacuous-async-test family: a test that can't fail proves nothing; here the TYPE does the proving. [TEST-HYGIENE YELLOW-ish, non-blocking, route Tallis: two leftover `@ts-expect-error` fixtures `_omitsMemberName={email:'e@x.ee',orgId}` + `_omitsOrgId={memberName,email:'e@x.ee'}` still carry a stray `email` — now an EXCESS property that ALSO errors, so those "required-field" guards would falsely pass even if memberName/orgId became optional (the excess-email error satisfies the expect-error). Drop the stray email so each errors only on the intended missing field. Minor precision erosion, not a gap today.]

(*MVOX:Bentham*)

## 2026-08-06 — #31 T4.5 invite (feat/t4.5-invite @ ef85215) — GREEN + 1 carry + 2 minor notes

[#31 2026-08-06 @ ef85215 — GREEN] Native entu_user + invite-JWT flow, browser-direct, no BFF. Merge-shape clean: RED 9fbadaf (tests + stubs that throw `not implemented — T4.5 GREEN` unconditionally, tagged *MVOX:red-phase* → assertions fire, TDD-genuine) → GREEN 32758b0 → i18n a62f76e → fix ef85215; 4 commits off 7838989, staged set clean (only src/ + messages/, no stray memory/docs). **All entu-api citations VERIFIED against ~/projects/entu-api this turn**: (1) admin gate is a **400** not 403 — utils/entity.js:256 `if(!parentAccess.includes(entu.userStr) && !entu.systemUser) throw 400 'User not in parent _owner,_editor nor _expander'` (finding #4's 403→400 comment fix is CORRECT; 403 'No user' is the no-session case). (2) invite mint entity.js:462-467 `jwt.sign({db,entityId},secret,7d)` + `delete property.string` ⇒ token payload is exactly db/entityId/iat/exp, NO email (parse-invite-token honest about this). (3) later GETs mask invite='***' (594-598) ⇒ create-response is the ONLY token read; inviteData extracts from it, never re-reads. (4) inheritParentProperties 296-327 copies _sharing/_inheritrights from parent ONLY when omitted ⇒ inviteData sets EXPLICIT _sharing (person 'domain', member 'private') + _inheritrights on both (no silent parent-tier inherit; matches single-collective pivot domain=in-collective). **Redemption classification (redeem.ts) fully verified against auth/index.get.js:199-267**: inviteAttempted (valid session+invite param) suppresses auto-create (:237); `{new:true}` added ONLY by auto-create path ⇒ user.new tripwire sound; a valid session ALWAYS carries user.email (:116 throws 400 w/o it ⇒ res.ok false) ⇒ the body.user.email discriminator between terminal `dead` and retryable `failed` (session-key-itself-failed) is reliable. AC1 (no auto-provision) genuinely enforced. Persist sequence setUser-before-setToken correct; `accounts` was DROPPED from storage in T3 (JWT claims carry it) so no setAccounts to call — both callback paths parity. State-blob hygiene REAL (finding #1): runCallbackExchange reads-then-removes OAUTH_STATE_KEY up front (single-use), clearAll drops it on logout, landing removes any stale blob on render ⇒ caps invite-bearer-token localStorage lifetime. Sole-mechanism greps all hold across full src/** (.ts+.svelte): entu_user→inviteData:207 only, auth?account=→redeem:79 only, resolveTypeId(cfg,'profile')→profileData:76 only; inviteData contains ZERO 'profile'. No old slice-3 markers (ENTU_SERVICE_KEY/elevated.ts/api/invite) — AC3 single-mechanism confirmed. i18n 30 keys × 4 locales full parity, every rendered key present. check 0 / test 331 / build (team-lead-reported; my verdict is static-blob-provable, gate-independent).

[GUARD EVOLUTION — soleCreatePath.spec T4.4 marker `_inheritrights` is NO LONGER profile-unique; allowlist now ENUMERATED {profileData.ts, inviteData.ts}. Sound, not a weakening.] T4.5's inviteData legitimately sets _inheritrights on person+member (non-profile creates), so the old "only profileData sets it" premise broke. Revision: (a) EXEMPT=['lib/profile/profileData.ts','lib/invite/inviteData.ts'] on the _inheritrights marker; (b) NEW compensating assertion — inviteData.ts must contain zero 'profile' substring; (c) utils extracted to $lib/testing/soleLiteralGuard.ts (findSourceFiles now walks .ts AND .svelte so a UI-side rogue path isn't blind), all 4 predicate unit tests kept+strengthened. No net weakening: rogue profile-create in a NEW non-allowlisted file still caught by the marker; smuggled into inviteData caught by the 'profile' assertion; profileData stays the sole createProfile path. **REVISED STANDING MOVE for T4.6/T4.7/T4.10**: the `resolveTypeId(cfg,'profile')`-sole-to-profileData grep is now the PRIMARY profile-sole check (the _inheritrights allowlist is secondary/explicit-create-sole with 2 legit entries). Each new profile create MUST funnel through createProfile — a T4.6 lazy-create hand-rolling a create in a new file is caught by the marker; verify it doesn't add itself to EXEMPT and doesn't hand-roll a create omitting _inheritrights (silent-leak shape — the pre-existing unchanged marker-blindspot; grep is the backstop).

[CARRY-T4.5.1 (mirrors YELLOW-RSVP.1) — admin /admin/invite $effect has no request-supersession/requestId guard + doesn't reset orgId on db change → stale cross-db orgId + load race. UNREACHABLE under single-collective (selectedDbStore resolves once, never changes → effect runs once, no race; a wrong orgId would fail LOUD at Entu member-create, not corrupt silently). Team-lead adjudicated-away = confirmed correct. NOT a blocker. If multi-collective returns: mirror loadForSelected's requestId guard (capture thisRequest at effect top, gate assignments) + reset orgId='' on db change.] Minor notes (non-blocking, no fix owed this PR): (i) provider labels in $lib/auth/providers.ts are verbatim-extracted from the login page's pre-existing list — 'Continue with Google' is untranslated English now rendered on a 2nd surface (invite landing) in et/lv/uk; pre-existing gap, i18n-backlog. (ii) multi-org <select> has no placeholder <option value=''>; initial orgId='' — likely benign (Svelte bind:value reconciles unmatched '' to selectedIndex=-1/blank so first-org selection fires change) but multi-org selection is unit-untested (spec only covers sole-org preselect) → live-gate candidate at T4.9; optional polish = add a disabled placeholder option.

(*MVOX:Bentham*)

## 2026-08-06 — #25 T4.4 single profile-create path (feat/t4.4-profile-create @ 9a8d1dc) — GREEN + YELLOW-T4.4.1 (forward-looking guard gap)

[#25 2026-08-06 @ 9a8d1dc — GREEN] `createProfile` is THE profile-visibility wall (T4.3 removed the type-level `_sharing` cap → entity's own fields are the only enforcement point). Verified adversarially: (1) TYPE contract non-omittable — `_inheritrights: false` (literal, not boolean) + `_sharing` union both REQUIRED; 4 `@ts-expect-error` proofs ALL load-bearing (pnpm check 0 errors ⇒ TS2578 guarantees each suppresses a real error — a clean check IS the proof the contract didn't regress; no need to edit-to-demo removal). Forward guard (valid shape, no directive) confirms no over-reject. (2) Runtime guards at profileData.ts:65-74 fire BEFORE resolveTypeId (:76) i.e. before ANY network; tests assert on field-naming regex + `fetchImpl not called` (not vacuous — RED stub threw unconditionally so message-match only passes with the real guard). (3) `_owner`: one per ownerIds, NO `_owner` key when absent (`?? []`). Citation `entu-api utils/entity.js:404-410` VERIFIED accurate — exactly `if (entu.user){ push _owner=entu.user }`, caller auto-added, independent of `_inheritrights`. `_sharing`-values citation :198-201 also accurate. (4) Fail-loudly: non-2xx create→throw+status; 2xx-no-`_id`→throw naming `_id`; type-res non-2xx→resolveTypeId throws+status. No swallow. Gates at pinned HEAD (BEFORE==AFTER==9a8d1dc, clean tree): check 0 / test 238 (24 files) / build clean. Merge-shape: RED tests-only 94698a7 → GREEN 9a8d1dc, 3 profile files only, specs frozen from RED (GREEN touched only profileData.ts +59/-11, no assertion weakening).

[YELLOW-T4.4.1 — sole-path structural guard keys on the `_inheritrights` literal; a create that OMITS it evades the guard. Forward-looking, ZERO current exposure.] soleCreatePath.spec.ts flags any non-spec/non-exempt src file containing the substring `_inheritrights` (predicate unit-tested 4 ways; integration walks real src/lib+src/routes; 0 violations today — genuine forward guard, not vacuous). BUT the marker is `_inheritrights`, so it catches the realistic drift (a 2nd path COPIES the create pattern incl. `_inheritrights`) and NOT the exact silent-leak shape (a hand-rolled profile create that omits `_inheritrights` entirely → Entu copies parent `_sharing`; public person-parent ⇒ public profile — verified mechanism entity.js:296-330 inheritParentProperties). Not blocking: (a) secondary/structural AC; (b) independently grep-confirmed only profileData.ts:76 resolves the `'profile'` type today — no competing create path exists; (c) the 4 real sites (T4.6×3/T4.7/T4.10) don't exist yet, each funnels through createProfile under my review when they land; (d) no BFF ⇒ enforcement is discipline-by-review anyway ([[entu-creation-rights-unenforced]]). STANDING MOVE for T4.6/T4.7/T4.10 reviews: verify each create resolves the profile type via createProfile (grep `resolveTypeId(cfg, 'profile'` stays sole to profileData.ts), not merely that `_inheritrights` appears. A complementary guard keyed on profile-type resolution would close it, but is over-engineering until a 2nd site exists.

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
