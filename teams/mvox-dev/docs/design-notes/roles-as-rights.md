<!-- Moved from the lead's harness auto-memory (project_polyphony_roles_as_rights.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-roles-as-rights

> Polyphony expresses 'roles' (admin, librarian, conductor, section-leader) entirely through Entu's native rights grants — no `role` property on member entity (decided 2026-05-17, session 2)

Polyphony does NOT have a separate `role` property on the `member` entity. Roles are **emergent from explicit Entu rights grants** (`_owner`, `_editor`) on specific entities. To make someone a librarian, grant them `_editor` on the org's library entity — that act IS the role assignment.

**Why:** Eliminates the role-to-permission sync problem (no risk of role-data drifting from actual permissions). Roles are queryable using Entu's existing rights model + the `inherited != true` discriminator verified in session 1 (per `[[polyphony-library-subtree]]`). Leans on Entu for what Entu does best — strong validation of platform choice for polyphony.

**How to apply:** When designing role-related features (promotion, demotion, "who is admin of X", "make someone a section-leader"), translate to rights operations on specific entities. Don't add a role string/enum/list anywhere. UI uses friendly verbs ("Promote to librarian") but BFF translates to rights writes.

## Role → rights mapping

| Role | Mechanism | Notes |
|---|---|---|
| Member (basic) | `member` entity exists as child of org; BFF also writes `_viewer: <person>` on org (role→ACL sync) | The member entity itself doesn't grant person rights — explicit `_viewer` on org is what cascades visibility |
| Section-leader of section A | `_editor: <person>` on section A | Cascades to members who have A as parent |
| Librarian | `_editor: <person>` on org's library entity | Cascades to library subtree (works/editions/copies/lending) |
| Conductor | `_editor: <person>` on events scope | TBD in Topic 2 (depends on events entity) |
| Admin / Owner (merged) | `_owner: <person>` on org | Cascades to entire org subtree via Entu's `_inheritrights`; multiple admins allowed; org-delete mitigated by UI safeguards |

## Why admin = `_owner` (merged with owner role) — updated 2026-05-18

**`_owner` cascades** via `_inheritrights`, same as the other positive rights. Per https://www.entu.ee/overview/entities/#access-rights:

> "only `_viewer`, `_expander`, `_editor`, and `_owner` are inherited"

Setting `_owner: <person>` on org gives that person `_owner` on every entity in the org's subtree.

This means an admin can natively (no BFF elevation needed):
- Write `_viewer: <new-member>` on org → role→ACL sync is a user-rights operation
- Grant `_editor` to promote librarians / section-leaders / conductors
- Modify `_parent` on any subtree entity (cleanup, reorganization)
- Delete entities they didn't create (e.g., clean up a departed admin's series)
- Manage rights on any subtree entity

**Risk**: admin can DELETE THE ORG itself (they have `_owner` on org). Org-delete is destructive but recoverable via backup. Mitigations purely via UI / ops:
- Org-delete UI requires explicit confirmation ("type the org name to confirm")
- BFF audit log of destructive admin actions
- Backup/restore strategy (standard ops concern; not in polyphony's schema)

**Multiple admins coexist** — all have `_owner` on org, all share full operational control. Entu's "can't delete last `_owner`" prevents accidental erasure of the last owner. Membership-rights invariant (below) ensures every admin is also a member.

### Earlier "admin = `_editor`" model rejected

The earlier version of this design had admin = `_editor` and reserved `_owner` for a tiny "owner" tier. Rejected after the BFF user-rights principle was adopted (see `[[polyphony-bff-rights-pattern]]`) for these reasons:
- Required BFF elevation for role→ACL sync on every member-add (violates user-rights principle)
- Required elevation for promoting users to elevated roles
- Created departed-admin orphan-entity friction (other admins couldn't reparent / delete)
- Misstated `_owner` cascade behavior — earlier text implied `_owner` doesn't cascade; in fact it does (Entu docs confirm)

## Role queries

"Find all librarians of org X" → query persons with `_editor` on org X's library entity, filtered to `inherited != true` (filters out admin/owner cascade entries).

"Find all section-leaders of section A" → same pattern, on section A.

"Find all admins of org X" → `_owner` on org X, filtered `inherited != true` (admin/owner is merged; only explicit grants count).

The `inherited` discriminator pattern was empirically verified in session 1 — see `[[polyphony-library-subtree]]` for details.

## Promotion / demotion

- Promote → add explicit `_editor: <person>` on the relevant entity (library, section, org)
- Demote → remove the explicit `_editor` entry
- No member.role sync needed; rights ARE the source of truth

## Membership-rights invariant (BFF-enforced)

**Rule: any explicit `_owner` / `_editor` / `_viewer` grant on an entity under an org must be paired with an active `member` entity for that person in that org.**

Generalizes from the original "at least one owner is a member" concern into a single uniform principle covering ALL elevated rights — owner, admin, librarian, section-leader, AND any explicit viewer grant (including the role→ACL sync `_viewer: <person>` on org for basic membership, which is co-created with the member entity in a single atomic operation).

**No `_viewer` exception** — umbrella members do NOT auto-receive `_viewer` on first-level child orgs. Cross-org visibility for umbrellas goes through aggregate formulas + BFF reports (see `[[polyphony-org-rights-isolation]]`), not through rights cascade. The principle stays exception-free.

**BFF enforcement, both directions:**

| Operation | Block condition |
|---|---|
| Grant explicit `_owner` / `_editor` / `_viewer` on entity under org X to person P | P has no active `member` entity in X → block, prompt to invite first |
| Archive or hard-delete P's `member` entity in X | P has any explicit `_owner` / `_editor` / `_viewer` on any entity under X → block, prompt to clean rights first |
| Remove P from explicit `_owner` / `_editor` / `_viewer` of entity under X | (no extra check — Entu still enforces "can't delete last `_owner`" natively for the owner case) |

**Workflow consequences:**
- New librarian/section-leader → invite as member first (path A) → member created → admin then grants `_editor` on the relevant entity
- Removing a leaving librarian → admin removes `_editor` on library FIRST → then archive member entity
- Stepping down as last owner-member → promote successor to `_owner` first (successor must already be a member, which they typically are) → then remove self from `_owner` → safe to archive own membership

**Resolves the parked rights-without-membership question** (from `[[polyphony-onboarding]]` open items): **not allowed** — explicit rights on org subtree require active membership.

## Founder flow (atomic org creation)

When a person P creates a new organization, the BFF performs this as a single atomic operation to maintain the invariant from the moment the org exists:

1. Org entity created with `_parent = [P]` (the founder's person), `_inheritrights: false` (per `[[polyphony-org-rights-isolation]]`)
2. Entu's "creator gets `_owner`" rule fires → P becomes `_owner` of the new org
3. BFF immediately creates `member` entity in the new org: `person = P`, `_parent = [org]` (no sections yet)
4. P's `_owner` tier cascade materializes `_editor`/`_expander`/`_viewer` throughout the org subtree — no separate basic-member `_viewer` sync needed (already covered by tier cascade)

**Why org-as-child-of-person works cleanly:**
- `_inheritrights: false` on org blocks any rights leak from P (parent) into the org subtree — no "founder owns everything via cascade" pollution
- Structural parent relationship preserved for queries: "orgs founded by P" = children of P with `_type=organization`
- Survives ownership transfer: after P promotes Q + removes self from `_owner` + archives membership, the `_parent` link preserves the historical "P founded this" record (credit/audit; grants no rights)

**Not really an exception** — the founder flow is the atomic create-both pattern that establishes the membership-rights invariant at org-creation time, when no invitation flow is possible (no org exists yet to invite to).

## Owner count policy

**No hard limit** on the number of owners per org. Entu enforces ≥1 natively (see below). Polyphony adds no app-level minimum or maximum — choirs vary too much (single-founder vs multi-director collaborations) to justify enforcement either way.

**Soft UX nudge**: when an org has exactly 1 owner, the org dashboard shows a suggestion *"Add a backup owner for resilience"* with a one-click invite-then-promote flow. Admin can dismiss or act on it. Not enforced.

**Adding a backup owner** (two ordinary steps, no special path):
1. Existing owner invites backup as member (path A flow)
2. Backup accepts → member entity created
3. Existing owner grants `_owner: <backup>` on org (BFF verifies membership-rights invariant)

## Native Entu protection: "can't delete last `_owner`"

Probed live 2026-05-17 session 2: attempting to `DELETE` the last `_owner` property entry on any entity returns:

```
HTTP 403  "Can't delete last _owner"
```

This is platform-level — applies to every entity, not just orgs. So the "org has at least one owner" half of the invariant is hard-enforced by Entu. The BFF only needs to enforce the "at least one owner is a member" overlap (and the broader rights-pairs-membership rule above).

**Side observation (needs reverification)**: when POSTing a duplicate `_owner` entry (same person reference as existing), Entu appeared to silently deduplicate — only the original entry persisted. Re-probe with a second distinct person reference to confirm two-distinct-owners works as expected.

## Role→ACL sync (basic membership)

When member is created in org X:
- Add `_viewer: <person>` on org X (cascade gives person read access to the org's entire subtree)

When member is archived:
- Remove `_viewer: <person>` from org X

**Performed by the inviting admin natively** (no BFF elevation needed) — admin has `_owner` on org per the merged role model, so they can modify `_viewer` directly.

This is the only app-mediated rights write needed for basic membership. Elevated roles (librarian, section-leader, conductor) use explicit `_editor` grants on their respective scopes, also performed natively by admin via cascade.

## Related memory

- `[[polyphony-org-rights-isolation]]` — orgs have `_inheritrights: false`, so this role pattern doesn't leak across org boundaries
- `[[polyphony-library-subtree]]` — librarian role pattern already operating in the library design; proves the model works
- `[[polyphony-onboarding]]` — invitation/application/member entities (post role-property removal)
