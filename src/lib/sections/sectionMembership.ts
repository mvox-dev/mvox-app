// Section membership writes: a member's sections are its `_parent` references (PO, 2026-08-11).
import { entuFetch } from '$lib/entu/request';
import { SectionMembershipMissingError } from './sectionErrors';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export interface MemberParentValue {
	_id: string;
	reference: string;
	entity_type?: string;
}

// POST appends, so this adds one `_parent` and leaves the rest. A stale row can add a duplicate;
// unassign sweeps every match and rosterData groups them, so no read-modify-write here.
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

	// Tagged: the server already holds the state the optimistic UI moved to, so the caller
	// keeps the removal instead of reverting it.
	if (matches.length === 0) {
		throw new SectionMembershipMissingError(memberId, sectionId);
	}

	// Every matching value goes, so duplicate state leaves no phantom membership behind.
	for (const value of matches) {
		const delRes = await entuFetch(cfg.db, `property/${value._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`unassignMemberSection delete failed: ${delRes.status}`);
	}
}
