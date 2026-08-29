# Provisioning Runbook — mvox collective

Operational steps for provisioning a new mvox collective (Entu database). Reference case: **mvox_crede** (Kammerkoor Crede), provisioned 2026-08-27.

## Prerequisites

- Entu database created (via entu.app/new or Mihkel's direct setup)
- Database entity ID known
- Database owner's Entu account (email) known
- `setup-entity-types.ts` up to date in entu/research

## Part 1 — Schema setup

Run `setup-entity-types.ts` against the new database. This creates:

| Step | What | Count |
|------|------|-------|
| 1 | Content type definitions + person extensions | 17 |
| 2 | `mvox_collective` marker (named after the collective) | 1 |
| 3 | First member: person + member for database owner | 1+1 |
| 4 | Domain profile for first member (name + email) | 1 |

**Post-schema checklist:**

- [ ] Verify type count: 17 content types seeded
- [ ] Verify marker: `mvox_collective` entity exists with collective name
- [ ] Verify first member: person + member + domain profile for db owner
- [ ] Align person prop-def `_sharing`: flip ~14 base Entu person prop-defs from `domain` to `private` (platform default drift — see #181)
- [ ] Create members menu entry: `menu` entity with `name: 'Liikmed'`, `group: 'Asutus'`, `query: '_type.string=member'`, `_sharing: 'domain'` (see #184)

**Expected entity counts after Part 1:**

| Entity type | Count |
|-------------|-------|
| person | 1 |
| member | 1 |
| profile | 1 |
| mvox_collective | 1 |
| menu (members) | 1 |

## Part 2 — Data seeding (Crede reference)

For collectives migrating from an existing system. Crede migrated from **polyphony.uk** (Cloudflare Workers + D1).

### 2.1 Source data extraction

1. **Locate source database** — for polyphony.uk: two D1 databases
   - Vault (`crede.polyphony.uk`): member roster, sections, nicknames
   - Registry (`polyphony.uk`): user emails from magic-link auth (`email_auth_codes` table)

2. **Extract and snapshot:**
   ```bash
   # From the polyphony project directory (wrangler configured)
   wrangler d1 execute <vault-db-name> --remote --command "SELECT * FROM members"
   wrangler d1 execute <registry-db-name> --remote --command "SELECT * FROM email_auth_codes"
   ```

3. **Save as gitignored JSON snapshot** in `scripts/migrations/snapshots/` — frozen source for repeatable re-seeding

4. **Filter:** Remove test accounts and the database owner (already created in Part 1)

### 2.2 Migration script

Script location: `scripts/migrations/` (alongside existing migrations).

**Per source member, create in the target database:**

| Step | Entity | Key properties |
|------|--------|---------------|
| 1 | **Person** | `_type: person`, `_parent: <db entity>`, `_inheritrights: true` |
| 2 | **Member** | `_type: member`, `_parent: <db entity>`, `person: <person ref>`, `status: 'active'`, `_inheritrights: true` |
| 3 | **Profile** (domain) | `_type: profile`, `_parent: <person>`, `_inheritrights: false`, `_sharing: 'domain'`, `name: <nickname or full name>`, `email: <from registry>` |

**Script requirements:**
- DRY_RUN default (safe by default, explicit opt-in for live writes)
- Fail-loud per record with ledger/report
- Reads from the gitignored snapshot, not the live source
- Reference: `inviteData.ts:200-319` (person+member shape), `profileData.ts:60-120` (profile shape)

**PII note:** Seed reports written to `scripts/migrations/seed-results/` may contain member PII (names, emails). This directory is gitignored — reports must never be committed.

**Name resolution:** Use nickname as profile display name when present; fall back to full name. Skip joke/test nicknames.

### 2.3 Section seeding

1. Extract sections from source data (voice parts, organizational groups)
2. Create `section` entities: `_type: section`, `_parent: <db entity>`, `name: <section name>`, `_sharing: 'public'`
3. Assign members to sections: add section as `_parent` on member entities

**Crede sections (reference):** S1, S2, A1, A2, Tenor, Baritone, Conductor (7 total)

### 2.4 Verification

**Expected entity counts after full provisioning (Crede reference):**

| Entity type | Count | Notes |
|-------------|-------|-------|
| person | 21 | 20 migrated + 1 owner |
| member | 21 | all status:active |
| profile | 21 | all with name + email |
| section | 7 | S1, S2, A1, A2, Tenor, Baritone, Conductor |
| mvox_collective | 1 | "Crede" |
| menu | 1 | Members under Asutus |

**Verify:**
- [ ] All profiles have name + email
- [ ] All non-owner members assigned to sections
- [ ] Person prop-defs aligned to `_sharing: private`
- [ ] Members menu entry visible in Entu admin
- [ ] Roster page displays all members grouped by section

## Part 3 — Auth linkage (when ready for go-live)

Seeded persons are data records with no `entu_user` — members cannot log in. To onboard:

1. **Batch-mint invite tokens:** POST `[{type: 'entu_user', string: 'trigger invite token'}]` to each person entity. Token returned in response body only (7-day TTL).
2. **Grant self-`_editor`** on each person after minting.
3. **Save tokens** in a gitignored ledger (bearer secrets — never commit).
4. **Distribute** invite links to members (method: Mihkel's decision — email, conductor handout, etc.).

**Timing:** Mint only when ready to distribute — 7-day expiry window.

## Decisions log

| Decision | Ruling | Source |
|----------|--------|--------|
| Collective = database | Database entity IS the collective identity | Mihkel 2026-08-16 |
| Admin blast radius = database | Admin rights on db root = whole-database scope | Mihkel 2026-08-19 |
| Person prop-defs → private | Platform defaults to domain; mvox aligns to private | #181, 2026-08-27 |
| Profile name = nickname | Use nickname when present, full name otherwise | PO decision #177 |
| Members menu under Asutus | Entu admin menu entry for browsing members | Mihkel 2026-08-27 |

(*PO:Gama*)
