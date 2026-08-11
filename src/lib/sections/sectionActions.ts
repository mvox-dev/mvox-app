import { entuFetch } from '$lib/entu/request';
import { SectionMembershipMissingError } from './sectionErrors';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

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

// (*MVOX:Tallis* — RED stubs + contract, TS.2/#96)
// (*MVOX:Palestrina* — GREEN implementation, TS.2/#96)
