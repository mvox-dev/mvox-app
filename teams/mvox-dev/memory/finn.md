# Finn — Research Coordinator Scratchpad

> Pruned 2026-09-07. Full pre-prune history in git log of this file.

## [PATTERN] Entu rights: two independent gate systems, don't conflate them (2026-09-06/07, #264 + #265)

Confirmed by reading `~/projects/entu-api` + `~/projects/entu-www` live (not memory-sourced):

- **Write-rights gates** (who may mutate): `_owner`/`_editor`/`_expander`/`_viewer` tiers, ASYMMETRIC per verb.
  POST `/entity/{id}` (add a property) needs only `_editor` — `entity.js:21-29` `setEntity`'s own `rightTypes`
  list (used for owner-escalation) excludes `_parent`. DELETE `/property/{id}` needs `_owner` for any
  rights-type property INCLUDING `_parent` — `property/[_id]/index.delete.js:56-65` includes `_parent`
  in its `rightTypes`. **This asymmetry caused #264**: editor-only user's POST-new-`_parent` succeeds,
  paired DELETE-old-`_parent` 403s → stranded duplicate. Canonical docs confirm:
  `entu-www/src/api/properties/index.md:139`. **Native atomic fix**: POST an array with the OLD property's
  `_id` included (`entity.js` `insertProperties` L440-444 + `markPropertiesDeleted`) replaces in one call
  under the EDITOR-only gate, never touching the owner-gated DELETE path — docs call this "Overwriting a
  Property Value" (`entu-www/src/api/properties/index.md:78-88`). Rights auto-cascade upward at aggregation
  time: `_owner`⊆`_editor`⊆`_expander`⊆`_viewer` (`aggregate.js:188-209`) — an editor is structurally also
  an expander on that same entity. Property authorship is NEVER checked in these gates — entity-level
  array membership only.

- **Read-visibility gates** (who sees which field): the "3-gate-AND" model (in-house term,
  `~/workspace-app/scripts/migrations/tidy-td2b-tier-alignment.ts:101-104`) — gate1 = prop-DEF's own
  `_sharing`, gate2 = entity TYPE's `_sharing` (CAPS gate1, never floors), gate3 = entity INSTANCE's
  `_sharing`/rights (governs whether the entity is readable at that tier at all, independent of 1+2).
  `aggregate.js`: `private[type]` always fully populated regardless of sharing (`propertiesToEntity`
  L337-368); domain/public are a separate additive loop (L112-156) keyed ONLY on gate1+gate2, run
  INDEPENDENTLY per property-definition — so **one entity CAN have `name`@domain + `phone`/`email`/
  `birthdate`@private simultaneously**, this is the platform's designed mechanism, not a workaround.
  Docs match exactly: `entu-www/src/configuration/entity-types/index.md:103-133`.
  **mvox tooling gap** (not a platform limit): `~/workspace-app/scripts/migrations/lib/mvox-schema-
  extensions.ts` `PropertySpec` has NO `sharing` field — `MvoxEntityDef.sharing` is one value for the
  whole type, applied uniformly to every prop-def by every real call site (e.g.
  `seed-246-schedule-item-type-polyphony-2026-09-06.ts:72`). A one-entity-mixed-sharing shape needs this
  extended first (optional per-property `sharing` override, fallback to type-level) before provisionable.

## [DECISION] repo-guard MANDATORY first line in every dispatched research prompt (2026-09-01)

Structural guard, not vigilance-per-dispatch: subagents have repeatedly read `~/workspace` (stale, remote
`mvox_v4e_web.git`) instead of `~/workspace-app` (remote `mvox-app.git`) despite explicit instructions,
producing coherent-but-entirely-wrong reports. Every subagent prompt I write opens with
`cd ~/workspace-app && git remote get-url origin` — abort unless it ends `mvox-app.git`. Baked into
`/mvox-pickup`; increasingly moot as pre-RED research runs as dynamic Workflows with the guard wired in,
but still apply it myself for any ad-hoc subagent I dispatch outside a Workflow.

## [GOTCHA] Two separate git repos share a naming collision

`~/workspace-app` (remote `mvox-dev/mvox-app.git`) is the live app repo. `~/workspace` (remote
`mvox_v4e_web.git`) is an older/redirected repo with its OWN `.git` — same codebase lineage, distinct
working tree. An absolute Write without spelling `~/workspace-app/...` in full can land silently in the
wrong tree (no error, just an orphaned untracked file). Always spell the path in full, never rely on cwd.

## [DECISION-INPUT] Rights props live ONLY in `private.*`, never copied to domain/public (verified against source, 2026-08-08)

Now largely superseded in detail by `~/workspace-app/docs/architecture/entu-rights-and-visibility-model.md`
§3 — read that for full mechanics. Bottom line still load-bearing: any caller's admin/editor determination
for ANY entity = `GET entity/{id}?props=_owner,_editor` + check own id in the returned array; absence of
the key = fail-closed "not admin". JWT `accounts` claim carries zero rights data. API-key auth
(`routes/auth/index.get.js:148-152`) is a raw Mongo `.findOne()` on `private.entu_api_key.string` — bypasses
the aggregated/rights-filtered view entirely, unaffected by narrowing a prop-def's `_sharing`.

## [PATTERN] Honest [unverified] flags are the deliverable, not a hedge (2026-09-05, Gama via #258)

Standing rule: always separate "verified" from "safe-by-tracing-with-named-assumptions" — never round the
second up to the first, and name every assumption not independently checked rather than omitting it for a
cleaner report. Same standard as Bentham's rulable-not-persuasive.

## [DECISION-INPUT] polyphony.uk IS the polyphony prototype's own prod deploy (#177, 2026-08-27)

`polyphony.uk`/`crede.polyphony.uk` = `~/projects/polyphony` deployed live, not foreign. Real Crede data
sits locally: `~/projects/polyphony/apps/vault/production-backup.sql` (D1 dump, committed 2026-02-02 —
confirm freshness before any real migration run). 22 `members` rows, single org `org_crede_001`.
`profileData.ts` `createProfile()` does NOT take name/email — separate property POST needed per profile.

## [DEFERRED] /library filter voicing/language field name mismatch (still open, low priority)

`work.voicing`/`work.language` fetched but schema fields are `original_voicing`/`original_language`. Needs
a live DB probe before filter UI lands.

(*MVOX:Finn*)
