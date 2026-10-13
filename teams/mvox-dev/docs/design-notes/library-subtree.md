<!-- Moved from the lead's harness auto-memory (project_polyphony_library_subtree.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-library-subtree

> Final shape of polyphony's library subtree entities — work, edition, copy, lending (decided 2026-05-17)

Complete property design for the entities under `library`, decided in the 2026-05-17 schema review session. Builds on the structural decisions captured in [[polyphony-library-entity]] and the work/edition definitions in [[polyphony-work-edition-model]].

## Hierarchy

```
organization
  └── library
        ├── work
        │     ├── work (movements via `part_of` ref to parent work)
        │     └── edition
        │           └── copy
        └── lending (single parent under library; refs to copy + member)
```

## work

```
work (child of library, OR child of another work for movements)
  ── name                string         title
  ── composer            string
  ── catalog_id          string         e.g., "243"
  ── catalog_system      string         e.g., "BWV"
  ── original_voicing    string         composer's intended voicing
  ── original_duration   number         composer's intended duration (minutes)
  ── original_language   string (list)  text language(s) — Latin for Magnificat
  ── genre               string (list)
  ── part_of             reference → work  (for movements; e.g., "Et exultavit" → "Magnificat")
```

`arranger` does NOT live on work — arrangements are different Editions of the same Work.

## edition

```
edition (child of work)
  ── name              string             e.g., "Bärenreiter BA 5103, vocal score"
  ── work              string (formula)   `_parent` — work's name auto-derived from parent (added 2026-05-18)
  ── edition_type      string (set)       full_score | vocal_score | part | reduction | audio | video | supplementary
  ── arranger          string             optional — for arranged editions
  ── voicing           string             OPTIONAL override — empty inherits from work via BFF
  ── duration          number             OPTIONAL override — empty inherits from work via BFF
  ── language          string (list)      OPTIONAL override — empty inherits from work via BFF
  ── publisher         string
  ── year              number
  ── license           string (set)       public_domain | licensed | owned
  ── acquired_at       date
  ── source            string             donor / vendor / publisher direct
  ── cost              number             optional
  ── license_note      text
  ── file              file (list)        S3-backed (PDFs, audio, video)
```

`edition.work` formula added 2026-05-18 to support `program_item.name` single-hop lookup (see `[[polyphony-programs]]`). Entu formulas only support single-hop traversal — program_item → edition → work would be two hops, so `edition.work` denormalizes work's name on edition for downstream single-hop access. Verified live: formula `_parent` (single token) auto-resolves to parent entity's name as string.

Future `voicing_display` / `duration_display` / `language_display` formulas deferred until Argo lands the `IF` function in Entu — at that point a minor update adds them as readonly formulas. See [[polyphony-work-edition-model]] for the inheritance pattern details.

## copy

```
copy (child of edition)
  ── name          string         e.g., "Copy #3"
  ── copy_number   number         sequential within parent edition
  ── barcode       string         scannable identifier — app enforces uniqueness (Entu has no unique constraint)
  ── condition     string (set)   good | fair | poor | lost
  ── notes         text           per-copy annotations (conductor markings, missing pages)
```

Lending state (`assigned_to`, `assigned_at`) is NOT on copy — moved to `lending` entity.

## lending

```
lending (child of library)
  ── name              string (formula)    member.*.name copy.*.name ' — ' CONCAT_WS    → "Alice Smith — Copy #3"
  ── copy              reference → copy    single, mandatory
  ── member            reference → member  single, mandatory
  ── assigned_at       date                mandatory — when lent out
  ── assigned_until    date                due back
  ── returned_at       date                set when returned (absent = still out)
  ── renewed_at        date (list)         each renewal extends assigned_until
  ── notes             text                lending-specific notes
```

**`name` formula** is single-hop only (Entu doesn't support multi-hop traversal in formulas — verified live 2026-05-17, see entu/www#4). Work title would require 3 hops (lending → copy → edition → work.name) which is unavailable.

**Same-org constraint**: BFF must validate that `lending.copy._parent` (transitively up to org) matches `lending.member._parent` (org). See [[polyphony-lending-same-org]].

## Rights model (decided 2026-05-17, simplified later same day)

Built on top of [[entu-no-noaccess]] (positive-only rights) and [[polyphony-no-domain-sharing]] (no `_sharing: domain`):

- **library** entity inherits from `organization` (`_inheritrights: true`)
- **org owner** → `_owner` on org → cascades to library subtree (full control everywhere)
- **org admin** → `_editor` on org → cascades to library subtree (can manage catalog and lending, intentional overlap with librarian)
- **librarian** role → `_editor` on `library` entity explicitly (via app-level role→ACL sync); cascades to work/edition/copy/lending children. **This is the only role with an explicit non-org grant.**
- **all members** of the org → `_viewer` on **`organization`** (NOT on library) via role→ACL sync. Cascades through every org subtree: library, work, edition, copy, lending, sections, seasons, events, fellow members, etc. **One grant per member, on the org — covers everything.**
- **conductor / section_leader** roles → no extra grants beyond what members get
- **umbrella admin** (e.g., EKL admin) → gets read access to child collectives' libraries automatically via multi-parent rights union on `organization`

**Lending visibility**: lending inherits from library which inherits from org. Members see all lendings naturally via the org cascade. Within a choir, who-has-what is communal — accepted, not treated as private.

**Member-of-org visibility is broad and intentional** (confirmed 2026-05-17): members see EVERYTHING under their org. No carve-outs for HR data, financial info, internal-only documents — if such categories ever surface, they need explicit rights handling (e.g., a separate parent outside the org, or per-entity `_viewer` removal). Default is "members see all org-level entities" — fellow Members, Sections, Seasons, Events, catalog, inventory, lendings. This is the choir-as-social-hub model.

**Implementation: role→ACL sync** (app-level, BFF responsibility):
- On Member creation in Org X → add `Member.person` as `_viewer` on Org X
- On Member archive → remove `Member.person` from `_viewer` on Org X
- On librarian role assignment → add the Person as `_editor` on Org X's `library` entity
- On librarian role removal → remove the Person from `_editor`
- Idempotency: read-then-write, or update existing property by `_id`. Never blind-POST (Entu has no uniqueness — produces duplicates)

**Member picker for lending** (resolved via this simplification): BFF queries `_type.string=member&_parent.reference=<orgId>` directly. No reference_query placeholder substitution needed. Static `reference_query: _type.string=member` on the lending entity type is fine — Entu webapp users see all members (rare path; app-level same-org validation catches mistakes).

## library entity properties (decided 2026-05-17)

- **One library per organization** (1:1). Implied by all the design above; confirmed explicitly.
- **`library.name` = formula** derived from the parent org: `_parent.*.name 'Library' ' ' CONCAT_WS` → e.g., "Filharmoonia Library". Single-hop reference (works per the formula probes).
- **`library.contact` derived from rights** — no separate `contact_librarian` property. The contact list is computed: query library's `_editor` entries, filter to `inherited != true` AND `entity_type == 'person'`. This returns persons with EXPLICIT `_editor` grants on the library — i.e., librarians (admin/owner cascade is filtered out by the `inherited` flag).
- **No additional properties** on library. Minimal entity. `_inheritrights: true` (system flag) + `name` (formula) + derived contacts (via rights query). That's it.

## Inherited vs explicit rights — empirical finding (2026-05-17)

Probed and confirmed: Entu marks inherited rights entries with an **`inherited: true`** field. Explicit grants don't have the field. When the same person has both an inherited and an explicit entry on the same entity, they merge into a single explicit entry (no `inherited` flag).

This is the discriminator that makes the "contact derived from rights" pattern work — without it, you can't distinguish admin (cascade) from librarian (explicit).

**Undocumented in entu.dev** — filed for docs update on entu/www#2.

## reference_query for lending.member picker — verified static (2026-05-17)

Goal: have the Entu webapp's `member` picker on a lending entity filter to "members of this lending's grandparent org" automatically. Probed: Entu webapp does NOT support placeholder substitution in `reference_query`. Source: `entu/webapp/app/components/my/select/reference.vue:50-52` parses the value with `queryStringToObject(props.query)` and merges with the base filter verbatim.

**Decision**: use static `reference_query: _type.string=member` on the lending entity type. Enforce same-org rule at BFF write-time. Polyphony's own UI applies the parent filter on its picker. Entu webapp users (rare direct-edit case) see the unfiltered list and pick manually — app-level validation catches mistakes.

**The API itself supports the filter** (verified: `_type.string=member&_parent.reference=<orgId>` correctly returns 26 Filharmoonia members) — it's just the static-string nature of `reference_query` that prevents dynamic per-entity scoping.

**Implication for BFF**: when reading rights to compute "who manages X directly," filter by `inherited != true`. When applying role→ACL sync, write/remove explicit grants only; don't touch inherited ones.

## Open / deferred from this design
- Properties on `member` entity (separate from library subtree, will surface in walkthrough)
- Uniqueness/dedup for works across libraries (when ESL imports a master catalog) — deferred
- Excerpt/movement aggregation formulas (does parent work `duration` aggregate from movements? out of scope for now)
- `voicing_display` / `duration_display` / `language_display` formulas — deferred to Argo's `IF` function
- App-level role→ACL sync implementation (when it runs, idempotency, ordering with Entu's eventual consistency)

## Transitive inheritance — empirically verified (2026-05-17)

Probed a 5-level chain T1→T2→T3→T4→T5 (all `_inheritrights: true`, no rights to person P initially). Added `_owner: P` to T1, sampled chain at 1-second intervals:

| Level | First seen |
|---|---|
| T1 (the change point) | 0.6s |
| T2 (1 level down) | 2.1s |
| T3 (2 levels down) | 3.6s |
| T4 (3 levels down) | 5.6s |
| T5 (4 levels down) | 9.0s |

**Findings:**
- Transitive inheritance works — propagates through arbitrary depth without manual intervention
- Per-level propagation is sequential (each child needs its parent to materialize first)
- Per-level delay ≈ 1.5–3.5s, growing slightly with depth
- No manual touch/aggregation/re-eval needed — Entu handles cascade automatically

**For library subtree implications:**
- `library → work → edition → copy` is 3 levels → full propagation ~5–7s when rights granted at library
- `library → lending` is 1 level → ~2s
- BFF write-then-read patterns on grandchild entities must account for the delay (retry/poll, or accept eventual-consistency UX)
- For instant visibility, write rights directly at each level (defeats the inheritance simplicity — only worth it for rare cases)

## Relationship to v3 (entu-research/docs/schema/v3/)

This design is a SIGNIFICANT restructure of v3:
- v3 has `Work`, `Edition`, `InventoryCopy` as direct children of `Organization`
- New design introduces `library` entity, moves `work`/`edition` under it, renames `InventoryCopy` → `copy`, adds `lending` entity
- v3's `InventoryCopy.assigned_to` / `assigned_at` inline lending fields → moved to `lending` entity with full state machine
- v3's `Work.arranger` → moved to Edition (option A: Work is abstract composition)
- v3's `Work.voicing` / `duration` / `language` → renamed to `original_*` on Work; added optional overrides on Edition with BFF read-time inheritance

Not yet implemented in entu-research repo or live polyphony DB — Phase A (lowercase rename) is the only schema change deployed. This subtree redesign would be a follow-on PR.
