<!-- Moved from the lead's harness auto-memory (project_polyphony_onboarding.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-onboarding

> Polyphony's onboarding model — bilateral consent rule + invitation/application entities + edge case decisions E1–E5 (decided 2026-05-17, session 2)

Polyphony's member onboarding is gated by **bilateral consent**: a `member` exists only when both the org and the person have expressed intent. This rule shapes the entity structure (separate `invitation` + `application` consent-bearers) and a set of edge-case decisions made in the 2026-05-17 cross-team session.

**Why:** Mirrors polyphony's existing org↔org handshake pattern in `docs/LEGAL-FRAMEWORK.md`. Prevents both unilateral "admin adds someone who never asked to join" AND "person joins without admin approval". One coherent model regardless of who initiated.

**How to apply:** When designing flows that create/activate/archive members, always check both consents are on record. When proposing UI, surface both paths (invitation-driven and application-driven) symmetrically. Never collapse to a one-sided pattern.

## Entity structure

```
invitation  (child of organization)
  ── email          string    target address admin invited
  ── sections[*]    ref       optional — section parents to set on new member at acceptance
  ── token          string    UUID for URL-based access
  ── expires_at     date      default 30 days from creation; admin-settable
  ── inviter        ref       system-set; for audit
  ── message        text      optional personalized note
  (no role/voice — roles handled via rights grants post-acceptance per [[polyphony-roles-as-rights]]; voice lives on person)

application  (child of person; BFF adds explicit `_viewer: <target_org's admin persons>` on creation)
  ── target_org     ref       single, mandatory
  ── message        text      optional — applicant's note (voice/section preferences expressed in free text)
  ── status         enum      pending | rejected
  ── expires_at     date      default 30 days (both pending and rejected)
  (no role_request — roles assigned post-acceptance via rights grants)

member  (MULTI-PARENT: always child of org; ALSO child of each section the person sings in)
  ── person          ref       single, mandatory
  ── current_section ref       optional — primary section pointer for multi-section members
  ── status          enum      active | archived
  (admin-controlled only; no self-editable fields on member — all personal data lives on person)
  (no contact_email — replaced by person.preferred_contact_email; one address, used by all orgs)
  (no role[*] — roles are emergent from Entu rights grants; see [[polyphony-roles-as-rights]])
  (no section[*] — section assignment IS the parent relationship; multi-parent for multi-section)
  (no voice[*] — voice lives on person)

person  (identity hub; _editor: self via Entu auto-create; _sharing: public — see "Person discoverability" below)
  ── name                       string                          self-editable
  ── voice[*]                   ref → global voice taxonomy     self-declared; multi-value capability
  ── bio                        text (optional)                 self-editable
  ── avatar                     file (optional)                 self-editable
  ── notes                      text (optional)                 self-editable; surfaced to admins of orgs person is in via BFF report
  ── preferred_contact_email    string (optional)               self-chosen from entu_user[*].email or custom; used by all orgs
  ── preferences                (optional, future)              self-editable
  ── entu_user[*]               system                          OAuth identity links — see [[polyphony-email-trust]]
  ── email                      string                          Entu default schema; informational, never used for identity
```

## Path A — org-initiated

1. Admin creates `invitation` under org (email + optional `sections[*]` to preset section parents + token + expires_at)
2. Email sent: `https://polyphony.app/invite/<token>`
3. User clicks → Entu OAuth (finds existing person via `entu_user.uid`, OR auto-creates new person)
4. App resolves token → checks logged-in person's verified emails against `invitation.email` → soft warning if mismatch + explicit "yes, that's me" confirmation
5. If `person.preferred_contact_email` is unset, prompt to set it (pick from `entu_user[*].email` or custom). If `person.voice` is unset, prompt to declare voice. Both saved to person — used by all orgs (no per-org overrides).
6. `member` created as child of org + `invitation.sections[*]` (multi-parent); person reference set
7. `invitation` deleted (consumed)
8. Role→ACL sync: add `_viewer: <person>` on org (cascades to org subtree per `[[polyphony-library-subtree]]`). **Elevated roles** (librarian, section-leader, admin) are NOT set here — admin grants them as separate post-creation actions per `[[polyphony-roles-as-rights]]`.

## Path B — person-initiated

1. User OAuths in (creates orphan person if new, or finds existing); user fills `person.voice` and other profile info
2. User browses public org directory, submits `application` under their person (target_org + optional message; no structured role_request — voice/preferences live in message text)
3. Admin sees application in org's pending list
4. Admin clicks "accept" → admin chooses initial section assignment(s) (or none) → app creates `member` as child of org + chosen sections (multi-parent) → `application` deleted
5. Role→ACL sync as in Path A (`_viewer` on org only; elevated roles separate)

**Two-action collapse on Path B is intentional** — the `application` already expresses person's consent. Asking the user to confirm a second time after admin acceptance would be redundant ceremony.

## Edge case decisions

**E1** — Person from another org (e.g., Alice in Sireen → invited to Filharmoonia)
Entu's OAuth finds existing person via `entu_user.uid`. App binds new Member to existing person. End state: 1 person, 2 members. No special handling needed — happy path.

**E2** — OAuth email ≠ invitation.email
Soft check: UI shows warning ("invitation sent to X, you're logged in as Y — continue?") + explicit confirmation. Token is the security gate; email is informational. After confirmation, `person.preferred_contact_email` is used for ongoing communication across all orgs (one-time setup during onboarding if unset). No per-org contact-email overrides — simplified from earlier design.

**E3** — Orphan person (OAuth'd, no invitation, no application)
Accept. Person sits with `_editor: self`. Polyphony dashboard shows empty state ("you're not part of any choir yet"). User can wait for invitation or initiate application. Default `_sharing: private` keeps orphan persons out of admin pickers. **Prune at 180 days inactive** (BFF cron — no member ever created, no application submitted, no login in 180+ days → delete person). GDPR-favorable.

**E4** — Person invited to multiple orgs simultaneously
Each invitation is independent. Dashboard listing surfaces all pending invitations (option B chosen, not link-only). Query: `invitation.email ∈ person.entu_user[*].email` — OAuth-verified addresses only, so dashboard auto-discovery is impersonation-safe. See `[[polyphony-email-trust]]` for trust hierarchy. Email-mismatch invitations reachable only via direct link.

**E5** — User declines / never OAuths
Explicit "decline" button in acceptance UI. Default 30-day auto-expiry, admin-settable at invitation creation. Delete invitation on decline/expiry (audit trail lives in invitation creation logs, not the entity).

**E6** — Person-initiated application path

Lifecycle (parallel to invitation):
- Created → `status=pending`, `expires_at` = now + 30d (admin-settable)
- Admin accepts → member created, application deleted
- Admin rejects → `status=rejected`, `expires_at` = now + 30d
- Pending past `expires_at` → cron-deleted
- Rejected past `expires_at` → cron-deleted

Duplicate prevention: BFF rejects a new `application` creation if any application (pending OR rejected) already exists where `person=<self> AND target_org=<X>`. Effective rate limit: person waits out either admin's response OR the 30-day rejection cooldown before re-applying.

Entity location: child of person; BFF adds explicit `_viewer: <target_org's admin persons>` on creation (per D in the application-location question).

Withdraw: person can delete their own application **while pending** (cascade `_editor: self` from person). On reject, BFF sets `application._inheritrights = false` and adds explicit `_viewer: <person>` — person sees the rejection status but can't delete. Cron handles deletion at the 30-day mark. Rate limit thus actually enforced (not honor-system).

Still open: org discovery/directory design (which orgs are discoverable for path B browsing) — bridges into Org entity design.

## Implementation notes

- `replaceInviteWithCredentials` (entu/api `routes/auth/index.get.js`) handles OAuth→credentials swap on invitation acceptance. Existing Entu mechanism, reused as-is.
- BFF handles binding on `/auth` exchange: detect pending invitations matching person's verified emails, surface in dashboard, process acceptance.
- BFF handles role→ACL sync on member create/archive: add/remove `_viewer: <person>` on org.

## Open items

- Org discovery/directory design (gates path B browsing — bridges into Org entity design)
- Conductor role (needs `[[polyphony-roles-as-rights]]` extension; depends on events entity in Topic 2)
- Rights-without-membership question (can someone be librarian of org X without being a member there?)
- Member self-edit pattern — which fields self-editable vs admin-only (parked during session)
- Owner count confirmation (1 founder + maybe one backup, mentioned but not nailed)

## Person discoverability

Mirrors org's per-property `_sharing` model (see `[[polyphony-org-rights-isolation]]`):

- `person` entity type and instances default `_sharing: public` (singers benefit from being findable — collaborations, gigs, "looking for a tenor")
- Property defs marked `_sharing: public`: `name`, `voice[*]`, `bio`, `avatar`
- Property defs default `_sharing: private`: `entu_user[*]`, `email`, `notes`, `preferred_contact_email`, `preferences`
- **Whole-instance opt-out**: privacy-conscious user sets their person INSTANCE `_sharing: private` → invisible to anonymous; only visible via explicit rights

**Per-property opt-out per person is NOT supported by Entu** (probed live 2026-05-17): per-value `_sharing` field is accepted and stored on individual property entries but ignored at projection time. Schema-level defaults are the only granularity. See `Teams/entu` Brilliant entry for the platform finding.

**Admin visibility into private person fields (notes, etc.)**: admins of an org typically need to see their members' notes (allergies for retreats, schedule constraints). Admin doesn't have direct rights on person entities. BFF surfaces these in roster views by querying person with system credentials and presenting notes to admins of orgs the person is a member of (parallel to the umbrella-reports pattern in `[[polyphony-org-rights-isolation]]`).

## Related memory

- `[[polyphony-email-trust]]` — trust hierarchy that makes E4 dashboard listing safe
- `[[polyphony-roles-as-rights]]` — role-as-rights principle; explains why `member.role[*]` is absent
- `[[polyphony-org-rights-isolation]]` — `_inheritrights: false` on orgs; per-type policy
- `[[polyphony-library-subtree]]` — role→ACL sync pattern (proves the rights-as-roles model works for librarian)
- `[[entu-no-noaccess]]`, `[[polyphony-no-domain-sharing]]` — rights model these flows operate under
