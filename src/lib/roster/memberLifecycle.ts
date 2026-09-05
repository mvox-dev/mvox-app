import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listAdmins, listLibrarians } from '$lib/admin/roleManagement';
import { listProfilesForPerson, toRosterRow, type RosterRow } from './rosterData';

// #255 — the member LIFECYCLE write layer (deactivate / reinstate) plus the
// inactive-members read that powers the reinstatement surface (done-when 4).
//
// Contract (issue #255 — Gama ruling + Bentham proposal, all four recs accepted):
//
//   - `deactivateMember` / `reinstateMember`: the SAME mechanism in two
//     directions — a `status` flip via the house clear-then-set wire
//     (precedent: updateRsvpStatus, rsvpData.ts:148 — POST appends on Entu, so
//     replace = GET value-ids, DELETE property/{id} each, POST the new value).
//     Done-when 1: `status` is the ONLY thing that changes — no other property
//     write, no `_parent` change, no rights change, ever.
//   - The off-'active' value is `'archived'` — canonical v4E member.status is
//     noted `active | archived` (schema.ts:323), so no schema change and no
//     invented value. User-facing copy NEVER says "archived" (Gama copy
//     binding: "not active"); the stored value is a wire fact, not copy.
//   - `listInactiveMembers`: the `status.string=archived` mirror of
//     `listActiveMembers` (rosterData.ts:94) — same props (person,_parent),
//     because the surface MUST show each inactive member's section assignment
//     (Gama adopted Bentham's binding: that is what explains the section
//     ghost-blocker, deleteSection's deliberately unscoped count, with zero
//     write-path change).
//   - `loadInactiveRoster`: orchestration mirror of `loadRoster` — profile
//     fan-out via listProfilesForPerson + toRosterRow, so inactive members
//     resolve to displayable names under the same #28 completeness gate.
//   - `listDeactivateBlockers`: the REFUSAL read (accepted rec 1 — deactivate
//     REFUSES while the person holds a manageable `_owner`/`_editor` grant;
//     demotion stays a separate admin action). Built on listAdmins /
//     listLibrarians (roleManagement.ts:310,348) — no new wire shape. FAIL
//     LOUD: a failed rights read must reject, never resolve [] — resolving
//     empty on error would let a deactivate proceed past an unverified grant.

/** The two values the member `status` flip moves between (v4E: active | archived). */
export type MemberLifecycleStatus = 'active' | 'archived';

/**
 * Flip `status` to 'archived' via clear-then-set. Writes NOTHING else — the
 * member entity survives whole (history keeps its subject; `_parent` keeps the
 * reinstatement context and the section ghost-blocker explanation).
 */
export async function deactivateMember(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await flipMemberStatus(cfg, memberId, 'archived', fetchImpl);
}

/**
 * Flip `status` back to 'active' via the SAME clear-then-set wire — reinstate
 * WITHOUT a fresh invitation (done-when 4). No invite machinery anywhere near
 * this path.
 */
export async function reinstateMember(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await flipMemberStatus(cfg, memberId, 'active', fetchImpl);
}

/**
 * The shared clear-then-set wire (precedent: updateRsvpStatus, rsvpData.ts:148).
 * GET the member's current `status` value-id(s), DELETE every one found (generic
 * — a corrupted double-value defense, not just the one expected value), then POST
 * a body containing ONLY `{type:'status', string:newStatus}` — done-when 1: no
 * other property is ever read, cleared or written by this function.
 */
async function flipMemberStatus(
	cfg: EntuCfg,
	memberId: string,
	newStatus: MemberLifecycleStatus,
	fetchImpl: typeof fetch
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${memberId}?props=status`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`memberLifecycle: status lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: { status?: Array<{ _id: string }> } };
	const statusValues = body.entity?.status ?? [];

	for (const value of statusValues) {
		const delRes = await entuFetch(
			cfg.db,
			`property/${value._id}`,
			cfg.token,
			{ method: 'DELETE' },
			fetchImpl
		);
		if (!delRes.ok) throw new Error(`memberLifecycle: status clear failed: ${delRes.status}`);
	}

	const postRes = await entuFetch(
		cfg.db,
		`entity/${memberId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'status', string: newStatus }])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`memberLifecycle: status write failed: ${postRes.status}`);
}

/** Mirror of `ActiveMember` for the status.string=archived read. */
export interface InactiveMember {
	memberId: string;
	personId: string;
	/** Section `_parent` entries — NOT cleared on deactivate (done-when 1). */
	sectionIds: string[];
	dbEntityId?: string;
}

/** `listActiveMembers`'s query shape with `status.string=archived`. */
export async function listInactiveMembers(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<InactiveMember[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=member&status.string=archived&props=person,_parent&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listInactiveMembers failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			person?: Array<{ reference: string }>;
			_parent?: Array<{ reference: string; entity_type?: string }>;
		}>;
	};
	return (body.entities ?? []).map((raw) => {
		const personId = raw.person?.[0]?.reference;
		if (!personId) {
			throw new Error(
				`listInactiveMembers: member ${raw._id} — cannot read person reference (visible fields insufficient for this reader's rights)`
			);
		}
		const sectionIds = (raw._parent ?? [])
			.filter((p) => p.entity_type === 'section')
			.map((p) => p.reference);
		const dbEntityId = (raw._parent ?? []).find((p) => p.entity_type === 'database')?.reference;
		return { memberId: raw._id, personId, sectionIds, dbEntityId };
	});
}

/** `loadRoster`'s orchestration over `listInactiveMembers` — rows with names. */
export async function loadInactiveRoster(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<RosterRow[]> {
	const members = await listInactiveMembers(cfg, fetchImpl);
	const rows = await Promise.all(
		members.map(async (member) => {
			const profiles = await listProfilesForPerson(cfg, member.personId, fetchImpl);
			return toRosterRow(member, profiles);
		})
	);
	return rows.filter((r): r is RosterRow => r !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/** One manageable grant that blocks deactivation (refusal names the remedy). */
export interface DeactivateBlocker {
	role: 'admin' | 'librarian';
}

/**
 * The grants that make deactivate REFUSE: the person appears in listAdmins on
 * the database entity, or in listLibrarians on the library entity (when the
 * collective has one — `libraryId: null` skips the librarian read entirely).
 * Rejects on a failed rights read — refusal-by-default, never fail-open.
 */
export async function listDeactivateBlockers(
	cfg: EntuCfg,
	personId: string,
	dbEntityId: string,
	libraryId: string | null,
	fetchImpl: typeof fetch = fetch
): Promise<DeactivateBlocker[]> {
	// #255 review r3 F1 — an EMPTY dbEntityId is not a scoped rights read, it is a
	// different request: `fetchRights` builds `entity/${id}?props=_owner,_editor`,
	// so '' collapses it to `entity/?props=…` — entu-api's entity LIST route,
	// which answers 200 with `entities` and no `entity` key. The parse then reads
	// no rights at all and this function resolves [], i.e. "no blockers" on a
	// check that never happened. Refuse the call outright so no caller can
	// reintroduce the empty-string coercion that made it reachable.
	if (!dbEntityId) {
		throw new Error('listDeactivateBlockers: no database entity id — the rights read cannot be scoped');
	}

	const blockers: DeactivateBlocker[] = [];

	// FAIL LOUD by construction: no try/catch here — a rejected rights read
	// propagates straight out of this function rather than being swallowed into
	// an empty (fail-open) blocker list.
	const admins = await listAdmins(cfg, dbEntityId, personId, fetchImpl);
	if (admins.persons.some((p) => p.id === personId)) blockers.push({ role: 'admin' });

	if (libraryId) {
		const librarians = await listLibrarians(cfg, libraryId, personId, fetchImpl);
		if (librarians.persons.some((p) => p.id === personId)) blockers.push({ role: 'librarian' });
	}

	return blockers;
}

// (*MVOX:Josquin*)
