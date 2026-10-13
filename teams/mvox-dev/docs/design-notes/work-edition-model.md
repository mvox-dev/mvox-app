<!-- Moved from the lead's harness auto-memory (project_polyphony_work_edition_model.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-work-edition-model

> Work = abstract composition (FRBR-Work sense); arrangements/transcriptions/reductions are different Editions of the same Work

Polyphony models Work as the **abstract musical composition**, not the specific musical content. Arrangements, transcriptions, reductions, critical editions — all are Editions of the same Work.

Example: Bach's Magnificat in D (BWV 243) is ONE Work. The original 5-voice score, a modern 4-voice SATB arrangement by John Smith, and a piano reduction by Czerny are three separate Edition entities, all children of the same Work.

**Why:** PO decision 2026-05-17. Simpler model — arrangements are linked to the original via shared Work parent, no cross-Work `based_on` reference needed for the common arrangement case. Aligns with FRBR's Work concept (the abstract intellectual entity that survives across realizations).

**How to apply:**
- `arranger` lives on **Edition**, not Work (since each arrangement is a different Edition)
- Catalogers should consider an arrangement of an existing piece as a new Edition under the existing Work, NOT a new Work
- A `based_on` (Work-to-Work) reference would only be needed for **cross-Work derivation** (e.g., Variations on a theme by Paganini, where the variations are a genuinely different work that references its inspiration). Not needed for the basic arrangement case. Defer until/unless a concrete need arises.
- Excerpts/movements (e.g., "Et exultavit" from Magnificat) and their relationship to the parent Work is **not yet decided** — open design question.

**Voicing / duration / language (decided 2026-05-17): on Work, with optional override on Edition + read-time inheritance.** Work carries the canonical value (`Work.original_voicing`, `Work.original_duration`, `Work.original_language`). Edition has its own `voicing`/`duration`/`language` properties, but they're OPTIONAL. When empty, the BFF read-layer falls back to the parent Work's value. When set, the Edition value overrides — used for arrangements that diverge from the composer's original.

**Implementation implications:**
- Entu doesn't support property-level inheritance natively — this is a BFF read-resolver pattern, not an Entu mechanism
- Every consumer (BFF, UI, future plugins, exports) must apply the fallback consistently → build one shared resolver utility
- Queries like `edition?voicing.string=SATB` only match editions with the value explicitly set; matching inherited values requires query-layer expansion (probably accepted limitation, handled client-side)
- "Empty" means absent (the Entu property doesn't exist on the entity), not stored-as-null

**`_display` formula properties (deferred 2026-05-17):** We considered adding `voicing_display`/`duration_display`/`language_display` formulas to surface the inherited value in Entu's webapp UI (which doesn't go through our BFF). Probed CONCAT_WS behavior live and confirmed it doesn't deduplicate, so a CONCAT_WS-based fallback formula renders `"SATB / SATB"` when the edition matches the original — too noisy for the common case. Mihkel talked to Argo (Entu co-author); **Argo will add an `IF` formula function**. Once that lands, adding the display formulas becomes a minor update (`IF voicing voicing _parent.work.original_voicing` or similar). Until then: BFF resolver only.

**Upstream tracker**: see Argo / Entu — IF function addition, no formal issue link yet. Posted findings on entu/www#3 with the empirical CONCAT_WS behavior + the COALESCE feature gap.

**Catalog identifiers (decided 2026-05-17): on Work, as two properties.** `Work.catalog_id` (string, e.g. "243") and `Work.catalog_system` (string, e.g. "BWV"). Separating the two enables clean queries like "all BWV works" without parsing free text. Optional fields — populated when the composer has a recognized catalog system.

**Movements/excerpts (decided 2026-05-17): modeled as child Works with a `part_of` reference.** "Et exultavit" (movement 2 of Magnificat) is its own Work entity with `Work.part_of → Magnificat-Work`. Each movement gets full Work properties (own voicing, duration, language, catalog_id if any). Enables Programs to reference individual movements as first-class Works. Parent-Work properties don't auto-aggregate to movement-Works (no formula yet — TBD if needed).

**What still needs deciding** (in the same schema design thread):
- `duration` — same question (arrangements may abridge); likely follows the voicing pattern
- `language` — original text language is intrinsic, but translations exist; how are translated Editions handled?
- `name` — Work.name = title; Edition.name = edition label. Both exist in v3, no conflict.
- Catalog numbers (BWV, K, op.) — should Work have a `catalog_id` or `opus` property? v3 doesn't.
- Uniqueness / dedup — how do we detect that two libraries' "Bach Magnificat" entries are the same Work?

Related: [[polyphony-library-entity]] (where Work and Edition live structurally — under library)
