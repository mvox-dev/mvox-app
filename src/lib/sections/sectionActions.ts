import { entuFetch } from '$lib/entu/request';
import {
	SectionMembershipMissingError,
	SectionNotEmptyError,
	SectionReparentPartialError
} from './sectionErrors';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

// #253 — defensive response-body read for the reparent/renumber partial-write
// evidence (SectionReparentPartialError, sectionErrors.ts). A broken/detached
// stream on an ALREADY-FAILING response must not mask the status the caller
// needs; degrade to '' rather than let a second rejection swallow the first.
async function bodyTextOf(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return '';
	}
}

// TS.3/#97 — the section CREATE write layer. GREEN.
// TU.1/#109 (finding #10) — top-level parent org threading + fail-loud on a
// multi-org db. GREEN.
// #161 (collective = database, Mihkel ruling 2026-08-16) — the legacy
// organization fallback is RETIRED; a top-level section with no explicit
// collective id now resolves the DATABASE entity instead. GREEN.
//
// CONTRACT (pinned by sectionActions.create.spec.ts + sectionActions.create-database.spec.ts;
// the surviving `dbEntityId`-present cases of sectionActions.create-org.spec.ts still hold):
//
//   - `createSection(cfg, { name, parentId?, dbEntityId? })` creates ONE `section`
//     entity and resolves to the NEW ENTITY's id.
//   - `_type` sent as a resolved REFERENCE via resolveTypeId(cfg, 'section')
//     (#10 pinned wire-shape — never `{ string: 'section' }`).
//   - `parentId` present → `_parent` reference = that SECTION id (sub-section);
//     `dbEntityId` is irrelevant, no lookup happens.
//   - `parentId` absent/null → "(top level)": the section is a direct child of
//     the COLLECTIVE (the DATABASE entity — #161).
//       - `dbEntityId` present → `_parent` = that id VERBATIM, ZERO lookup fetches.
//         The caller (the roster page) already knows the collective (database
//         entity) id from the member's own `_parent` — the data layer must not
//         guess.
//       - `dbEntityId` absent → resolve the database entity
//         (`entity?_type.string=database&limit=1`, exactly one per db,
//         guaranteed by entu — the multi-org ambiguity guard this used to need
//         has nothing left to guard). No readable database entity fails loud
//         naming the db (a parent is REQUIRED: v4E
//         `parentConstraint: 'exactly_one_of'`).
//   - `_sharing: 'public'` EXPLICIT at create time — a deliberate WIDEN, not a
//     copy of the parent tier: inherit would yield `domain` (the org is `domain`,
//     6/6 live), and v4E pins section sharing as public for federation
//     discoverability. See the create-body comment below for the full #133
//     rationale and the live caveat.
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
	/** Parent SECTION id; absent/null = top level (direct child of the collective). */
	parentId?: string | null;
	/**
	 * #161 (collective = database, Mihkel ruling 2026-08-16) — the collective's
	 * DATABASE entity id, which the caller already holds (the roster page reads
	 * it off the member's own `_parent`), used as `_parent` for a TOP-LEVEL
	 * create (parentId absent/null).
	 *
	 * The data layer must not guess. Contract pinned by
	 * sectionActions.create-database.spec.ts:
	 *   - dbEntityId present + no parentId → `_parent` = dbEntityId, ZERO lookup fetches.
	 *   - dbEntityId absent + no parentId → resolve the database entity
	 *     (`_type.string=database&limit=1`, exactly one per db).
	 *   - parentId present → dbEntityId is irrelevant (sub-section, parent IS the section).
	 */
	dbEntityId?: string | null;
}

/**
 * Create a `section` entity — under the given parent section, or under the
 * DATABASE entity (the collective — #161) when `parentId` is absent. Resolves
 * to the new section's entity id. See module contract above.
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
		// Sub-section: the given section IS the parent, no lookup at all —
		// dbEntityId is irrelevant here (see CreateSectionInput.dbEntityId doc).
		parentRef = input.parentId;
	} else if (input.dbEntityId) {
		// #161 — the caller already knows the collective (database entity) id
		// (the roster page reads it off the member's own `_parent`); use it
		// verbatim, ZERO lookup fetches. The data layer must not guess.
		parentRef = input.dbEntityId;
	} else {
		// #161 (collective = database, Mihkel ruling 2026-08-16) — the legacy
		// "sole organization entity, limit 1" fallback is RETIRED (organization
		// instances no longer exist, #159); resolve the DATABASE
		// entity instead — exactly one per db, guaranteed by entu, so there is
		// no multi-match ambiguity left to guard against. v4E pins
		// `parentConstraint: 'exactly_one_of'` — a parentless section is not a
		// thing, so no readable database entity fails loud naming the db.
		const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
		const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
		if (!dbEntityId) {
			throw new Error(
				`createSection: no database entity is readable in db '${cfg.db}' — a section requires a parent`
			);
		}
		parentRef = dbEntityId;
	}

	// Full create body, exactly: _type + _parent + name + _sharing — no
	// display_order, no voice, no description (see module contract above).
	//
	// explicit `_sharing: public` required (#133 audit) — KEEP, do not remove:
	// inherit cannot produce this value. The org is `domain` (6/6 live) and seed
	// sections are `domain`, so omitting the property would yield `domain`, not
	// `public` — this is a deliberate widen (v4E federation discoverability), not
	// a copy of the parent tier. CAVEAT live-verified at audit time: the
	// `section` TYPE entity is itself `domain`, which caps every section prop-def
	// at domain (aggregate.js:113-121) and gets its domain bucket dropped
	// whenever the instance is `public` (aggregate.js:269) — the one live public
	// section (6a7cc04e23dc1d97bb8f203b) currently reads back nameless even to an
	// authenticated member. `public` is presently counterproductive in practice,
	// but the fix is widening the section TYPE entity (a data change), not
	// deleting this line.
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
//   - #253: throws `SectionReparentPartialError` (step `'renumber'`) on any
//     non-2xx — status AND response body captured, plus `i` sections fully
//     renumbered of `orderedIds.length` (see sectionErrors.ts). The loop
//     STOPS at the failing section: no retry, nothing past the gap.

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
	const total = orderedIds.length;
	for (let i = 0; i < total; i++) {
		const id = orderedIds[i];
		const number = i + 1;
		// #253 — `i` sections BEFORE this one are fully renumbered (POST landed
		// AND every old value deleted) no matter which of this section's three
		// steps fails below; that is the `renumberedCount` the typed error
		// carries. The loop STOPS here (no retry, no continuing past the gap —
		// PO refusal on #253): section i+1..total-1 are never touched.

		const getRes = await entuFetch(cfg.db, `entity/${id}?props=display_order`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) {
			throw new SectionReparentPartialError(
				'renumber',
				i,
				total,
				getRes.status,
				await bodyTextOf(getRes)
			);
		}
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
		if (!postRes.ok) {
			throw new SectionReparentPartialError(
				'renumber',
				i,
				total,
				postRes.status,
				await bodyTextOf(postRes)
			);
		}

		for (const value of existing) {
			const delRes = await entuFetch(cfg.db, `property/${value._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
			if (!delRes.ok) {
				throw new SectionReparentPartialError(
					'renumber',
					i,
					total,
					delRes.status,
					await bodyTextOf(delRes)
				);
			}
		}
	}
}

// TU.2/#110 (finding #7) — the section DELETE write layer. GREEN.
//
// CONTRACT (pinned by sectionActions.delete.spec.ts):
//
//   - `deleteSection(cfg, sectionId)` first VERIFIES SERVER-SIDE that the
//     section is empty, then deletes the SECTION ENTITY:
//       1. two scoped counting GETs, issued in parallel —
//          `entity?_type.string=member&_parent.reference={id}&limit=1` and
//          `entity?_type.string=section&_parent.reference={id}&limit=1`. Only
//          the response `count` is read (`limit=1` keeps the payload to one
//          entity; the count is of the whole match set).
//       2. either count > 0 → throw `SectionNotEmptyError` (tagged
//          `section-not-empty`) and DO NOT DELETE. Nothing is written.
//       3. otherwise `DELETE entity/{sectionId}` — the entity side of the
//          endpoint split (a section id is an ENTITY id; a `/property/{id}`
//          DELETE here would 404 and leave the section standing — see the
//          delete-shape doc on `unassignMemberSection`/`reorderSections` above
//          for the split in general).
//   - #110 review F3 — the verification is NOT redundant with the page's
//     `canRemove` gate, and does not replace it either (a control that never
//     appears beats a refused tap). `canRemove` measures emptiness against the
//     ROSTER, which is `status.string=active` + name-complete ONLY (rosterData's
//     query + `toRosterRow`'s #28 gate), and against a tree the page fetched
//     once and never refreshes. Both blind spots put a "(0)" and a ✕ on a
//     section that is not actually empty, and Entu's delete soft-deletes every
//     property REFERENCING the deleted entity — i.e. exactly those members'
//     section `_parent` values, silently. The counts here are the only
//     authority that is neither narrowed nor stale.
//   - Throws on non-2xx (of the lookups or the delete) with the status surfaced.

interface CountBody {
	count?: number;
	entities?: unknown[];
}

/** `count` of a scoped `entity?…` response, preferring the server's own count
 *  over the (limit-capped) entities array length. */
async function countOf(res: Response): Promise<number> {
	const body = (await res.json()) as CountBody;
	return body.count ?? body.entities?.length ?? 0;
}

/**
 * Delete a `section` entity ("Remove" — #110/#7) after verifying server-side
 * that nothing is parented to it. Rejects with `SectionNotEmptyError` (nothing
 * written) when it still holds members or sub-sections. The caller still owns
 * the admin-only + on-screen-empty gate. See module contract above.
 */
export async function deleteSection(
	cfg: EntuCfg,
	sectionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const scoped = `_parent.reference=${encodeURIComponent(sectionId)}&limit=1`;
	const [memberRes, childRes] = await Promise.all([
		entuFetch(cfg.db, `entity?_type.string=member&${scoped}`, cfg.token, {}, fetchImpl),
		entuFetch(cfg.db, `entity?_type.string=section&${scoped}`, cfg.token, {}, fetchImpl)
	]);
	if (!memberRes.ok) {
		throw new Error(`deleteSection: member lookup failed: HTTP ${memberRes.status}`);
	}
	if (!childRes.ok) {
		throw new Error(`deleteSection: sub-section lookup failed: HTTP ${childRes.status}`);
	}
	const [memberCount, childCount] = await Promise.all([countOf(memberRes), countOf(childRes)]);
	if (memberCount > 0 || childCount > 0) {
		throw new SectionNotEmptyError(sectionId, memberCount, childCount);
	}

	const res = await entuFetch(cfg.db, `entity/${sectionId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteSection failed: ${res.status}`);
}

// #155/S3 — the section REPARENT write layer (indent/unindent). RED: stub only.
//
// CONTRACT (pinned by sectionActions.reparent.spec.ts):
//
//   - `reparentSection(cfg, sectionId, newParentId)` changes WHERE a section
//     hangs in the tree: its `_parent` reference moves to `newParentId` —
//     a sibling section on INDENT (nest under the immediate previous sibling),
//     the grandparent on UNINDENT (the parent's own parent section, or the
//     ORGANIZATION id when promoting to top level — v4E `parentConstraint:
//     'exactly_one_of'` means a section always has exactly one parent, org or
//     section, so the caller resolves WHICH id; this layer just re-points).
//   - Replace semantics per the pinned Entu wire contract (POST APPENDS to
//     implicitly multi-valued props — a naive POST would leave the section
//     with TWO parents), same choreography as eventFieldEdit/reorderSections:
//       1. GET `entity/{sectionId}?props=_parent` — the existing value id(s),
//          captured BEFORE the POST so the deletes can never target the value
//          we are about to write;
//       2. POST `entity/{sectionId}` with body EXACTLY
//          `[{ type: '_parent', reference: newParentId }]`;
//       3. DELETE `/property/{valueId}` for EVERY id from step 1 — not just
//          the first (duplicates from corrupted state all go; a leftover
//          `_parent` value would violate `exactly_one_of` as a phantom
//          second parent).
//     POST-BEFORE-DELETE: a failed POST leaves the old parent untouched (the
//     section never dangles parentless); a failed DELETE leaves a recoverable
//     duplicate the next reparent's GET-then-delete-all sweeps.
//   - Old value ids go to `DELETE /property/{valueId}` ONLY — never
//     `DELETE /entity/...` (the endpoint split: that would delete the section
//     or its parent, not the reference between them).
//   - `newParentId === sectionId` throws WITHOUT any fetch — a section can
//     never be its own parent, and the guard belongs in the data layer too
//     (defense in depth; the page's sibling math should never produce it).
//   - #253: throws `SectionReparentPartialError` (step `'reparent'`,
//     renumberedCount/totalCount `0`/`0` — the renumber never begins here) on
//     any non-2xx — status AND response body captured (see sectionErrors.ts).

/**
 * Re-point a section's `_parent` reference to `newParentId` (indent/unindent —
 * #155/S3). Replace semantics: GET old `_parent` value ids → POST the new
 * reference → DELETE every old value id. See module contract above.
 */
export async function reparentSection(
	cfg: EntuCfg,
	sectionId: string,
	newParentId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	if (newParentId === sectionId) {
		throw new Error('reparentSection: a section cannot become its own parent');
	}

	const getRes = await entuFetch(cfg.db, `entity/${sectionId}?props=_parent`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) {
		throw new SectionReparentPartialError('reparent', 0, 0, getRes.status, await bodyTextOf(getRes));
	}
	const body = (await getRes.json()) as { entity?: { _parent?: MemberParentValue[] } };
	const existing = body.entity?._parent ?? [];

	const postRes = await entuFetch(
		cfg.db,
		`entity/${sectionId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_parent', reference: newParentId }])
		},
		fetchImpl
	);
	if (!postRes.ok) {
		throw new SectionReparentPartialError('reparent', 0, 0, postRes.status, await bodyTextOf(postRes));
	}

	for (const value of existing) {
		const delRes = await entuFetch(cfg.db, `property/${value._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) {
			throw new SectionReparentPartialError('reparent', 0, 0, delRes.status, await bodyTextOf(delRes));
		}
	}
}

// #155/S4 — the section RENAME write layer.
//
// CONTRACT (pinned by sectionActions.rename.spec.ts):
//
//   - `renameSection(cfg, sectionId, name)` replaces the section's `name`
//     property. Replace semantics per the pinned Entu wire contract (POST
//     APPENDS to implicitly multi-valued props), same choreography as
//     eventFieldEdit/reorderSections/reparentSection:
//       1. GET `entity/{sectionId}?props=name` — the existing value id(s),
//          captured BEFORE the POST so the deletes can only ever target
//          PRE-EXISTING ids;
//       2. POST `entity/{sectionId}` with body EXACTLY
//          `[{ type: 'name', string: <trimmed name> }]`;
//       3. DELETE `/property/{valueId}` for EVERY id from step 1 (not just
//          the first — corrupted duplicate state all goes).
//     POST-BEFORE-DELETE: a failed POST leaves the old name untouched; a
//     failed DELETE leaves a recoverable duplicate the next rename sweeps.
//   - `name` sent TRIMMED; an empty/whitespace-only name throws WITHOUT any
//     fetch (defense in depth — the inline form validates too, but the data
//     layer must not rename a section to blank).
//   - Old value ids go to `DELETE /property/{valueId}` ONLY — never
//     `DELETE /entity/...` (the endpoint split: that would delete the
//     section itself).
//   - Throws on any non-2xx (status surfaced).

/**
 * Rename a `section` entity — replace its `name` property. Replace
 * semantics: GET old `name` value ids → POST the new value → DELETE every
 * old value id. See module contract above.
 */
export async function renameSection(
	cfg: EntuCfg,
	sectionId: string,
	name: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed) {
		throw new Error('renameSection: name must not be empty');
	}

	const getRes = await entuFetch(cfg.db, `entity/${sectionId}?props=name`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`renameSection lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: { name?: Array<{ _id: string }> } };
	const existing = body.entity?.name ?? [];

	const postRes = await entuFetch(
		cfg.db,
		`entity/${sectionId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'name', string: trimmed }])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`renameSection POST failed: ${postRes.status}`);

	for (const value of existing) {
		const delRes = await entuFetch(cfg.db, `property/${value._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`renameSection delete failed: ${delRes.status}`);
	}
}

// (*MVOX:Tallis* — RED stubs + contract, TS.2/#96)
// (*MVOX:Palestrina* — GREEN implementation, TS.2/#96)
// (*MVOX:Tallis* — RED createSection stub + contract, TS.3/#97)
// (*MVOX:Palestrina* — GREEN implementation, TS.3/#97)
// (*MVOX:Tallis* — RED reorderSections stub + contract, TS.4/#98)
// (*MVOX:Palestrina* — GREEN implementation, TS.4/#98)
// (*MVOX:Tallis* — RED deleteSection stub + contract, TU.2/#110 finding #7)
// (*MVOX:Palestrina* — GREEN implementation, TU.2/#110 finding #7)
// (*MVOX:Palestrina* — #110 review F3: server-side emptiness verification on delete)
// (*MVOX:Tallis* — RED reparentSection stub + contract, #155/S3)
// (*MVOX:Palestrina* — GREEN implementation, #155/S3)
// (*MVOX:Palestrina* — renameSection, #155/S4)
// (*MVOX:Byrd* — GREEN: SectionReparentPartialError, body capture, #253)
