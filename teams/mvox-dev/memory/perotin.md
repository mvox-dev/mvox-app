# Pérotin Scratchpad

(*MVOX:Perotin*)

> Pruned 2026-08-07 (session "MVOX") from ~1990 to this. Full session-by-session history lives in
> git history of this file. Durable facts kept below; per-run narrative dropped once its own
> committed artifact / findings doc / architecture-decisions.md entry carries the detail.

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
**its own parent**. Absent default = `true` at create. An org's own `_inheritrights:false` blocks
cascade INTO the org from its parent (umbrella/db) — it says nothing about whether the org's
CHILDREN inherit from the org; that's controlled by each child's own `_inheritrights` (sections/
members/agenda nodes are `true` by design, so org `_viewer` grants cascade down through them).
(Session-39 entry corrected an earlier wrong model that had this backwards — this is the settled
version.)

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
trap: a script can "successfully" set gate 1 and still change nothing. Always read-verify gate 2
live before trusting gate-1-only fixes (real incident: #20/mvox-app, 2026-08-07 — `member.person`/
`member.section` prop-defs had no `_sharing`; fixed by setting both to `domain`, but the fix also
needed a live check that `member`'s TYPE entity itself was already `domain`, which it was).

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

**`~/workspace` (mvox_v4e_web) — legacy, stable, not actively extended:**
seed-voices.ts · seed-collectives.ts (120p/235m/6o/16s) · seed-po-member-ekf.ts ·
seed-librarian-bundle-data.ts (CHORE-60 EPCC library subtree) · seed-menu-items-per-entity-type ·
seed-rsvp-tally-prop-defs (rsvp/event formula tally props) · seed-mvox-collective-marker (app-ext
type, PO-approved, not canonical v4E) · cleanup-menu-usability · cleanup-rename-photo-prop-def-only ·
cleanup-fila-hooaeg-end-date · cleanup-mvox-collective-test-hidden · Phase B/C/D cleanup scripts
(migration body of work, complete — polyphony is v4E-schema-aligned as of Phase C/D closeout).
perotin-toolkit.ts: `isDryRun()`, `writeResultArtifact()`, `replaceProperty()`, `findOrCreateByName()`
— consumes Josquin's `lib/entu-client.ts` primitives, doesn't duplicate.

**`~/workspace-app` (mvox-app) — active:**
t3-1-provision-singers-2026-08-07.ts + lib/t3-1-singer-provision.ts (T3.1 bundles 1+2: 128 domain
profiles + 128 tier conversions, live 2026-08-07, reconstructed artifact
`seed-results/t3-1-bundles-1-2-3-reconstructed-2026-08-07T10-46-51-000Z.json`) ·
t3-1-bundle3-remove-member-name-2026-08-07.ts (schema mutation, same artifact) ·
t4-10-migrate-name-email-to-profile-2026-08-07.ts (built, dry-run-only, CLOSED superseded —
never ran live, see Deferred below) · cleanup-scope-add-user-t4-1-2026-08-06.ts ·
cleanup-t4-3-profile-type-person-reduction-2026-08-06.ts (both of these two are recorded in THIS
repo's history per my own scratchpad, but team-lead's audit found `git log --all` on workspace-app
shows no trace — treat as workspace-app-absent until re-confirmed; don't hunt for files that aren't
there). **workspace-app's `seed-results/`+`probes/` dirs did not exist before 2026-08-07** — going
forward, every live workspace-app run gets a committed artifact via the same toolkit pattern (port
`perotin-toolkit.ts` over if/when a second script needs it — not yet extracted there).
widen-member-refs-2026-08-07.ts + lib/widen-member-refs-2026-08-07.ts + .spec.ts (#20 fix: 2
prop-def `_sharing` writes + 245-member touch-save sweep, live 2026-08-07, result artifact
`seed-results/widen-member-refs-2026-08-07-live-2026-08-07T15-24-56-647Z.json`). Has a
`BASELINE_DOMAIN_MEMBER_IDS` frozen-set drift-check (245 ids) — reusable pattern for any future
script needing to disambiguate "population changed" from "count happens to match."

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

## Authorization gate — canonical statement (cross-ref `[[feedback_authorization_gate]]`)

Explicit inbound `"I authorize this run"` SendMessage **from team-lead** is the only valid gate —
not dry-run-clean, not Bentham GREEN, not task-assignment wording that merely states authorization
happened elsewhere, not a prior categorical "go ahead" covering a DIFFERENT script than the one
about to execute. Content AND routing (`from: team-lead`) both must check out. Re-verify per new
script/target-set even under a standing "go ahead," since a live write can hit a corner neither
dry-run nor code review caught — this has happened for real, more than once (Phase D sub-op 1
briefly nulled PO's name; T4.10 caught two separate real conflicts across two independent dry-run+
verify rounds that never went live). If >15 min pass past an expected authorization, send a status
ping — never self-authorize.

## Currently deferred / not scheduled

- **T4.10 (#30) profile migration** — CLOSED superseded 2026-08-07, never ran live. Mihkel ruled:
  don't run it; the one real target's data was already re-established via the shipped profile-edit
  UI (T4.6). Zero migration writes across the whole arc.
- **#9 (T4.8 EntuUser.name prefill)** — Mihkel-blocked per team-lead's 2026-08-07 checkpoint, not
  data-manager work.
- **#20 last-mile** — the rights-narrowing gap itself (below) is fixed + live-verified by db-root.
  What's left is Mihkel's real-browser confirmation that a genuine non-owner domain reader now sees
  `person`/`section` on a member — db-root can never observe this (always reads private bucket).
- **entu_api_key requires `_owner` (not just `_editor`)** on live api.entu.app — confirmed by direct
  reproduction 2026-08-05, contradicts the local `~/projects/entu-api` clone's `checkEntityAccess`
  `rightTypes` list (no `entu_api_key` entry there). Live/local source drift, unresolved — no
  credential I hold can fix it (only an existing `_owner` can grant `_owner`, circular). Needs PO to
  grant `_owner` directly via Entu UI or a fresh OAuth login on the affected reader person.
- **`lib/v4e-translator.ts` `translatePropertyDef`** never sets `_sharing` on new prop-def entities
  (checked function body) — harmless today (parent type has no `_sharing` on the affected census),
  would silently under-share future prop-defs under a shared parent type. Flagged to Josquin, not
  mine to fix (lib is his territory).

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

## Entu meta-schema ids (verified 2026-08-08, #41)

Prop-def entities (per-type field declarations) are `_type.reference`'d to the **"property"**
meta-type entity `69bcfd8e9c031ab8e6ce8048` — NOT the "entity" meta-type `69bcfd8e9c031ab8e6ce8034`
(that id is the meta-type for TYPE-DEFINITIONS themselves — person/member/organization/etc. are
`_type.string=entity`, 27 total = 22 content types + 5 system types: database/entity/menu/plugin/
property). `probe-person-propdef-sharing-2026-08-07.ts` used the WRONG id (entity, not property) and
would have silently returned zero prop-defs for every type — caught + fixed while building
`probe-epic37-phase1-inventory-2026-08-08.ts` (correct query: `_type.reference=<property-meta-id>&
_parent.reference=<typeId>`). That 2026-08-07 script's own findings were never actually load-bearing
(the #20 fix was verified through direct entity/{id} reads, not this listing), so nothing shipped
wrong — but don't reuse the old script's constant.

Menu (`_type.string=menu`, 23 rows) and plugin (`_type.string=plugin`, 4 rows) are their own
top-level content kinds, siblings of "entity"/"property", not children of anything.

## #47 menu-empty-shells LIVE (2026-08-08) — 3/3 privatized, D4 complete

Repertoire/Programme/Attendance narrowed to admin-only, zero failures. Menu domain-tier: 21/23 →
18/23. Member-seat verification + 22-vs-11 discrepancy stay parked (see dry-run entry). Artifact:
`seed-results/menu-empty-shells-2026-08-08-live-2026-08-08T04-39-40-017Z.json`.

## T6.2b instance-tier widen DRY-RUN (2026-08-08, #57/epic #54) — gate-3 gap closer, holds on Mihkel

Gama's STOP (2026-08-08 11:00 on #54): T6.2 widened prop-defs + touch-saved instances, but
touch-save re-asserted the SAME 'private' value — gate 3 (instance's own _sharing) never moved, so
nothing was actually member-readable despite T6.2's clean 598/598 execution. **Real lesson: a
visibility scope is complete only when it names all 3 gates** — T6.2's scope (mine to execute, not
mine to have scoped) only ever asked for prop-def widen, so gate 3 was never in question until now.
T6.2b closes it: gate 2 re-verified live for all 4 types (all pass, domain) — that was NEVER the
blocker, gate 3 always was. 586-instance replace private→domain planned (genuine tier change this
time, not touch-save), canary-per-type, 0/586 non-db-root-owned. Reused T6.2's TYPE_IDS/
verifyInstances rather than duplicating. **Live execution HOLDS on Mihkel's explicit nod** even past
Bentham+team-lead auth — do not self-authorize past that line. Chain posted on #57 itself (not #54)
per this task's explicit ask. Artifact:
`seed-results/library-instance-tier-widen-2026-08-08-dry-2026-08-08T08-04-12-528Z.json`.

## T6.2 library-visibility LIVE (2026-08-08, #56/epic #54) — 598/598, 0 failures, T6.2 complete

Bundle A 12/12 prop-defs set, Bundle B 586/586 instances touched (4 canaries per-type all passed
first). Zero failures across the whole run. Library 1.0's field-set visibility mutation is done —
next up in the epic is T6.3 (browse surfaces) + eventual T6.5 live-gate (real member seat confirms
the ruled fields render and a negative-control field doesn't). Artifact:
`seed-results/library-visibility-2026-08-08-live-2026-08-08T07-57-00-009Z.json`.

## T6.2 library-visibility DRY-RUN (2026-08-08, #56/epic #54) — plan built, 0 writes

12 prop-def writes (11 widen absent→domain + 1 narrow edition.cost domain→private) gated ahead of a
586-instance touch-save re-agg (work13+edition17+copy552+lending4), canary-PER-TYPE (4, since first
run of this mechanic on these types), #44 template. **Proactively ran the #44/#45 ownership
pre-check without being asked** (that lesson is now standing practice for any new mutation batch):
0/586 non-db-root-owned — unlike #44/#45 (both involved Mihkel's real OAuth identity), every library
entity here is script/seed-created, fully db-root-owned, no known rights-gap risk. All 12 prop-defs +
586-instance population re-verified live in the exact expected state, zero drift from T6.1. Live
entrypoint hard-aborts pre-write if the ownership check ever finds a non-db-root instance. Artifact:
`seed-results/library-visibility-2026-08-08-dry-2026-08-08T07-51-56-542Z.json`.

## T6.1 library field-set grooming (2026-08-08, epic #54) — read-only, gates T6.2

work/edition/copy/lending prop-defs re-verified live (zero drift from #41). **Real finding, corrects
the epic's own framing**: "copy and lending carry no _sharing at all" holds ONLY for those two —
`work` has 6/9 fields ALREADY domain (catalog_id, catalog_system, part_of, original_voicing/duration/
language), `edition` has 10/16 ALREADY domain (incl. `cost` — acquisition cost, worth a second look),
none of them the ruling's actual title/composer/name/publisher target fields (those 4 are still
private). `copy.location` **doesn't exist as a field** — ruling names it, schema doesn't have it
(copy only has name/copy_number/barcode/condition/notes). `lending`'s "lent-date" has no exact field
match (`assigned_at` is the best guess); `lending.copy` (+ maybe assigned_until/returned_at) is
plausibly REQUIRED for AC3's "availability per copy" but isn't in the literal borrower+lent-date
ruling — flagged as a design gap, not resolved. Posted full per-type table on #54, all ambiguities
flagged for Mihkel/PO rather than assumed. Artifact:
`seed-results/probe-55-library-fieldset-grooming-2026-08-08T07-44-05-000Z.json`.

## Single-tree collision, held correctly (2026-08-08) — T5.2/#52 active on feat/52-nav-shell

Mid-#53-dispatch, `git branch --show-current` showed `feat/52-nav-shell` instead of `main` (8 agents
running a nav-shell workflow, i18n files mid-edit). Halted BOTH #53 (irreversible) and #45 step3
immediately, reported branch+status+recent-log evidence twice (escalating uncommitted-file count
was the tell), did not switch/stash/work around. Team-lead confirmed: correct call, hold until
squash-merge. This is the pattern to repeat — branch check before EVERY commit is not decorative.

## #53 delete-corroborated-orphans LIVE (2026-08-08) — 7/7 deleted, disposition complete

Executed after tree returned to main (confirmed clean before running). All 7 read-back-confirmed 404,
zero failures. Orphan-115 disposition fully closed: 7 deleted, 108 hidden (97 without-twin + 11
uncorroborated), 0 domain-visible. Artifact:
`seed-results/delete-corroborated-orphans-2026-08-08-live-2026-08-08T05-08-52-354Z.json`.

## #45 D2 complete (2026-08-08) — step2 verified + step3 live, script fix along the way

Specimen confirmed 404 (Mihkel's direct delete). Step 3: 4 prop-defs + application TYPE entity
deleted, 5/5, zero failures — NOT Mihkel-owned (Gama's cautioned stop-at-seam scenario didn't fire).
**Fixed a real script bug**: `verifyAllTargets` unconditionally re-checked all 4 D2/D5 targets even
though steps 1/2/4 had already landed (their entities correctly gone, not drift) — added
`verifyStep3Only` (checks only the application type + live instance count) rather than loosening the
shared function's contract used by dry-run/other steps. D2+D5 both fully complete now. Artifact:
`seed-results/retire-application-probe-bulletin-2026-08-08-step3-live-2026-08-08T05-10-53-704Z.json`.

## #53 delete-corroborated-orphans DRY-RUN (2026-08-08) — 7/7 pass, 0 writes

Loads the 7 corroborated ids DIRECTLY from the committed #46 corrected-comparison artifact (not
re-typed), re-verifies each live (exists, `_sharing:private` per Phase C, name unchanged), and
cross-checks zero overlap against the 11 uncorroborated rows from that same artifact. Per-row ledger
carries orphan id + twin person/member id + matched name + matched section parent id + basis, per
Gama's requirement. All 7 pass. Artifact:
`seed-results/delete-corroborated-orphans-2026-08-08-dry-2026-08-08T04-38-37-584Z.json`.

## #47 menu-empty-shells DRY-RUN (2026-08-08) — plan built, 0 writes

Repertoire/Programme/Attendance (0-instance types) → admin-only via `DELETE /property/{sharingValueId}`,
same mechanic as #45 step1. All 3 re-verified live (domain, genuinely 0 instances). Computed model:
21/23 → 18/23 domain-tier. **Member-seat verification not performed** — `ENTU_ADMIN_KEY` confirmed
anonymous floor JWT (#44 finding), no working member seat exists locally; explicitly labeled
computed-not-observed. **The 22-vs-11 discrepancy is PRE-EXISTING, from #37's own 2026-08-07
walkthrough history** (not something I derived) — quoted verbatim in the plan output rather than
diagnosed; team already marked its mechanism "unknown," parked for Mihkel's real-browser check.
Artifact: `seed-results/menu-empty-shells-2026-08-08-dry-2026-08-08T04-36-00-055Z.json`.

## #46 corrected section signal via `_parent` refs (2026-08-08) — 7/18 now corroborate

Gama correction: section membership lives in the `_parent`-reference shape (member is multi-parent
under org + section, each `_parent` entry's own `entity_type` distinguishes them — confirmed live,
every twin member has exactly one `organization` parent + one `section` parent), NOT the legacy
`section`/`current_section` PROPERTY (0/131 populated, per the original dry-run). Re-ran the 18
exact-name matches against this corrected signal: **7 corroborate** (name + section-by-reference-id
both match), 11 don't. **Precision lesson for future comparisons**: of those 11, only 5 are genuinely
different section NAMES (e.g. Baritone vs II Tenor) — the other 6 share the SAME section name across
TWO DIFFERENT section entities (sections are per-org, not global; e.g. two choirs each have their
own "I Tenor"). Comparing by reference id (not name string) was the right call — comparing by name
would have false-corroborated those 6. Read-only, no mutations; grounds a future §8.6 delete task for
the 7 corroborated orphans if that direction is taken. Artifact:
`seed-results/probe-46-parent-section-corroboration-2026-08-08T04-31-31-000Z.json`.

## #46 orphan-115-disposition COMPLETE (2026-08-08) — Phase C live, 115/115 hidden

Phase B skipped (0 delete candidates, structural — see dry-run entry below). Phase C executed after
Bentham GREEN + explicit "I authorize Phase C": all 115 orphan members' `_sharing` domain→private,
zero failures, all read-back-confirmed. #46 disposition is DONE. Hidden-rows eventual disposition
(archive/export/delete) stays PARKED for Mihkel, no timeline. Artifact:
`seed-results/orphan-115-disposition-2026-08-08-phaseC-live-2026-08-08T04-29-17-136Z.json`.

## #46 orphan-115-disposition DRY-RUN (2026-08-08) — Phase B mechanically EMPTY

Phase A (loose-match, always read-only): 18 exact, **0 loose** — normalizing case/diacritics/
whitespace across the 97 unmatched orphans found nothing new against the full 132-person pool.
Phase B (delete corroborated twins, name+section): **0 candidates — structural, not a bug.**
0/131 linked/twin member rows carry ANY section/current_section value (confirmed live), while
115/115 orphans do — the corroboration comparison always lands `n-a`, never `yes`, even for the 18
exact matches. Did NOT loosen the criterion to manufacture deletes (would violate "bare name match
alone is NOT sufficient" from the other direction) — flagged for Mihkel: accept 0 deletes this round,
or define an alternative corroboration signal. Phase C: all 115 → hide (97 no-match + 18
section-data-absent). Entrypoint gates live execution per-phase (`PHASE=B|C`), Phase C recomputes
fresh each run so it naturally reflects any prior Phase B deletions. Artifact:
`seed-results/orphan-115-disposition-2026-08-08-dry-2026-08-08T04-25-04-527Z.json`.

## Epic #37 session — 2026-08-08 (Phase 1 inventory through #46 pre-check)

Chronological, all live 2026-08-08, all posted as structured comments on #37 (single source of
truth for full detail — this is the compressed pointer).

**#41 Phase-1 inventory**: 246 members (245 domain + 1 private/fixture-B) · 132 persons (128
T3.1-synthetic + 4 real: db-root/Mihkel-OAuth/TestUser/fixtureB) · 115 orphan members, exact-name
partition vs the 132 persons = 18 with-twin / 97 without-twin · person carries 18 `_sharing:domain`
prop-defs (not ~15 as estimated — full list + ids in the meta-schema-ids section above) · member
carries 4 (person/section/current_section/status), all domain · 3 empty-shell menu entries
(repertoire_item/program_item/attendance) · `_probe_bulletin` = 3 inert test rows. Orphan
`member.name` values are STILL LIVE-READABLE via direct API despite no prop-def (data persists,
only the render-hint is gone — don't conflate "no prop-def" with "no data"). Artifact:
`probe-epic37-phase1-inventory-2026-08-08T02-19-47-000Z.json`.

**#43 credential pre-check → STOP, then #44 gate check → resolved not-exposed**: 1/132 persons
(db-root `...8079`) carries `entu_api_key` (0 carry `entu_passkey`) — triggered #43's STOP. #44's
follow-up gate check found it's NOT domain-bucket-visible: the person entity's own `_sharing` is
`private` (gate 3 of 3-gate-AND caps it regardless of prop-def/type both being domain). Also found:
the property carries 3 STACKED historical values (POST-append-never-replace), not 1 — aware-only,
not itself new exposure. `ENTU_ADMIN_KEY` (only other local credential) resolves to an ANONYMOUS
FLOOR JWT (`accounts:[]`) — confirmed NOT a real second seat, don't re-try expecting otherwise.
Artifacts: `probe-credential-precheck-2026-08-08T03-35-01-000Z.json`,
`probe-44-domain-bucket-check-2026-08-08T03-41-53-000Z.json`.

**#44 narrow-person-refs (18 person prop-defs domain→private + 132-person re-agg)**: dry-run built
mirroring #20's Bundle-A/B/canary/ledger shape (opposite direction). Real finding: of the 18 targeted
props, only 3 carry ANY value across all 132 persons (voice=8, entu_user=3, entu_api_key=1) — the
other 15 are 0/132 everywhere, so narrowing was a schema-hygiene no-op for most of the list. Live run
(after Bentham GREEN + explicit authorization): Bundle A 18/18 narrowed; canary (db-root) touched +
NEW credential-self-test gate PASSED (`touchSaveCanaryAndSelfTest` — re-exchange ENTU_API_KEY, read
the just-touched canary, hard-stop before the sweep if it fails; reusable pattern); sweep 131/132
touched, **1 FAILURE**: person `6a2fc05e4cd971291c5d5ddc` (Mihkel's real OAuth identity, not
script-created) — 403 on the `_sharing` touch-save, db-root lacks `_owner` there. Surfaced, not
retried. Artifacts: `narrow-person-refs-2026-08-08-dry-2026-08-08T03-48-53-149Z.json`,
`...-live-2026-08-08T03-54-57-759Z.json`.

**#45 retire-application (D2) + delete _probe_bulletin (D5)**: 4 independently-gated steps
(`STEP=1|2|3|4`, entrypoint refuses combined execution). Step 1 (privatize "Applications" menu via
`DELETE /property/{sharingValueId}`, matching the existing "Billing" entry's absent-`_sharing`
shape) — chosen over full removal as the more reversible option satisfying "remove/privatize",
**live SUCCESS**. Step 2 (delete stale specimen `6a2fdac6...5e79`, confirmed 3.5wk past
`expires_at`) — **live FAILED 403, SAME person id `6a2fc05e...5ddc`** as #44's failure (owned by
that person + the "polyphony" db entity inherited, not db-root) — **second independent confirmation
of one underlying rights gap**, not two unrelated incidents. Halted per "any surprise stops at the
seam"; step 3 self-gates on zero live `application` instances anyway (would refuse). Step 4
(`_probe_bulletin`: 3 instances + 3 prop-defs + type entity) — **live SUCCESS, 7/7**, independent of
steps 1-3, run separately once authorized. D5 complete; D2 parked on the ownership gap. Artifacts:
`retire-application-probe-bulletin-2026-08-08-{dry,step1-live,step2-live,step4-live}-*.json`.

**#46 orphan-115 ownership pre-check** (requested by Gama, grounds the mechanism call before #46's
own dry-run): **all 115 orphan members are db-root-owned** (0 Mihkel-OAuth-owned, 0 other) —
population matches #41's baseline exactly, zero drift. Unlike #44/#45, **no rights-gap blocker for
this batch** — these are pre-v2-rewrite legacy rows, not entities created via Mihkel's real OAuth
account. Phase B (delete corroborated twins) and Phase C (narrow remainder to private) can proceed
against the full 115 without hitting the ownership wall. Artifact:
`probe-46-orphan-ownership-precheck-2026-08-08T04-19-35-000Z.json`.

**Open thread across #44/#45**: db-root is NOT `_owner` on entities created by/under Mihkel's real
OAuth identity (`6a2fc05e...5ddc`) — confirmed on 2 distinct entities (a person's own `_sharing`,
an `application` specimen's full entity). Script-created/synthetic entities are unaffected. Needs an
`_owner` grant from someone who already holds it (same shape as the pre-existing `entu_api_key`
`_owner`-not-`_editor` deferred item below) — not self-serviceable, PO/team-lead decision.
