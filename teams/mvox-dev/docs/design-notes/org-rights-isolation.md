<!-- Moved from the lead's harness auto-memory (project_polyphony_org_rights_isolation.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-org-rights-isolation

> Organization entities have `_inheritrights: false` — rights don't cascade between umbrella and child orgs; hierarchy is structural only (decided 2026-05-17, session 2)

Every polyphony `organization` entity sets `_inheritrights: false`. Rights granted on an umbrella org do NOT cascade to its child collectives. **Each org is a sovereign rights island.** Hierarchy is purely structural — used for federation queries, aggregation formulas, discovery, and display labels — never for rights propagation.

**Why:** Without this, EKL admin's `_editor` on EKL would cascade through every child collective's entire subtree (sections, members, library, lending), making them de-facto admin of every choir in the federation. That's too much power per single grant and violates the "each choir manages itself" principle. With `_inheritrights: false` on orgs, cross-org grants are explicit per-org and intentional.

**How to apply:** When creating an organization entity, set `_inheritrights: false`. When a federation coordinator genuinely needs admin rights on multiple child orgs, grant `_editor` on each one explicitly (not via umbrella cascade). For umbrella-level read-only oversight, grant `_viewer` on each child explicitly.

## Per-type `_inheritrights` policy

| Entity type | `_inheritrights` | Rationale |
|---|---|---|
| organization | **false** | Block cross-org rights leak; rights island per org |
| section | true | Inherit from org so admin cascade reaches members via section parent |
| member | true | Multi-parent: rights union from org + each section parent |
| library | true | Inherit from org so admin cascade reaches library |
| work, edition, copy, lending | true | Library subtree cascade |
| invitation | true | Inherit from org so admins see/manage |
| application | true on create; **false** on reject | Person sees their applications via cascade `_editor: self`; on reject the BFF flips to false to lock from delete (per `[[polyphony-onboarding]]` E6 withdraw lock) |
| person | true | Person owns their own subtree (applications cascade `_editor: self`) |

## What umbrella relationships ARE for

- **Federation queries** — "all collectives under EKL", "who's in this umbrella"
- **Aggregation formulas** — `member_count` rolling up via parent traversal (verified working in session 1; formulas don't depend on rights so they cross org boundaries fine)
- **Discovery** — application path B browsing of orgs grouped by umbrella
- **Display labels** — *"Filharmoonia (a member of EKL)"*
- **NOT for rights** — rights stop at every org boundary

## Cross-org grants — explicit when wanted

| Scenario | Mechanism |
|---|---|
| EKL coordinator manages multiple child collectives | Explicit `_editor` grant on each child collective (one per collective) |
| EKL board wants read-only oversight | Explicit `_viewer` grant on each child collective |
| EKL-level invitation that auto-grants child-org access | Out of scope — invitations are per-org; one invitation per org |

## Cross-org visibility — per-property `_sharing` (primary) + aggregate formulas + BFF reports

The membership-rights invariant in `[[polyphony-roles-as-rights]]` applies to **all** explicit grants — `_owner`, `_editor`, AND `_viewer`. There is no "umbrella members auto-see children" exception via rights. Cross-org visibility (federation directory, umbrella oversight, web discovery for prospective members/audience) is delivered via three layered mechanisms — each safe under the rights-isolation principle:

### 1. Per-property `_sharing: public` on `organization` (primary, entu-native)

The `organization` entity type is `_sharing: public` (enables public projection at type level). Org instances default `_sharing: public` — **overrides the project-wide "default private" preference for this entity type specifically**, justified because choirs benefit from federation discoverability and general web findability.

Selected property definitions on `organization` marked `_sharing: public`:
- `name`, `description` — choir's public-facing identity
- `founded` (date) — when the choir was founded
- `location` (string) — e.g., "Tallinn, Estonia"
- `website` (string) — URL
- `logo` (file) — for display in directory
- `social_links` (list) — future: FB, IG, etc.
- `public_contact[*]` (ref to member) — designated public contacts; default = owner + conductor; admin can curate
- `member_count_per_section` (formula) — aggregate, no PII
- `public_event[*]` (ref to event) — events the org flagged for public visibility (TBD Topic 2)
- `repertoire` — programmes typically published (TBD Topic 2)

Most property defs stay default `_sharing: private` (rosters, lending records, internal communication, applications, etc. — hidden from anonymous even though the org instance is public).

**Critical safety property: `_sharing` is NOT inherited via `_inheritrights`** (only `_owner`/`_editor`/`_expander`/`_viewer` are — per https://www.entu.ee/overview/entities/#access-rights). Setting `_sharing: public` on the org instance does NOT make child entities public. Members, sections, library, work, edition, copy, lending, invitations all retain their own default `_sharing: private` regardless of org's setting.

**Per-org opt-out**: admin can flip their INSTANCE `_sharing` to `private` → entire org becomes invisible to anonymous web; federation falls back to BFF reports for that org.

**Note on the "default `_sharing: private`" principle** (per `[[polyphony-no-domain-sharing]]`): the org type is the documented exception. `_sharing: domain` remains excluded across all types. Other entity types keep the default-private preference.

### 2. Aggregate formulas (already work — verified session 1)

Entu's formula evaluator queries the DB directly without rights checks (source-confirmed in `entu/api/utils/formula.js`). `EKL.member_count = _child.organization.member_count SUM` returns 50 even when the caller can't see Filharmoonia/Sireen directly.

**Convention: aggregate-only** (counts, sums, averages, min/max) — never project raw data (`CONCAT_WS` of names, lists of specific titles) via formulas across rights boundaries; that would leak.

### 3. BFF curated reports

For non-aggregate detail not naturally fitting public-sharing (e.g., matchmaking — *"orgs with overlapping repertoire"*), and for truly umbrella-only-not-public analytics (federation-internal financials etc., requiring cross-org membership per the invariant):
- BFF queries child orgs using its own system credentials
- Presents curated, anonymized, or aggregate output
- App-layer concern; surface expands as operational needs emerge

### Visibility-need → mechanism

| Need | Mechanism |
|---|---|
| Federation directory (org names, contacts, public events, repertoire) | Per-property `_sharing: public` on org |
| Web discovery (prospective members, audience, journalists) | Same — falls out of public sharing |
| Federation aggregate stats (total members, score counts) | Aggregate formulas |
| Smart logic (matchmaking on public data) | BFF reports |
| Truly umbrella-only-not-public (internal financials) | BFF reports + cross-org membership |
| Detailed roster / lending / internal of Filharmoonia | Not exposed; requires being a member of Filharmoonia |

### For umbrella admins needing actual operational access to a specific child

- Join that child as a member (separate cross-org invitation)
- Per the membership-rights invariant, can then have any explicit rights there
- Matches real-world pattern: federation board member overseeing a specific collective is typically also a formal member of it

### Why this design works

- Single principle (membership-rights invariant) stays clean — no exceptions
- No N×K cascade writes — federation visibility doesn't grow with member-count × child-org-count
- Privacy-by-default via property-level sharing — opt-in publication, not opt-out exposure
- Web-discoverable side benefit — choirs and prospective members benefit; no separate "marketing site" needed

## Implications for the rest of the design

- **Lending stays naturally same-org** (`[[polyphony-lending-same-org]]`) — no cross-org library visibility via cascade
- **Member visibility within an org stays broad** — `_viewer` on org cascades to everything under it; "members see everything in their own choir" still holds
- **Cross-org person binding (E1 in `[[polyphony-onboarding]]`)** — Alice can be member of both Sireen and Filharmoonia; each member entity is in its own org's rights island; no cross-pollination
- **Umbrella-level direct membership** — if EKL has direct members (e.g., staff coordinators), those members get visibility into EKL itself only, not into child collectives — coordinator would need explicit grants on each child

## Related memory

- `[[polyphony-roles-as-rights]]` — role pattern that this isolation enables (cross-org admin requires explicit grant per org, by design)
- `[[polyphony-onboarding]]` — entity structure operating inside the islands
- `[[polyphony-lending-same-org]]` — reinforced by this isolation
- `[[polyphony-library-subtree]]` — library cascade within an org works inside the island
