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

- **115 legacy orphan `member` rows** (no `person` ref, no `status`, carry raw `name` strings) —
  bundle-3's prop-def removal never purges existing values by design. PO-owned disposition
  question, unscoped, not scheduled.
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

## #44 narrow-person-refs LIVE (epic #37 D3, 2026-08-08) — 149/150 writes, 1 failure

Executed after Bentham GREEN + team-lead's explicit "I authorize this run". Bundle A: 18/18 prop-defs
narrowed domain→private, read-back verified. Bundle B canary (db-root `...8079`) touched + credential
self-test PASSED (ENTU_API_KEY re-exchanged + read the just-touched canary, per the new
`touchSaveCanaryAndSelfTest` gate this run introduced). Sweep: 131/132 touched, 1 FAILURE: person
`6a2fc05e4cd971291c5d5ddc` (Mihkel's real OAuth identity, not script-created) — 403 on the touch-save
POST. Rights-model gap (db-root lacks `_owner` on this specific non-synthetic entity's `_sharing`),
not a script defect — every OTHER real+synthetic person touched cleanly. Run exit 1, not claimed as
success, surfaced on #37 for operator repair (likely needs an `_owner` grant, outside my authority).
Artifact: `seed-results/narrow-person-refs-2026-08-08-live-2026-08-08T03-54-57-759Z.json`.

## #44 narrow-person-refs DRY-RUN (epic #37 D3, 2026-08-08) — plan built, 0 writes

`narrow-person-refs-2026-08-08.ts` + lib, mirrors #20's Bundle-A/Bundle-B/canary/ledger shape exactly
(opposite direction: domain→private replace, not absent→domain create). All pre-checks passed live:
18 prop-defs re-confirmed domain with current _id captured; 132 persons re-confirmed (matches #41,
no drift); tier breakdown `{private:1, domain:3, public:128}`, all have an explicit _sharing value
(uniform touch-save path, no absent-value edge case). Canary = db-root person `69bcfd8e...8079`,
followed by a NEW-pattern hard gate this run uniquely needs: db-root's ENTU_API_KEY must
re-authenticate a trivial read AFTER the canary's own re-aggregation, before touching the other 131
(`touchSaveCanaryAndSelfTest` in the lib — reusable shape if a future narrow/widen ever touches the
credential-holder's own entity again). **Real finding**: of the 18 targeted props, only 3 carry ANY
value across all 132 persons (voice=8, entu_user=3, entu_api_key=1) — the other 15 are 0/132
everywhere. Narrowing is a schema-hygiene no-op for 15/18 props; flagged to team-lead/#37 since the
epic's stated "roster loses display affordances" consequence has little live surface to land on.
Artifact: `seed-results/narrow-person-refs-2026-08-08-dry-2026-08-08T03-48-53-149Z.json`. Awaiting
Bentham review + explicit "I authorize this run" before flipping DRY_RUN=false.

## #44 domain-bucket gate check (epic #37 D3, 2026-08-08) — resolved NOT-exposed

db-root's `entu_api_key` (the #43 hit) is NOT domain-bucket-visible: instance-level `_sharing` on
that person entity is `private` (gate 3 of 3-gate-AND), which caps the property out of the domain
bucket regardless of prop-def/type both being `domain` (gates 1+2). `ENTU_ADMIN_KEY` (the only other
local credential) resolves to an ANONYMOUS FLOOR JWT (`accounts:[]`) — NOT a real second member seat,
confirmed live; don't re-try it expecting a genuine cross-account read. Also found: the property
carries 3 STACKED values (POST-append-never-replace), not 1 — flagged for the rotation call, not
itself a new exposure (all sit behind the same private gate). Artifact:
`seed-results/probe-44-domain-bucket-check-2026-08-08T03-41-53-000Z.json`.

## #43 credential pre-check (epic #37 D3, 2026-08-08) — STOP triggered

1/132 persons carries `entu_api_key` (none carry `entu_passkey`): person `69bcfd8e...8079` =
db-root/PO's own identity, the same credential these probe scripts authenticate with — not an
orphan/leaked key, but per #43's scope a non-empty result is a hard stop. Posted on #37, awaiting
Mihkel/team-lead's call before #44 (D3 narrow) proceeds. Artifact:
`seed-results/probe-credential-precheck-2026-08-08T03-35-01-000Z.json`.

## #41 inventory pass (epic #37 Phase 1, 2026-08-08) — headline numbers

246 members (245 domain + 1 private = fixture B) · 132 persons (128 T3.1-synthetic + 4 real:
db-root/Mihkel-OAuth/TestUser/fixtureB) · 115 orphan members, orphan-vs-person exact-name-match
partition = 18 with-twin / 97 without-twin · person carries 18 prop-defs all `_sharing:domain`
(not ~15 as epic estimated) · member carries 4 prop-defs (person/section/current_section/status),
all domain · 3 menu entries point at zero-instance types (repertoire_item/program_item/attendance)
· `_probe_bulletin` = 3 inert Mihkel-created test rows, safe per §8.6. Orphan `member.name` values
are STILL LIVE-READABLE via direct API query despite the prop-def removal (data persists, only the
frontend's render-hint is gone) — don't conflate "no prop-def" with "no data" in future reporting.
Full breakdown + result artifact: `seed-results/probe-epic37-phase1-inventory-2026-08-08T02-19-47-000Z.json`,
posted as structured comment on #37.
