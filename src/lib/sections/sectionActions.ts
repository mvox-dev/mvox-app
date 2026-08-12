import { entuFetch } from '$lib/entu/request';
import { SectionMembershipMissingError, SectionNotEmptyError } from './sectionErrors';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

// TS.3/#97 — the section CREATE write layer. GREEN.
// TU.1/#109 (finding #10) — top-level parent org threading + fail-loud on a
// multi-org db. GREEN.
//
// CONTRACT (pinned by sectionActions.create.spec.ts + sectionActions.create-org.spec.ts):
//
//   - `createSection(cfg, { name, parentId?, orgId? })` creates ONE `section`
//     entity and resolves to the NEW ENTITY's id.
//   - `_type` sent as a resolved REFERENCE via resolveTypeId(cfg, 'section')
//     (#10 pinned wire-shape — never `{ string: 'section' }`).
//   - `parentId` present → `_parent` reference = that SECTION id (sub-section);
//     `orgId` is irrelevant, no org lookup happens.
//   - `parentId` absent/null → "(top level)": the section is a direct child of
//     the ORGANIZATION.
//       - `orgId` present → `_parent` = that org id VERBATIM, ZERO org-lookup
//         fetches. The caller (the roster page) already knows the collective
//         org from the member's own `_parent` — the data layer must not guess.
//       - `orgId` absent → legacy sole-org resolution:
//         `entity?_type.string=organization&limit=1`. A MULTI-ORG db
//         (response `count` > 1) FAILS LOUD naming the db — live-verified
//         2026-08-12: polyphony has SIX `_sharing:domain` org entities and
//         `limit=1` returns the UMBRELLA FEDERATION first, not the collective,
//         so the old silent guess parented every top-level section under the
//         wrong org. A single readable org still resolves as before
//         (unchanged regression guard). No readable org at all fails loud
//         naming the db (a parent is REQUIRED: v4E
//         `parentConstraint: 'exactly_one_of'`).
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
	/**
	 * TU.1/#109 (finding #10) — the COLLECTIVE ORGANIZATION id the caller already
	 * holds, used as `_parent` for a TOP-LEVEL create (parentId absent/null).
	 *
	 * WHY (live-verified 2026-08-12): the `entity?_type.string=organization&limit=1`
	 * fallback's premise — "polyphony's extra org entities are unreadable to
	 * non-admin callers" — is FALSE. All 6 org entities in live polyphony are
	 * `_sharing: domain`, so every authenticated member reads all 6, and `limit=1`
	 * returns "Eesti Kammerkooride Liit" — the UMBRELLA FEDERATION, not the
	 * collective (EFK). Top-level sections were being parented under the wrong
	 * org (and refused outright for callers without rights on the umbrella).
	 *
	 * The roster page ALREADY holds the right org: every member's `_parent`
	 * carries an `entity_type: 'organization'` entry (live-verified: 133/133
	 * active members → EFK). The caller threads it here; the data layer must not
	 * guess. Contract pinned by sectionActions.create-org.spec.ts:
	 *   - orgId present + no parentId → `_parent` = orgId, ZERO lookup fetches.
	 *   - orgId absent + no parentId → legacy sole-org resolution, but a
	 *     MULTI-ORG db (response `count` > 1) FAILS LOUD naming the db — never
	 *     silently picks whichever org the API returned first.
	 *   - parentId present → orgId is irrelevant (sub-section, parent IS the section).
	 */
	orgId?: string | null;
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
		// Sub-section: the given section IS the parent, no org lookup at all —
		// orgId is irrelevant here (see CreateSectionInput.orgId doc).
		parentRef = input.parentId;
	} else if (input.orgId) {
		// TU.1/#109 (finding #10 root cause A) — the caller already knows the
		// collective org (the roster page reads it off the member's own
		// `_parent`); use it verbatim, ZERO org-lookup fetches. The data layer
		// must not guess — a `limit=1` guess live-verifiably returns the
		// UMBRELLA federation, not the collective, on a multi-org db.
		parentRef = input.orgId;
	} else {
		// Legacy sole-org resolution — the LAST `_type.string=organization&limit=1`
		// in the app, kept ONLY as a guarded fallback for callers that genuinely
		// hold no org (single-org dbs). It is NOT a pattern to copy:
		// `inviteData.resolveOrgId` and `adminStore.resolveAdmin` both used to
		// resolve this way and BOTH were wrong live — polyphony answers `count: 6`
		// with the umbrella federation first (probe-67). They now derive the org
		// from the acting person's own member `_parent` via
		// `resolveMyOrgId` ($lib/org/myOrg), which is what a new call site should
		// do. v4E pins `parentConstraint: 'exactly_one_of'` — a parentless section
		// is not a thing, so an unreadable org fails loud naming the db.
		// TU.1/#109 — a MULTI-ORG db (`count` > 1) ALSO fails loud naming the db:
		// the old behavior silently parented under whichever org the API returned
		// first (live-verifiably the umbrella federation, not the collective).
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
		const orgBody = (await orgRes.json()) as {
			entities?: Array<{ _id?: string }>;
			count?: number;
		};
		const orgCount = orgBody.count ?? orgBody.entities?.length ?? 0;
		if (orgCount > 1) {
			throw new Error(
				`createSection: db '${cfg.db}' has ${orgCount} organization entities readable — cannot guess which is the collective; pass orgId explicitly`
			);
		}
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

// (*MVOX:Tallis* — RED stubs + contract, TS.2/#96)
// (*MVOX:Palestrina* — GREEN implementation, TS.2/#96)
// (*MVOX:Tallis* — RED createSection stub + contract, TS.3/#97)
// (*MVOX:Palestrina* — GREEN implementation, TS.3/#97)
// (*MVOX:Tallis* — RED reorderSections stub + contract, TS.4/#98)
// (*MVOX:Palestrina* — GREEN implementation, TS.4/#98)
// (*MVOX:Tallis* — RED deleteSection stub + contract, TU.2/#110 finding #7)
// (*MVOX:Palestrina* — GREEN implementation, TU.2/#110 finding #7)
// (*MVOX:Palestrina* — #110 review F3: server-side emptiness verification on delete)
