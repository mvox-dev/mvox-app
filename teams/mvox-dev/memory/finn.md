# Finn — Research Coordinator Scratchpad

## [DECISION-INPUT] polyphony.uk IS the polyphony prototype's own prod deploy (#177, 2026-08-27)

`polyphony.uk` (Registry) / `crede.polyphony.uk` (Vault) = `~/projects/polyphony` deployed live,
NOT a foreign legacy system. Real Crede data already sits locally, no live scrape/API needed:
`~/projects/polyphony/apps/vault/production-backup.sql` (= `prod-backup.sql`, full D1 dump,
committed `53d3f47` 2026-02-02 — **~7mo stale**, confirm freshness before a real migration run).
22 `members` rows, single org `org_crede_001`, minus 1 test row (`tester`/mihkel.putrinsh@gmail.com)
= 21 real candidates (20 if founder Mihkel Putrinš is excluded — judgment call, not mine).
Schema: `members(id,name,email_id,email_contact,nickname,invited_by,joined_at)` — only 2/22 have
`email_id` set, `email_contact` always NULL, 11/22 have `nickname`. Roles/voices/sections tables
exist and are real but out of scope for #176 (persons/members/profiles only).
**Live-fresher-pull path exists but untested**: `apps/vault/wrangler.toml` D1 binding
`polyphony-vault-db` (`0ecb378b-b9e3-4243-a5e9-9cf4ffe98fd2`) — `wrangler d1 export --remote`
would get current data IF mvox's `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
(`~/.config/mvox/credentials.env`) has access to that account (unverified, didn't probe live).
**mvox-app gotcha**: `profileData.ts` `createProfile()` (lines 60-104) does NOT take name/email —
only `{personId, _inheritrights:false, _sharing, ownerIds?}`. Name/email need a SEPARATE property
POST after create — any migration script needs 2 writes per profile, not 1. Full report sent to
team-lead, msg_id `3567230f`.

## [WIP] 2026-08-09 (S48) — shutdown mid-dispatch, 10 subagents lost mid-flight

Session ended via team-lead shutdown_request before any of 10 dispatched haiku
subagents returned. **None of these results were ever delivered** — re-dispatch
fresh if still needed:

- **#68 blocking Q1** (3 agents): can Entu write `_owner` where requester lacks
  `_owner`? (admin/superuser bypass, entu-www docs; entu-api setupDatabase/rights
  bypass; mvox-dev memory prior findings). NOTE: my own S46/S47 entries below
  already answer the MECHANICS of who sees `private.*` (cleanupEntity/getAccessArray)
  but not the WRITE-bypass question — that's still genuinely open.
- **#68 blocking Q2** (2 agents): verify S47's `cleanupEntity`/`getAccessArray`
  claim against current entu-api source (line nums may have drifted) + check
  `~/workspace/docs/architecture/entu-rights-and-visibility-model.md` +
  entu-www docs for the domain-sharing-doesn't-add-to-access-array question
  (observed: db-root sees rights on entities it owns but NOT on a `_sharing:
  domain, _inheritrights:false` profile it doesn't own — consistent with S47
  but unverified against current line numbers).
- **#68 follow-up nice-to-have** (3 agents): owner-discovery/contact-owner
  mechanism — checked entu-api (`?props=_owner` bypass?), entu-www docs,
  and `~/projects/webapp` (actual Entu reference webapp, confirmed exists,
  distinct from `entu-webapp`) for any "who owns this / request access" UI.
- **T6.4/#54 nice-to-have** (2 agents): is library i18n/a11y already absorbed
  by T6.3 (#63)? Checked Paraglide message usage + hardcoded-string/a11y scan
  under `~/workspace-app/src/routes/library/` and `src/lib/components/library/`.

**Lesson for next Finn**: dispatched-but-unreturned haiku agents have no
persistence path from Finn's side — if a shutdown_request lands mid-flight,
their output is gone (they were background async, not tracked in a task
list). Consider checking `Monitor`/task status before ack'ing shutdown next
time, or ask team-lead for a grace window when blocking research is in flight.


<!-- Pruned 2026-08-06 (S43): S32-39 detail compressed to bullets below; full text in git
history of this file. S2-30 already pruned 2026-06-14 — durable facts live in MEMORY.md. -->

## [DECISION-INPUT] Rights (_owner/_editor/_viewer/_expander) NOT in JWT, only readable via entity GET (S47, 2026-08-08, #51/#49 T5.1)

JWT `accounts` claim (`routes/auth/index.get.js:136-138,253-264`) carries zero rights
data — just `{_id, name, user}` per db. Rights props live ONLY in `private.*`
(`aggregate.js:9-17`, never copied to domain/public — that copy logic at :133-152 only
applies to ordinary prop-defs). Read gate = `utils/entity.js:569-586` `cleanupEntity`:
caller sees `private.*` (and thus `_owner`/`_editor`) ONLY if own person `_id` is
directly in `entity.access` (built by `utils/rights.js:76-97` `getAccessArray` = sharing
value + all viewer/expander/editor/owner refs, deduped). Domain/public visibility is
NOT enough — those buckets structurally never carry rights fields. **So: admin/editor
determination for ANY entity (org, library scope, whatever) = `GET entity/{id}?props=
_owner,_editor` + check own id in the returned array; absence of the key = fail-closed
"not admin", not an error.** Generalizes to any entity, no type-specific logic needed.
Caveat: ANY rights tier (even bare `_viewer`) sees the FULL `_owner`/`_editor` list once
in `access` — not owner-gated. Existing 3-way error-vs-no-vs-yes idiom to reuse:
`src/lib/collectives/marker.ts:34-39,58-74` (`{kind:'error'|'not-collective'|'collective'}`).

## [DECISION-INPUT] API-key auth bypasses rights view entirely (S46, 2026-08-08, #44/#37 D3)

`routes/auth/index.get.js:148-152` — API-key lookup is a raw MongoDB `.findOne()` on
`entity` collection, field `private.entu_api_key.string` (indexed,
`setupDatabase.js:225`). NOT the aggregated/rights-filtered view `GET /entity` uses.
`utils/aggregate.js:51-152`: `private.*` bucket is **always fully populated** regardless
of prop-def `_sharing` tier — `domain.*`/`public.*` are additive copies written
conditionally (lines 133/140) on top of it. So narrowing a prop-def's `_sharing` to
`private` only stops the domain/public copy; `private.*` (what auth reads) is untouched.
**General pattern**: any narrow-`_sharing`-then-reaggregate op is safe for auth/internal
lookups that key off `private.*` directly — check the query's bucket prefix before
assuming a sharing-tier narrow is risky.

## [RESOLVED] Census script `sharing`→`_sharing` bug (S44, 2026-08-06)

Flagged 2026-08-06, independently confirmed + reversed by team-lead same session (21/21
person prop-defs ARE `_sharing:domain`), script guard-commented by perotin (`5a7f0fd`).
Canonical explanation now lives in `~/workspace-app/docs/architecture/entu-rights-and-
visibility-model.md` §3 — read that, not this entry, for the mechanics.

## [CHECKPOINT] 2026-08-07 (S45) — `add_user` restore risk (T4.9 prep) + roster/membership
current-state (story #16), both delivered in full to requesters

- **add_user**: auto-create (`entu-api/routes/auth/index.get.js:295-303`) and the invite
  path's `resolvePersonParentId` (`workspace-app/src/lib/invite/inviteData.ts:79-116`) read
  the IDENTICAL query/validity bar on `add_user.reference` (mere `$exists`, no self-ref
  check despite runbook wording) — **no safe shape exists**; restoring `add_user` in ANY
  form re-arms public auto-provisioning. Fix instead: `resolvePersonParentId` should return
  `entity._id` (the database entity's own id, already fetched, always present per Mongo
  default `$project` behavior) instead of reading `add_user` at all —
  `entu-api/utils/setupDatabase.js:183-191` shows that's entu-api's own bootstrap-parent
  convention, and it's byte-identical to polyphony's deleted add_user value (both
  `69bcfd8e9c031ab8e6ce807a`, confirmed via perotin's pre-delete live read,
  `perotin.md:1591-1594`). Full brief in team-lead thread 2026-08-07.
- **Roster/#16**: **T4.10 (#30) never ran live** — Mihkel ruled don't-run; task-tracker
  "completed" = build-only. Orphaned person `name`/`email` are inert (private, post-T4.3).
  Profiles exist ONLY where a member has actually used the real T4.6 UI — most
  members/synthetic rows likely have ZERO profile entities. `member` entity STILL gets
  `name` + `_sharing:'private'` at create (`inviteData.ts:285-294`) — the "domain-shared,
  no name on member" ruling is not yet in code. No `listMembers`/roster surface exists
  anywhere (confirmed precise grep, not substring coincidence) — T3.2 starts from nothing.
  No `member._sharing` tier census exists — T3.1 is genuinely first-of-its-kind. Full brief
  sent to Victoria 2026-08-07.

## [CHECKPOINT] 2026-08-06 (S43) — T4.2/#23: invite bind = TOKEN-POSSESSION, not identity-match

Full citations sent to team-lead (message thread), not restated here. Core facts:

- Admin-set `entu_user.string = invitee_email` at person-create is **deleted synchronously**
  and replaced by `entu_user.invite` (a 7-day JWT keyed `{db, entityId}`, no email) —
  `entu-api/utils/entity.js:462-466`. Email never persists for later comparison.
- Redemption = `/auth?invite=<jwt>` post-OAuth (`entu-api/routes/auth/index.get.js:198-233`).
  Binds whoever's OAuth session is active — no email check anywhere in this path.
  Gate is redeem-once (`findStoredInvite` returns null once consumed), not email-match.
  **A forwarded link redeemed by a different email BINDS, doesn't refuse** — this is
  forced by entu-api's mechanics, not a design choice mvox can make either way.
- The email-string identity-match path that DOES exist elsewhere in `/auth`
  (`entu-user.string === session.user.email`, lines 164-183) is structurally dead for
  invite-created persons, because step 1 already deleted `.string`.
- **Citation fix needed on #21/#23**: `src/lib/auth/guard.ts:44` doesn't exist. Real gate
  is `src/lib/server/auth/session-cookie.ts:46` `isProtectedPath()`, wired via
  `src/hooks.server.ts:9`.
  - **⚠️ SUPERSEDED 2026-08-06 (team-lead annotation): this finding was WRONG — read from the
    HARVEST repo (`~/workspace` = mvox_v4e_web), not the work repo. In mvox-app the `/invite/`
    allowlist is `src/lib/auth/guard.ts:43` (off-by-one on the line, not the file). `session-cookie.ts`
    / `hooks.server.ts` do NOT exist in mvox-app (no server; `ssr=false`). Correcting the origin so it
    can't re-propagate. Lesson: mvox-app citations are against `~/workspace-app`, not `~/workspace`. (*MVOX:Palestrina*)
- **Two invite mechanisms now coexist in-repo**: the entu-native `entu_user`+JWT one above,
  and an OLDER, unrelated one already live at `src/routes/invite/[token]/+page.svelte`
  (client-decoded self-describing token → `application`/`invitation` entities, from parked
  `feat/invite-join`). T4.5 builder must explicitly decide repurpose/replace/delete — don't
  let both run.
- T4.8 secondary: confirmed NO field on `person` is readable-by-others once the pivot lands
  (`entu_user` private+system; `email` private+"never for identity"; `name` moves to
  lazily-created profile entities). The empty-profile-username fallback has no source —
  needs a T4.3 follow-up (either keep a domain-visible name-equivalent on `person`, or drop
  the fallback requirement).

**[GOTCHA] cwd trap:** this Bash tool's default cwd (`/home/ai-teams/workspace-app`) is a
DIFFERENT git repo (remote `mvox-dev/mvox-app.git`, GitHub org+repo `gh` resolves against)
from this one (`~/workspace`, remote `mvox_v4e_web.git` — same codebase under an old/redirected
name, but a distinct local `.git`). An absolute-path Write without an explicit
`~/workspace/...` prefix lands in the wrong repo silently (it has its own `.git`, so no
error, just a stray untracked file nobody else sees). Always spell out
`~/workspace-app/teams/mvox-dev/memory/finn.md` in full — never assume bare cwd.

(*MVOX:Finn*)

---

## Active / Durable findings (S40-42, single-collective pivot — source-verified)

- **Entu = one platform, many Mongo dbs.** One shared `mongodbUrl`+`jwtSecret`
  (`.config/nitro.ts:6-29`). `/auth` (no `?db=`) enumerates EVERY db (`listDatabases()`)
  and adds `accounts[dbName]` per db with a matching person (`routes/auth/index.get.js:132,
  141-190`). One JWT CAN span multiple collective-dbs if the same OAuth identity has a
  person in more than one — not a leak, just means "one JWT ⇒ one collective" needs
  `?db=` forced at every `/auth` call if that invariant is wanted. `/refresh` does NOT
  re-enumerate dbs (`routes/auth/refresh.get.js:106-133`).
- **`entu.userStr`** set only if `token.accounts[urlDbName]` exists (`middleware/auth.js:
  46-48`) — db boundary = collective boundary holds structurally.
- **Per-property `sharing`** on a prop-def picks domain/public bucket, capped by the
  entity TYPE's own `_sharing`, then again by the ENTITY's own `_sharing`
  (`utils/aggregate.js:86,94,113-121,148-154,269-275`). Buckets are write-time snapshots —
  changing a prop-def's `sharing` does not retroactively re-aggregate existing instances.
- **`_sharing` create-time parent-copy** (`utils/entity.js:296-327` `inheritParentProperties`)
  is separate from `_inheritrights` cascade. Fires only if payload has `_parent` AND omits
  `_sharing`; copies parent's `public`>`domain` sharing, one-time, at create only. Any
  explicit `_sharing` in the create payload (even `'private'`) suppresses it — the only
  opt-out.
- **No native change-feed.** Webhooks (`utils/plugin.js`) are the only push primitive and
  hard-require public HTTPS (blocks localhost/private ranges) — structurally needs a server.
  No poll-since param on `GET /entity` either.

## Durable findings (S32-39, compressed — full detail in git history of this file)

- **v4E entity shapes** (pre-pivot, superseded by epic #21 for invite specifically):
  `rsvp`/`invitation`/`member`/`attendance` shapes, `event_type` enum values,
  `rsvp_lockout_hours` on `organization`. `invitation`+`application` model is the one
  T4.2 above flags as the OLD mechanism still live at `/invite/[token]`.
- **`_inheritrights` absent = false**, strict `=== true` check (`utils/aggregate.js`).
  Blocks upward lookup only, not downward cascade to children that DO have it true.
- **`_sharing` is `_owner`-tier**, not `_editor`-tier — `_editor` can't touch rights
  properties or delete the entity.
- **No entity-to-entity rights grants** — `_viewer`/`_editor`/`_owner` only ever reference
  a person `_id`, never an org. No org-as-viewer shortcut exists; `_inheritrights` cascade
  is the only transitive-visibility primitive.
- **Entu formula engine**: string/number/boolean output only, 23 operators, no filtered/
  grouped COUNT (sentinel-ref is the only workaround).
- **OAuth callback JWT is client-tainted** (pre-hooks.server.ts hardening) — superseded by
  the CHORE-79 `session-cookie.ts`/`hooks.server.ts` gate now in place (see S43 above).
- **Credential-synthesis via `entu_api_key` on an OAuth person** — UNRESOLVED contradiction
  (worked once, failed twice on the same technique/person). Don't rely on it without a
  fresh controlled probe.

## [DEFERRED] /library filter voicing/language field name mismatch (S26, still open)

`work.voicing` fetched but schema field is `original_voicing`; same for `language` →
`original_language`. Needs a live DB probe before filter UI lands.

(*MVOX:Finn*)
