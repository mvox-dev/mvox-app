<!-- Moved from the lead's harness auto-memory (project_polyphony_section_structure.md) by memkit, 2026-10-14 (memory-kit adoption); body unchanged, harness front matter dropped. Design heritage, not current schema: see scripts/migrations/lib/mvox-schema-extensions.ts. -->

# polyphony-section-structure

> Polyphony section entity — recursive tree under org, flexible member attachment at any level, public _sharing for federation discoverability (decided 2026-05-17, session 2)

The `section` entity defines a choir's internal organizational structure — voice groupings, ensembles, sub-sections. Sections form a **recursive tree** under organization. Members attach to any node in the tree (leaf or inner) via multi-parent. Rights cascade through the tree natively via Entu's `_inheritrights`.

**Why:** Choirs have varied structures — flat SATB, nested S→S1/S2, special ensembles overlapping the main sections, quartets with their own internal voice splits. A single recursive section entity supports all of these without separate entity types. The tree mirrors the conceptual structure naturally.

**How to apply:** When designing UI or queries for choir structure, treat `section` as a tree node. Member assignment = add section to `member._parent` list. Section-leader role = `_editor` on a specific section node, which cascades to descendants (sub-sections + their members).

## Entity definition

```
section  (child of org OR child of another section; can have member and/or section children; _inheritrights: true)
  ── name           string                                  required — e.g., "Soprano", "Soprano 1", "Quartet"
  ── voice          ref → voice taxonomy (optional)         categorization; null for mixed-voice sections (quartet, full_choir)
  ── description    text (optional)                         purpose / notes
  ── display_order  number (optional)                       UI sort within parent
  ── member_count   formula  `(_child.member COUNT) (_child.section.member_count SUM) +`
                                                            recursive: own direct members + sub-section totals
```

## Recursive structure — example layouts

```
org
  ├── full_choir
  │     ├── S → S1, S2 → (members in S1 or S2)
  │     ├── A → A1, A2 → ...
  │     ├── T → T1, T2 → ...
  │     └── B → B1, B2 → ...
  └── quartet
        ├── S → (1 direct member)
        ├── A → (1 direct member)
        ├── T → (1 direct member)
        └── B → (1 direct member)
```

Sections in different subtrees can share names (full_choir's S vs quartet's S) — they're distinct entities at distinct positions in the tree.

## Flexible member attachment (any level)

Members may attach DIRECTLY to inner sections, not only to leaves. Examples:
- Soloist in S without subsection assignment: `member._parent` includes `full_choir/S` directly
- Quartet member: `member._parent` includes `quartet/S` (which has no sub-sections, but the model would equally support sub-divisions)
- Transitional placement: admin places new member at `full_choir/S` while deciding between S1 and S2

The recursive `member_count` formula handles this naturally — `_child.member COUNT` picks up direct members at any node, and sub-section sums add the rest.

## Cross-tree multi-parent

A member can sing in multiple section trees simultaneously via multi-parent:

```
alice.member._parent = [org, full_choir/S/S1, quartet/S]
```

- Alice is direct child of `full_choir/S/S1` AND `quartet/S` (and `org`)
- Counted in `S1` (direct: 1) → rolls up to `S` → `full_choir`
- Counted in `quartet/S` (direct: 1) → rolls up to `quartet`
- Counted once in `org.member_count` via the flat `_child.member COUNT` (member is direct child of org per the always-child-of-org rule)

## Rights cascade through the tree

Section-leader = `_editor` on a section. Native Entu cascade:
- Leader of `full_choir/S` has `_editor` on S → cascades to S1, S2 → cascades through them to their member children
- Different leader on S1 specifically gets only S1's cascade — granular control without role-tracking app state
- Verified in session 1: transitive inheritance through arbitrary depth, ~1.5–3.5s per level

The pattern eliminates app-side "what section is this leader leading" lookups — it's expressed natively in the rights grant location.

## Sharing model (per-property `_sharing`, mirrors org/person pattern)

```
section type _sharing: public
section instances default _sharing: public

property defs:
  name             public
  voice            public
  description      public
  display_order    public
  member_count     public
```

**Anonymous can see** an org's full section tree + per-section counts — useful for federation discoverability ("this choir has SATB plus a special quartet → I want to join").

**Per-section opt-out** (granular at section level, not just org level): admin sets a specific section's instance `_sharing: private` — useful for a private invitation-only ensemble (paid soloist quartet, audition-only group) where the org wants that one subgroup hidden but rest of the structure visible.

**Whole-org opt-out**: admin sets org instance `_sharing: private` → anonymous can't navigate into the org → sections unreachable via the tree even though their individual `_sharing` is public (sections technically accessible by direct ID but not enumerable from outside).

**Members remain private throughout** — `member` entities are independent and default `_sharing: private` (PII). Public can't see member rosters regardless of section visibility.

**Section-leader contacts NOT federation-visible** — that stays an internal role. Federation contacts at org level only (owner + conductor in `org.public_contact[*]`, see `[[polyphony-org-rights-isolation]]`).

## Voice taxonomy entity (referenced by `section.voice` and `person.voice`)

Voice entities are global — children of the polyphony database root entity (or a dedicated `taxonomies` parent). `_sharing: public` — every org reads voice names from the same source.

```
voice
  ── name           string                    e.g., "Soprano", "Violin", "Trumpet"
  ── class          string                    e.g., "vocals", "strings", "brass", "woodwinds", "percussion", "keyboards"
  ── display_order  number (optional)         UI sort within class
  ── description    text (optional)           for less-common voices (Countertenor, etc.)
```

**`class` enables platform reach beyond pure choirs** — orchestras, bands, mixed ensembles. For polyphony's choir focus, primary use is `class: vocals` voices (Soprano/Mezzo/Alto/Tenor/Baritone/Bass). The categorization lets the same Entu deployment serve instrumental ensembles too, with the same membership/section/role machinery.

## Related memory

- `[[polyphony-onboarding]]` — member entity definition + path A/B onboarding flows
- `[[polyphony-roles-as-rights]]` — section-leader role mechanism (`_editor` on section)
- `[[polyphony-org-rights-isolation]]` — `_inheritrights: false` on org boundary; per-property `_sharing` model for federation visibility
- `[[polyphony-library-subtree]]` — similar entity tree pattern (work → edition → copy under library); proves recursive-cascade model works
