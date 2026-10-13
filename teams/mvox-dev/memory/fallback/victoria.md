# Victoria — Scratchpad

(*MVOX:Victoria*)

---

### [CHECKPOINT] 2026-05-18 — Task #5 revised draft delivered (PO review round 1)

PO approved F2, resolved F1+F3. Revised clean draft sent. Awaiting explicit PO go-ahead before `gh issue create`.

**Final breakdown (23 issues):**
- CHORE-1..6: bootstrap, Tailwind v4, Paraglide, Vitest/Playwright, BFF skeleton, email-sending capability (Resend/CF-compatible)
- A1, A2, A3: epic A (A4 ⚪ deferred to v2)
- B1, B2, B3, B4: epic B
- C1, C2, C3: epic C (C4 ⚪ deferred to v2)
- D1, D2: epic D
- ADMIN-1..5: season, event, invite member, rsvp policy, roster

**PO decisions (closed):**
- F1: A4 + C4 deferred to v2
- F2: B2 singer-only / ADMIN-3 admin-only split confirmed
- F3: Email via CF-Workers-compatible provider (Resend default); CHORE-6 added; PO creates DNS records (SPF+DKIM)

**Key facts:**
- PR #41 merged 2026-05-18 10:33Z — all 5 v4E additions live, no dependency tracking needed
- No 🔧 v4E additions needed for v1

**[GOTCHA]** `member.person.name` is a two-hop lookup. BFF must fetch `person` entities separately — not via formula chain (single-hop formula rule). Affects ADMIN-5 roster display.

**[DECISION] D1 AC:** No workspace switcher (Gap 2a). No notification feed in v1 (Epic E parked, Gap 2b). Explicit constraints in AC — not open questions.

**[DEFERRED]** Path B onboarding (singer-initiated application to org) — not in current issue set. B2 covers Path A (admin invite) singer side only. Raise with PO if v1 scope needs Path B.

**[PATTERN] AC template that worked well:**
- Lead with role + capability sentence
- Enumerate BFF query patterns (entity type, filter, rights tier)
- Explicit empty-state AC bullet (mandatory per Gap 4 / architecture decision)
- Vitest cases at the end with specific scenarios (boundary conditions, error paths named)
- Schema annotation (✅ / 🧩 / 🔧) on its own line at the end

### [CHECKPOINT] 2026-05-18 — Session 3 complete, all issues live

All 23 issues open on mvox-dev/mvox_v4e_web (#1–#23). Session ended cleanly after PO go-ahead.

**[DEFERRED]** A4 + C4 (attendance history, programme history) — parked ⚪, deferred to v2.

### [CHECKPOINT] 2026-06-01 — Session 28 complete, rehearsal-schedule first-slice issues filed

Design/mapping session for conductor/admin rehearsal-schedule slice. Spec approved at `4c4b1ab` (`docs/superpowers/specs/2026-05-31-rehearsal-schedule-first-slice-design.md`).

**Issues updated/filed:**
- #19 ADMIN-1 (create season) — AC replaced with spec §7 Cap 1
- #20 ADMIN-2 (create event) — scoped to rehearsal series only, triggers #81
- #81 ADMIN-6 (generate event instances eager) — NEW; DST regression test required
- #82 ADMIN-7 (view rehearsal list) — NEW; conductor primary screen at `/seasons?season=<id>`
- #83 ADMIN-8 (cancel/edit single instance) — NEW; gating probe §8 #1 (delete rights)
- #84 ADMIN-9 (delete series cascade) — NEW; gating probe §8 #1 (delete rights)
- #85 ADMIN-10 (assign/manage season conductors) — NEW; gating probe §8 #4 (grant wire + inherited flag)

**[GOTCHA] Cap 7 gating probes — must resolve before GREEN on #83/#84/#85:**
- Probe §8 #1: Pérotin confirms DELETE is `_owner`-tier on live playground
- Probe §8 #4: does `inherited: true` appear on cascaded rights in season GET? (if absent → AC5 list-conductors needs fallback: subtract org `_owner` person-ids from season `_editor` list); also: grant/revoke wire shape; creator-auto-`_owner` mechanic

**[PATTERN] Cap 7 roles-as-rights:** conductor = direct `_editor` grant on season; no `conductors` property; list = entries without `inherited: true` flag; display name via separate `GET /entity/{personId}` (same as ADMIN-5 pattern).

**[DEFERRED]** Pure-conductor delete rights — conductor-only persona (no org `_owner`) cannot cancel rehearsals (DELETE is `_owner`-tier). Needs PO decision: grant `_owner` on season (scoped), or BFF elevated-op. Surface when pure-conductor persona becomes real.

### [CHECKPOINT] 2026-08-07 — #16 slice-3 roster re-groom, plan sent to team-lead

**[GOTCHA]** Team-lead's task brief said repo `mvox-dev/mvox-app` but my local `~/workspace` git remote is `mvox-dev/mvox_v4e_web` (stale/archived — old #16-#20 there are unrelated D1/D2/ADMIN-1/2 issues from session 3). Always pass `--repo mvox-dev/mvox-app` explicitly on `gh` calls for current work; don't trust the local checkout's remote.

**[DECISION]** Reshaped #17-#20 (T3.1-T3.4) against slice-4 profile-entity model + the 3 rulings (fixture provisioning for 128 singers → home T3.1; member→domain; name-off-member). Recommended: new T3.5 (invite-path reduction: org+create only, drop name+email fields) as its own task, live deploy gated behind #29 same as T3.1's mutations. Recommended split within T3.1 itself: probe (unblocked, running) vs. provisioning/schema-mutation/bulk-conversion (gated behind #29) — kept as one issue, phase-labeled, rather than forking new issue numbers mid-flight.

**[DEFERRED]** Whether #28-gated (nameless) members are filtered server-side (T3.2) or returned-but-UI-hidden (T3.3) — I recommended API-readable/UI-hides per the ruling text but flagged it as my interpretation, not a ruling; needs PO confirmation.

Full plan sent to team-lead 2026-08-07; awaiting Finn's facts (member/profile shapes, #28 gate impl, existing `listMembers`-shaped code) to confirm or correct implementation-level details before PO sign-off finalizes.

**[GOTCHA]** T4.10 (#30 migration) shows "completed" in the task tracker but that's the BUILD task — Mihkel ruled don't-run-it, zero migration writes ever happened live. All pre-T4.10 `person.name`/`email` values on real polyphony data are orphaned/inert (private-bucket, unreadable except to the person/admin, never migrated). Don't design any fallback that reads them — profile entities are the sole live source, and most members have ZERO profile entities today (lazy-create via T4.6 self-edit only).

**[DECISION]** Corrected #17 scope after Pérotin's probe: the 128 synthetic singers already have `member` entities 1:1 at `private` tier — T3.1 provisions DOMAIN PROFILES for them, not member entities. Population: 245 total members = 130 "clean" v4E (person-ref present, status present; 128 private-tier synthetic + 2 domain-tier real) + 115 "orphan" legacy (no person ref, no status, domain tier, all carry dead `name` strings) — near-certainly pre-v2-rewrite dead data. Orphan disposition is a NEW unscoped question, live mutation behind #29, surfaced to PO as a candidate task — not mine to scope ACs for.

**[GOTCHA]** entu-api enforces NO prop-def mandatory-ness anywhere (mandatory is GraphQL-introspection-only, REST never consults it) — the name-off-member schema mutation has no ordering constraint vs. the code change; sequencing is a team scheduling choice, not technical. Resolves the open question I'd flagged in the first pass.

Sent corrected/folded-in addendum to team-lead 2026-08-07.

**[CHECKPOINT]** Re-groom complete and landed on GitHub: #17-#20 bodies edited (profile-entity terminology, #17's provisioning scope corrected, #18 gets server-side #28-gate filter + orphan test case, #20 gets #29-plus-provisioning precondition). New task filed as **#36** (T3.5, invite-path reduction). Closing comment posted on #16 with the mandatory-ness resolution line + #36 pointer + orphan-disposition flag. Full plan sent to Gama by team-lead — signed off, T3.2/T3.3 (#18/#19) built and in Bentham review.

**[GOTCHA]** `add_user` is **permanently deleted** (#22), no restoration path — the OAuth auto-create-person-on-sign-in mechanism that older tasks assumed (observe the fresh person's `_sharing` default) no longer exists to observe. T4.9's fix resolves the parent from `entity._id` instead. Any future task text that says "sign in triggers person auto-create, observe X" needs the same correction #17 got: cite `entu-api/utils/entity.js:296-327` for `_sharing` defaults instead of live-observing them.

**[DEFERRED]** 115 orphan legacy `member` rows (no `person` ref, no `status`, dead `name` strings, pre-v2-rewrite debt) — disposition still genuinely unowned, no PO ruling, no task scoped. Surfaced twice (my plan + #16 comment) but not picked up yet — worth a nudge if it resurfaces.

(*MVOX:Victoria*)
