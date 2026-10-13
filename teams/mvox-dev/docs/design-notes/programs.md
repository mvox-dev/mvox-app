<!-- Moved from the lead's harness auto-memory (project_polyphony_programs.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-programs

> program_item (child of event) + repertoire_item (child of season) — junction entities with name as formula; requires edition.work formula in library subtree (decided 2026-05-18 session 3)

Programs and repertoire are junction entities that link works (via editions) to seasons (repertoire) and events (programs). Both have name auto-derived via formula from the referenced work.

## Entity definitions

```
repertoire_item  (child of season; add_from = season type; _sharing: public default)
  ── name       string (formula)  `work.*.name CONCAT` — auto-derived from work's name
  ── work       ref → work        single, mandatory
  ── edition    ref → edition     single, optional (preferred / pinned edition for this season)
```

**Naming**: chose `repertoire_item` over `repertoire` for precision (each entity is one piece in the repertoire, not the whole list). Parallels `program_item` and v3's original naming.

**`add_from = season`** — Entu UI "Add" button for repertoire_item appears only when admin is in a season's context. Avoids accidental creation elsewhere.

**Sharing**: public default — federation directory can see each season's repertoire by querying `_child.repertoire_item` under public seasons.

**State tracking** (rehearsing / performed / dropped) — not in MVP. Junction entity is positioned to receive a status field later without restructuring. For now: "in repertoire" = entity exists; performance evidence comes from `program_item` references in concert events.

```
program_item  (child of event; add_from = event type; _sharing matches parent event)
  ── name       string (formula)  `edition.*.work CONCAT` — work name via edition's `work` formula
  ── edition    ref → edition     single, mandatory (work derived as edition._parent)
  ── ordinal    number            position in concert programme; admin-set integer
  ── notes      text (optional)   soloists, dedications, programme-note text
```

**No `work` ref on program_item** — work is derivable as edition's parent. To get work's name displayed, the formula chains through `edition.work` (formula on edition, see library-subtree).

**`edition` is mandatory** on program_item. BFF can default it from `repertoire_item.edition` if work is in season's repertoire and program_item.edition is unset (UI shows "inherited: <edition name>" with override button).

**Sharing**: instance `_sharing` matches event's `_sharing` (BFF cascades on event sharing change). Concerts that are public → their program_items are public. No per-item override.

**Ordinal**: simple integer; admin sets order; UI handles drag-to-reorder (assigning fresh integers). Fractional ordinals like 1.5 supported for easy insertion if useful.

**Intermissions / breaks** — not modeled for MVP. If needed: either special program_item (no edition, name="Intermission") or separate `program_break` entity. YAGNI.

## edition.work formula — required addition to library subtree

To display work's name on program_item, we need a two-hop chain (program_item → edition → work) but Entu formulas only support single-hop traversal. Solution: intermediate formula on edition.

**Addition to `[[polyphony-library-subtree]]`**:

```
edition (existing entity, add this property)
  ── work  string (formula)  `_parent` — auto-derives work's name from parent
```

The single-token `_parent` formula resolves to the parent entity's name as a string (verified live 2026-05-18). Although declared type could be `reference`, Entu silently coerces formula output to string; lean `type: string` for honesty.

Then `program_item.name = edition.*.work CONCAT` resolves to work name via single-hop through edition's pre-computed `work` property. Both formulas are single-hop.

## Sharing cascade (BFF-mediated)

Same pattern as `[[polyphony-seasons-events]]`'s series → event cascade. When admin flips `event._sharing`, BFF iterates child program_items and updates each (since `_sharing` isn't inherited by Entu).

## Related memory

- `[[polyphony-library-subtree]]` — work / edition / copy entities; `edition.work` formula addition needed
- `[[polyphony-seasons-events]]` — event + season entities that are program_item / repertoire_item parents
- `[[polyphony-roles-as-rights]]` — conductor role = `_editor` cascade on event/season; can create program_item / repertoire_item natively
- `[[polyphony-bff-rights-pattern]]` — `program_item.edition` BFF default-from-repertoire logic is part of read-time enrichment, not elevated
