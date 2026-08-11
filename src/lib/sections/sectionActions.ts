import { entuFetch } from '$lib/entu/request';
import { SectionMembershipMissingError } from './sectionErrors';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

// TS.3/#97 — the section CREATE write layer. GREEN.
//
// CONTRACT (pinned by sectionActions.create.spec.ts):
//
//   - `createSection(cfg, { name, parentId? })` creates ONE `section` entity and
//     resolves to the NEW ENTITY's id.
//   - `_type` sent as a resolved REFERENCE via resolveTypeId(cfg, 'section')
//     (#10 pinned wire-shape — never `{ string: 'section' }`).
//   - `parentId` present → `_parent` reference = that SECTION id (sub-section).
//   - `parentId` absent/null → "(top level)": the section is a direct child of
//     the ORGANIZATION. The org is resolved the same way inviteData's
//     resolveInviteOrg does — `entity?_type.string=organization&limit=1`
//     (single-collective de-fan; polyphony's extra org entities are unreadable
//     to non-admin callers) — and FAILS LOUD naming the db when none is
//     readable (a parent is REQUIRED: v4E `parentConstraint: 'exactly_one_of'`).
//   - `_sharing: 'public'` EXPLICIT at create time — v4E pins section sharing
//     as public (federation discoverability); never rely on inherit.
//   - `name` sent trimmed; an empty/whitespace-only name throws WITHOUT any
//     fetch (defense in depth — the form validates too, but the data layer must
//     not create a nameless section).
//   - Full create body is EXACTLY: _type + _parent + name + _sharing — no
//     display_order (v4E marks it optional; ordering-by-name is the fallback),
//     no voice, no description.
//   - Duplicate-name detection is NOT here — the picker already holds the full
//     section tree, so the duplicate check is a LOCAL compare in the component
//     (see SectionPicker.create.spec.ts); the data layer stays one POST.
//   - Throws on any non-2xx (status surfaced).

export interface CreateSectionInput {
	/** Section name (required; trimmed before sending). */
	name: string;
	/** Parent SECTION id; absent/null = top level (direct child of the org). */
	parentId?: string | null;
}

/**
 * Create a `section` entity — under the given parent section, or under the
 * (sole readable) organization when `parentId` is absent. Resolves to the new
 * section's entity id. See module contract above.
 */
export async function createSection(
	cfg: EntuCfg,
	input: CreateSectionInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	// Name hygiene BEFORE any fetch — a nameless section is never created, and
	// the caller gets a message naming what's wrong (not a bare stub-shaped throw).
	const name = input.name.trim();
	if (!name) {
		throw new Error('createSection: name must not be empty');
	}

	const typeId = await resolveTypeId(cfg, 'section', fetchImpl);

	let parentRef: string;
	if (input.parentId) {
		// Sub-section: the given section IS the parent, no org lookup at all.
		parentRef = input.parentId;
	} else {
		// Top level: the section's parent is the sole readable organization —
		// same single-collective de-fan as inviteData.resolveOrgId
		// (`_type.string=organization&limit=1`). v4E pins
		// `parentConstraint: 'exactly_one_of'` — a parentless section is not a
		// thing, so an unreadable org fails loud naming the db.
		const orgRes = await entuFetch(
			cfg.db,
			'entity?_type.string=organization&limit=1',
			cfg.token,
			{},
			fetchImpl
		);
		if (!orgRes.ok) {
			throw new Error(`createSection: organization lookup failed: HTTP ${orgRes.status}`);
		}
		const orgBody = (await orgRes.json()) as { entities?: Array<{ _id?: string }> };
		const orgId = orgBody.entities?.[0]?._id;
		if (!orgId) {
			throw new Error(
				`createSection: no organization entity is readable in db '${cfg.db}' — a section requires a parent`
			);
		}
		parentRef = orgId;
	}

	// Full create body, exactly: _type + _parent + name + _sharing — no
	// display_order, no voice, no description (see module contract above).
	const props: Array<{ type: string; reference?: string; string?: string }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: parentRef },
		{ type: 'name', string: name },
		{ type: '_sharing', string: 'public' }
	];

	const createRes = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(props)
		},
		fetchImpl
	);
	if (!createRes.ok) {
		throw new Error(`createSection: create failed: HTTP ${createRes.status}`);
	}
	const createBody = (await createRes.json()) as { _id?: string };
	if (!createBody._id) {
		throw new Error('createSection: create returned 2xx without _id (apparent-success trap)');
	}
	return createBody._id;
}

// TS.2/#96 — the section ASSIGNMENT write layer. GREEN.
//
// CONTRACT (pinned by sectionActions.spec.ts):
//
// PO ruling 2026-08-11 (#95/#80): section membership lives SOLELY in the
// member's `_parent` references (`entity_type: 'section'`) — there is NO
// `current_section` property (the #96 issue body predates the ruling; `_parent`
// wins). A member can be in MULTIPLE sections at once, so:
//
//   - `assignMemberSection` ADDS one `_parent` reference to the member. Entu
//     POST appends to multi-valued props (never replaces), so this is a SINGLE
//     `POST entity/{memberId}` with body `[{ type: '_parent', reference:
//     sectionId }]` — no read-modify-write round-trip, no `_sharing` (the
//     member entity already owns its own), no `_type` (not a create).
//   - `unassignMemberSection` removes ONE SPECIFIC section membership: GET the
//     member's `_parent` values, then `DELETE /property/{valueId}` for every
//     value with `entity_type === 'section' && reference === sectionId`
//     (generic delete — duplicates from corrupted state all go, mirroring
//     updateAttendanceStatus's sentinel sweep). It must NEVER touch the org
//     `_parent` value or other sections' values, and must NEVER issue
//     `DELETE /entity/{memberId}` (property-value vs entity endpoint split —
//     conflating them deletes the member). FAILS LOUD (naming member and
//     section) when no matching value exists — a stale picker tapped an
//     assignment that is already gone; the caller's reconcile handles it. That
//     one throw is a `SectionMembershipMissingError` (`code:
//     'section-parent-missing'`, see sectionErrors.ts) so the caller can tell
//     "the server already agrees with the optimistic UI" apart from "the write
//     failed" — F1 code-review fix; reverting on it pinned a phantom membership
//     on a page that never refetches.
//
// KNOWN, ACCEPTED (F3 code-review note, not a bug to fix here): `assign` is an
// unconditional append with no read of what the member already holds, so a stale
// row (UI says unassigned, server already has that `_parent`) yields a DUPLICATE
// value for the same section. De-duplicating would need exactly the
// read-modify-write round-trip this contract deliberately avoids, and both
// downstream consumers already tolerate it — `unassignMemberSection`'s generic
// sweep deletes EVERY matching value, and `rosterData`'s sectionIds mapping
// groups duplicates into one row.
//
// Per-tap immediate writes — NOT batch. Each picker tap is one
// assignMemberSection / unassignMemberSection round-trip; "(Unassigned)" is the
// page calling unassignMemberSection once per currently-assigned section. There
// is no "save all" payload shape anywhere in this module's API.

interface MemberParentValue {
	_id: string;
	reference: string;
	entity_type?: string;
}

/**
 * Add ONE section membership: `POST entity/{memberId}` with a single `_parent`
 * reference to the section. POST appends — existing `_parent` values (org,
 * other sections) are untouched; exactly one fetch call. Throws on non-2xx.
 */
export async function assignMemberSection(
	cfg: EntuCfg,
	memberId: string,
	sectionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(
		cfg.db,
		`entity/${memberId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_parent', reference: sectionId }])
		},
		fetchImpl
	);
	if (!res.ok) throw new Error(`assignMemberSection failed: ${res.status}`);
}

/**
 * Remove ONE SPECIFIC section membership: GET `entity/{memberId}?props=_parent`,
 * then `DELETE /property/{valueId}` for every `_parent` value whose
 * `entity_type === 'section'` and `reference === sectionId`. Fails loud when no
 * such value exists. Throws on any non-2xx. See module header.
 */
export async function unassignMemberSection(
	cfg: EntuCfg,
	memberId: string,
	sectionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${memberId}?props=_parent`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`unassignMemberSection lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: { _parent?: MemberParentValue[] } };
	const matches = (body.entity?._parent ?? []).filter(
		(p) => p.entity_type === 'section' && p.reference === sectionId
	);

	// FAIL LOUD — a stale picker tapped an assignment that's already gone; name
	// both member and section so the caller's revert/log is actionable. TAGGED
	// (F1 code-review fix): this is the one rejection meaning the server already
	// holds the state the optimistic UI moved to, so the caller must reconcile
	// FORWARD (keep the removal) rather than revert. Message unchanged.
	if (matches.length === 0) {
		throw new SectionMembershipMissingError(memberId, sectionId);
	}

	// Generic delete — every matching value goes, not just the first (mirrors
	// updateAttendanceStatus's sentinel sweep; corrupted duplicate state must not
	// leave an orphan phantom membership behind).
	for (const value of matches) {
		const delRes = await entuFetch(cfg.db, `property/${value._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`unassignMemberSection delete failed: ${delRes.status}`);
	}
}

// TS.4/#98 — the section REORDER write layer. GREEN.
//
// CONTRACT (pinned by sectionActions.reorder.spec.ts):
//
//   - `reorderSections(cfg, orderedIds)` renumbers `display_order` on EVERY
//     section in `orderedIds` to its 1-BASED position in the array (index 0 →
//     display_order 1). `orderedIds` is ONE SIBLING GROUP in its new order —
//     the top-level sections, or one parent's sub-sections — never a mix
//     (display_order sorts within a parent; the UI enforces the sibling
//     constraint, see page.roster-reorder.spec.ts).
//   - Per section, the same replace shape as repertoireActions'
//     `updateProgramItemOrdinal`: GET `entity/{id}?props=display_order` →
//     POST `entity/{id}` body EXACTLY `[{ type: 'display_order', number: n }]`
//     → DELETE `property/{valueId}` for EVERY old value id (Entu POST APPENDS
//     to implicitly multi-valued props; duplicates from corrupted state all
//     go). POST-BEFORE-DELETE is deliberate: a failed POST leaves the old
//     value untouched (no DELETE fires for that section); a failed DELETE
//     leaves a duplicate the next renumber sweeps — either beats an EMPTY
//     display_order (which sorts the section to the end as Infinity).
//   - A section with NO existing display_order value → POST only, no DELETE.
//   - Old value ids go to `DELETE /property/{valueId}` ONLY — never
//     `DELETE /entity/...` (the endpoint split: that would delete the section).
//   - `orderedIds: []` resolves without any fetch.
//   - Throws on any non-2xx (status surfaced).

interface DisplayOrderValue {
	_id: string;
}

/**
 * Renumber `display_order` on one sibling group of sections to match
 * `orderedIds`' order (1-based). See module contract above.
 */
export async function reorderSections(
	cfg: EntuCfg,
	orderedIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	for (let i = 0; i < orderedIds.length; i++) {
		const id = orderedIds[i];
		const number = i + 1;

		const getRes = await entuFetch(cfg.db, `entity/${id}?props=display_order`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) throw new Error(`reorderSections lookup failed: ${getRes.status}`);
		const body = (await getRes.json()) as { entity?: { display_order?: DisplayOrderValue[] } };
		const existing = body.entity?.display_order ?? [];

		const postRes = await entuFetch(
			cfg.db,
			`entity/${id}`,
			cfg.token,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ type: 'display_order', number }])
			},
			fetchImpl
		);
		if (!postRes.ok) throw new Error(`reorderSections POST failed: ${postRes.status}`);

		for (const value of existing) {
			const delRes = await entuFetch(cfg.db, `property/${value._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
			if (!delRes.ok) throw new Error(`reorderSections delete failed: ${delRes.status}`);
		}
	}
}

// (*MVOX:Tallis* — RED stubs + contract, TS.2/#96)
// (*MVOX:Palestrina* — GREEN implementation, TS.2/#96)
// (*MVOX:Tallis* — RED createSection stub + contract, TS.3/#97)
// (*MVOX:Palestrina* — GREEN implementation, TS.3/#97)
// (*MVOX:Tallis* — RED reorderSections stub + contract, TS.4/#98)
// (*MVOX:Palestrina* — GREEN implementation, TS.4/#98)
