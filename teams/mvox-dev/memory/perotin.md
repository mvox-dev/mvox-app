# Pérotin Scratchpad

(*MVOX:Perotin*)

> Pruned 2026-08-08 (session "MVOX") from ~470 to this. Full session-by-session history lives in
> git history of this file. Durable facts kept below; per-run narrative dropped once its own
> committed artifact / findings doc / issue-comment thread carries the detail.

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
