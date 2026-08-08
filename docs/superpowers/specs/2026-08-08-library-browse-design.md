# Design Spec: Library Browse Surfaces — Works/Editions/Copies, Availability, Nav Entry

**Issue:** T6.3 (parent: [#54](https://github.com/mvox-dev/mvox-app/issues/54) — Slice 6, Library 1.0)
**Spec author:** Palestrina
**Status:** Ready — T6.1 ([#55](https://github.com/mvox-dev/mvox-app/issues/55)) and T6.2/T6.2b ([#56](https://github.com/mvox-dev/mvox-app/issues/56)/[#57](https://github.com/mvox-dev/mvox-app/issues/57)) complete; data is live-confirmed member-readable (Mihkel's member-seat walk, 2026-08-08 11:56, posted on #54)
**Field set:** ruled on #54/#55/#56, see §2 below (differs from the epic body's original draft — see the correction in §2.4)

---

## 1. Summary

Build `/library` — a single, read-only browse page rendering the collective's catalog as an expandable hierarchy: works → editions → copies, with per-copy availability (and borrower identity — see §2.4) derived from `lending`. Add a `library` nav entry, always visible to authenticated members. No write path anywhere in this slice — cataloguing and lending transactions are out of scope (successor: Lending 1.0, epic #54 "Out of this slice").

---

## 2. The ruled field set (T6.1/T6.2/T6.2b — do not re-derive, this is final)

All four entity types (`work`, `edition`, `copy`, `lending`) are now `_sharing:domain` at both the type tier (gate 2) and, as of T6.2b, every one of their 586 instances (gate 1: prop-def tier already widened by T6.2). The 3-gate-AND is closed for the fields below — Mihkel confirmed this live from a member seat (#54, 11:56): work title/composer, `original_language`, the entity's own domain tier, and edition names all rendered directly by URL.

### 2.1 `work` (13 instances)

| Field | Render? |
|---|---|
| `name` (title) | **yes** — newly widened |
| `composer` | **yes** — newly widened |
| `catalog_id`, `catalog_system`, `part_of`, `original_voicing`, `original_duration`, `original_language` | **yes** — already domain, kept deliberately (T6.1 finding 1) |
| `genre` | no — private |

### 2.2 `edition` (17 instances)

| Field | Render? |
|---|---|
| `name` | **yes** — newly widened |
| `publisher` | **yes** — newly widened |
| `external_link`, `arranger`, `voicing`, `duration`, `language`, `acquired_at`, `source`, `license_note` | **yes** — already domain, kept deliberately |
| `work` | available (formula string, denormalized `_parent` work name) but **not queried** — T6.3 already has the work name from the enclosing accordion node, no need for the redundant field |
| `cost` | **no** — NARROWED to private (Mihkel, money data ruling) |
| `edition_type`, `license`, `year`, `file` | no — private |

### 2.3 `copy` (552 instances)

| Field | Render? |
|---|---|
| `name` | **yes** — newly widened (the copy's human label, e.g. "Copy #3") |
| `copy_number` | **yes** — newly widened |
| `barcode`, `condition`, `notes` | no — private |

No `location`/shelf field exists on `copy` (T6.1 finding 2, confirmed no new field this slice). Not rendered.

### 2.4 `lending` (4 instances) — borrower identity is DOMAIN-OPEN, correcting the dispatch brief

**Important correction to the original task brief:** the dispatch describing this ticket proposed "members see availability but NOT the borrower's identity," citing the epic's original AC line. That AC line was **superseded** during T6.1 grooming — Mihkel's actual ruling (#54, 2026-08-08 08:21, verbatim: *"3. lets open to domain"*) widened borrower identity to **domain-open**: members see who has each copy, not just in/out. This spec follows the ruling that actually landed (verified against #54/#55/#56's committed record), not the stale draft text. The epic's own AC line is marked superseded on #54.

| Field | Render? |
|---|---|
| `member` (borrower reference) | **yes** — the borrower identity, resolved to a display name (§4.3) |
| `assigned_at` (lent-date) | **yes** |
| `copy` (which copy this lending is for) | **yes** — needed to join lending → copy |
| `assigned_until` (due date) | **yes** |
| `returned_at` | **yes** — `absent` = still out (schema note, `entu/research` schema.ts:524); this is the availability discriminator |
| `renewed_at`, `name`, `notes` | no — private |

### 2.5 Structural guard

The data layer must never request any of the still-private fields above (`barcode`, `condition`, `notes`, `edition_type`, `license`, `year`, `file`, `genre`, `edition.cost`, `lending.renewed_at`, `lending.name`, `lending.notes`) in any `props=` query string. This is a regression guard, not a privacy boundary — the boundary is server-side (entu-api's 3-gate-AND); the guard just proves this client never *tries* to render what it shouldn't, mirroring `rosterData.spec.ts`'s "never fetches private-tier data" test.

---

## 3. Route and page shape

**Route:** `/library` — one page, no sub-routes. Expandable accordion:

```
▸ Spem in alium — Thomas Tallis                      (work row)
  ▾ 40-part original — Bärenreiter                    (edition row, expanded)
      Copy #1 — Available                             (copy row)
      Copy #2 — Out, to Ada Lovelace since 2026-07-01  (copy row)
  ▸ 8-part reduction (Cooke) — Novello                 (edition row, collapsed)
▸ Ave verum corpus — William Byrd
```

- Works: title + composer, click to expand → editions
- Editions: name + publisher, nested, click to expand → copies
- Copies: name/number + availability badge
- Collapsed by default at every level (552 copies — do not render the full tree eagerly)

---

## 4. Data layer — `src/lib/library/libraryData.ts`

Follows `rosterData.ts`'s pattern exactly: `entuFetch` queries, typed raw-response mapping, pure derivation functions kept separate from orchestration/fetch functions.

### 4.1 Types

```ts
export interface Work { id: string; name: string; composer: string; }
export interface Edition { id: string; name: string; publisher: string; }
export interface Copy { id: string; name: string; copyNumber: number; }
export interface Lending {
	id: string;
	copyId: string;
	memberId: string;
	assignedAt: string;
	assignedUntil: string;
	returnedAt: string; // '' = absent = still out
}
export type CopyAvailability =
	| { status: 'available' }
	| { status: 'lent'; memberId: string; assignedAt: string; assignedUntil: string };
```

### 4.2 Query functions (mirror `rosterData.ts`/`entuSeasons.ts` exactly — `entuFetch`, explicit `limit`, raw→typed mapping)

- `listWorks(cfg, fetchImpl?)` → `entity?_type.string=work&props=name,composer&limit=500`
- `listEditions(cfg, workId, fetchImpl?)` → `entity?_type.string=edition&_parent.reference=${workId}&props=name,publisher&limit=500`
- `listCopies(cfg, editionId, fetchImpl?)` → `entity?_type.string=copy&_parent.reference=${editionId}&props=name,copy_number&limit=500`
- `listLendings(cfg, fetchImpl?)` → `entity?_type.string=lending&props=copy,member,assigned_at,assigned_until,returned_at&limit=500` (all lendings, loaded once at page mount — 4 instances today, 500 is the house-standard ample bound, same value used by `listActiveMembers`/`listRehearsals`)

Wire shapes follow established precedent in this codebase: reference props → `Array<{ reference: string }>` (`_parent`/`person` pattern, `entuSeasons.ts`/`rosterData.ts`); date props → `Array<{ date: string }>` (`SeasonRaw.start_date`, `entuSeasons.ts:74`); number props → `Array<{ number: number }>` (`duration_minutes`, `seasons/types.ts:21`); string props → `Array<{ string: string }>`.

### 4.3 Borrower name resolution — reuses the roster pattern, does NOT extract a shared helper

`lending.member` references a `member` entity, which (per `entu/research` schema.ts:287-336) carries no name of its own — same situation `rosterData.ts` already solved for roster rows: member → `person` reference → `profile` entities → narrower-wins-but-domain-preferred name scan.

Imports `listMyProfiles` directly from `$lib/profile/profileData` — NOT `rosterData.ts`'s `listProfilesForPerson`. That wrapper's own doc comment (`rosterData.ts:105-124`) states it exists "purely for roster call-site clarity," not as a cross-feature entry point; routing library's read through it would create a library→roster dependency for no reason when the generic export is one file away.

```ts
async function resolveBorrowerName(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${memberId}?props=person`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`resolveBorrowerName: member ${memberId} lookup failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { person?: Array<{ reference: string }> } };
	const personId = body.entity?.person?.[0]?.reference;
	if (!personId) throw new Error(`resolveBorrowerName: member ${memberId} carries no readable person reference`);

	const profiles = await listMyProfiles(cfg, personId, fetchImpl); // reused as-is from profileData.ts

	// Same domain-or-public scan as rosterData.ts's toRosterRow (rosterData.ts:160-167) —
	// NEVER resolveField, NEVER private. Duplicated deliberately here (rule of three: two
	// callers don't justify extracting a shared export yet) rather than reused, to avoid
	// widening rosterData.ts's surface for a one-line scan; revisit if a third caller appears.
	let domain = '';
	let pub = '';
	for (const p of profiles) {
		if (p._sharing === 'domain' && p.name.trim() !== '') domain = p.name.trim();
		else if (p._sharing === 'public' && p.name.trim() !== '') pub = p.name.trim();
	}
	return domain !== '' ? domain : pub; // '' if neither tier holds a name — UI shows a fallback label
}

export async function resolveBorrowerNames(
	cfg: EntuCfg,
	memberIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, string>> {
	const unique = [...new Set(memberIds)];
	const pairs = await Promise.all(
		unique.map(async (id) => [id, await resolveBorrowerName(cfg, id, fetchImpl)] as const)
	);
	return new Map(pairs);
}
```

Fails loud as a whole (matches `loadRoster`'s `Promise.all` semantics) — a borrower-name resolution failure rejects the whole batch rather than silently showing an unresolved copy as available or unattributed.

**Unresolved name (both tiers blank):** rendered with a fallback label (`library_borrower_unknown`), never a blank string — a copy that shows "Out" with no reason for a missing name would read as broken, not private (borrower identity is *already* domain-open by ruling; a blank isn't protecting anything).

### 4.4 `deriveCopyAvailability` — pure

```ts
export function deriveCopyAvailability(copyId: string, lendings: Lending[]): CopyAvailability {
	const active = lendings.filter((l) => l.copyId === copyId && l.returnedAt === '');
	if (active.length === 0) return { status: 'available' };
	// >1 concurrent active lending for one copy is a data anomaly (should be impossible under
	// correct lending-app discipline) — warn and take the most recently assigned, rather than
	// throwing and breaking the whole page over one dirty row.
	if (active.length > 1) {
		console.warn(`deriveCopyAvailability: copy ${copyId} has ${active.length} concurrent active lendings`);
	}
	const chosen = active.reduce((a, b) => (a.assignedAt >= b.assignedAt ? a : b));
	return { status: 'lent', memberId: chosen.memberId, assignedAt: chosen.assignedAt, assignedUntil: chosen.assignedUntil };
}
```

Pure, no network — same split as `toRosterRow`. Called per-copy at render time from already-loaded `lendings` state; borrower names are resolved once, batched, at page load (§5), not per-copy.

---

## 5. Page — `src/routes/library/+page.svelte`

Same state machine as `roster/+page.svelte`: `'loading' | 'no-collective' | 'load-error' | 'ready'`, same non-reactive `generation` staleness guard, same `getToken()` / `console.error` + generic-message error handling, same retry button pattern.

**Load sequence (on mount / collective switch):**
1. `Promise.all([listWorks(cfg), listLendings(cfg)])` — works and all lendings load together
2. Collect unique `memberId`s from lendings where `returnedAt === ''` (active only — no need to resolve names for historical/returned lendings)
3. `resolveBorrowerNames(cfg, activeMemberIds)` → `Map<memberId, name>`
4. `status = 'ready'`; `works`, `lendings`, `borrowerNames` held in `$state`

**Per-work expand:** lazily `listEditions(cfg, work.id)`, cached in a `Map<workId, Edition[]>` keyed state so re-collapsing/re-expanding doesn't refetch. Loading skeleton shown for that node while in flight.

**Per-edition expand:** lazily `listCopies(cfg, edition.id)`, same caching pattern.

**Copy row:** `deriveCopyAvailability(copy.id, lendings)` computed via `$derived` from already-loaded state — instant, no network. If `status === 'lent'`, look up `borrowerNames.get(memberId) ?? ''`; render `library_borrower_unknown` if empty.

**Svelte 5 Runes throughout** — `$state`, `$derived`, `$effect`, `$props`. No legacy `export let`/`$:`.

**Error handling:** identical shape to roster — generic localized message on load failure, raw error to `console.error`, retry button re-runs the load. A per-node (edition/copy) lazy-load failure shows an inline retry affordance on that node only, not a full-page error (a working page node shouldn't be nuked by one broken branch — this is new relative to roster, which has no nested lazy loads to fail independently).

**Empty states:** `library_empty` (zero works at all — mirrors `roster_empty`); a work with zero editions or an edition with zero copies renders an inline "nothing here" line, not a page-level empty state.

---

## 6. Nav entry

Add to `src/lib/nav/entries.ts`, following the existing declarative-row pattern exactly (`NAV_ENTRIES` array, `visible: () => true` — matches T6.1's ruled audience decision 2, "all members browse"):

```ts
const libraryIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>';

{
	key: 'library',
	label: () => m.nav_library(),
	route: '/library',
	icon: libraryIcon,
	visible: () => true,
},
```

Position: after `roster`, before `profile` — matches the epic's framing of Library as a peer browse surface to Roster, and keeps `profile`/`invite`/`collectives` (the self/admin-scoped tail) together at the end.

---

## 7. i18n — keys added to all four locales (`en`/`et`/`lv`/`uk`)

| Key | Purpose |
|---|---|
| `nav_library` | Nav entry label |
| `library_title` | Page `<h1>` |
| `library_no_collective` | No collective selected (mirrors `roster_no_collective`) |
| `library_load_error` | Top-level load failure (mirrors `roster_load_error`) |
| `library_retry` | Retry button (mirrors `roster_retry`) |
| `library_empty` | Zero works at all (mirrors `roster_empty`) |
| `library_work_composer_unknown` | Composer field blank on a work |
| `library_editions_empty` | A work with zero editions |
| `library_edition_publisher_unknown` | Publisher field blank on an edition |
| `library_copies_empty` | An edition with zero copies |
| `library_copy_available` | Availability badge — in |
| `library_copy_lent_to` | Availability badge — out, `{name}` param |
| `library_borrower_unknown` | Fallback when neither name tier resolves |
| `library_lent_since` | `{date}` param — lent-date label |
| `library_node_load_error` | Inline per-node (edition/copy) lazy-load failure |
| `library_node_retry` | Inline per-node retry button |

Follows the established `m.key({ param })` Paraglide interpolation pattern (`agenda_gap_weeks`, `invite_landing_expires`).

---

## 8. Read-only — structural constraint

No create/update/delete path exists anywhere in this slice's code. `libraryData.ts` contains only `list*`/`resolve*`/`derive*` functions — no `entuFetch(..., { method: 'POST' | 'DELETE' })` call anywhere in the module. This mirrors the epic's explicit boundary ("no member surface can create, edit, or lend anything") and is verifiable by grep, same as `soleCreatePath.spec.ts`'s structural guard for `createProfile` (though here the assertion is the *absence* of any write call, not a single allowed one).

---

## 9. What this spec does NOT cover (T6.5's job)

- The live gate (real member seat, real phone) — T6.5
- The unruled-field negative check with positive control (e.g. confirming `edition.cost`/`copy.barcode` do NOT render) — T6.5, though the structural guard in §2.5 is this slice's client-side contribution to that proof
- a11y pass beyond what's naturally present (semantic list/button elements, `aria-expanded` on accordion toggles) — T6.4 owns the dedicated pass; this spec includes baseline `aria-expanded`/`aria-controls` on expand toggles as a starting point, not a finished a11y audit

---

(*MVOX:Palestrina*)
