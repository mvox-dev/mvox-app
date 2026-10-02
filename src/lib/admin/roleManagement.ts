// Role management for /admin: lists and grants on Entu's aggregated rights read.

// The read folds every _owner into _editor under the same _id and splices in the parent's rights
// as `inherited: true`; fetchRights alone un-folds and filters it.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { RosterRow } from '$lib/roster/rosterData';

export interface RolePerson {
	id: string;
	name: string;
	role: 'owner' | 'editor';
	valueIds: string[];
}

interface RightsValue {
	_id: string;
	reference?: string;
	string?: string;
	entity_type?: string;
	inherited?: boolean;
}

interface OwnRights {
	ownOwners: RightsValue[];
	ownEditors: RightsValue[];
	// Inherited owners included: entu-api accepts a rights write from anyone in the aggregate _owner.
	allOwners: RightsValue[];
}

interface RoleListing {
	persons: RolePerson[];
	canManage: boolean;
}

/** Inherited entries are the parent's values, never this entity's to list or delete. */
export async function fetchRights(
	cfg: EntuCfg,
	entityId: string,
	fetchImpl: typeof fetch = fetch
): Promise<OwnRights> {
	const res = await entuFetch(
		cfg.db,
		`entity/${entityId}?props=_owner,_editor`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`roleManagement: rights lookup failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: { _owner?: RightsValue[]; _editor?: RightsValue[] };
	};
	// The database entity owns itself; a value with no entity_type still counts as a person.
	const isPersonValue = (v: RightsValue): boolean =>
		v.entity_type === undefined || v.entity_type === 'person';

	const owner = (body.entity?._owner ?? []).filter(isPersonValue);
	const editor = (body.entity?._editor ?? []).filter(isPersonValue);

	const ownOwners = owner.filter((v) => !v.inherited);
	const ownOwnerIds = new Set(ownOwners.map((v) => v._id));
	const ownEditors = editor.filter((v) => !v.inherited && !ownOwnerIds.has(v._id));

	return { ownOwners, ownEditors, allOwners: owner };
}

const ROLE_LOCKOUT = 'role-lockout' as const;
const ROLE_GRANT_MISSING = 'role-grant-missing' as const;

export class RoleLockoutError extends Error {
	readonly code = ROLE_LOCKOUT;
	readonly entityId: string;
	readonly personId: string;
	constructor(entityId: string, personId: string) {
		super(
			`removeAdmin: removing person ${personId} would leave entity ${entityId} with zero _owner values — refusing (lockout prevention)`
		);
		this.name = 'RoleLockoutError';
		this.entityId = entityId;
		this.personId = personId;
	}
}

export class RoleGrantMissingError extends Error {
	readonly code = ROLE_GRANT_MISSING;
	readonly entityId: string;
	readonly personId: string;
	constructor(entityId: string, personId: string) {
		super(
			`role grant for person ${personId} not found on entity ${entityId} — nothing to remove`
		);
		this.name = 'RoleGrantMissingError';
		this.entityId = entityId;
		this.personId = personId;
	}
}

/** One row per person, owners first: a keyed each on person id throws on a duplicate. */
function toRolePersons(ownOwners: RightsValue[], ownEditors: RightsValue[]): RolePerson[] {
	const byPerson = new Map<string, RolePerson>();

	function fold(v: RightsValue, role: 'owner' | 'editor'): void {
		if (!v.reference) return;
		const existing = byPerson.get(v.reference);
		if (existing) {
			if (role === 'owner') existing.role = 'owner';
			if (existing.name === existing.id && v.string) existing.name = v.string;
			if (!existing.valueIds.includes(v._id)) existing.valueIds.push(v._id);
			return;
		}
		byPerson.set(v.reference, {
			id: v.reference,
			name: v.string ?? v.reference,
			role,
			valueIds: [v._id]
		});
	}

	for (const v of ownOwners) fold(v, 'owner');
	for (const v of ownEditors) fold(v, 'editor');
	return [...byPerson.values()];
}

// The roster name wins: a rights value's `string` is baked at grant time and never refreshes.
function resolveNamesFromRoster(persons: RolePerson[], roster: RosterRow[]): RolePerson[] {
	if (roster.length === 0) return persons;
	const byPersonId = new Map(roster.map((r) => [r.personId, r.name]));
	return persons.map((p) => ({ ...p, name: byPersonId.get(p.id) ?? p.name }));
}

/** Grants _editor, then deletes the person's older own _editor values (POST before DELETE). */
export async function grantRole(
	cfg: EntuCfg,
	entityId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const { ownOwners, ownEditors } = await fetchRights(cfg, entityId, fetchImpl);
	// A replace would delete the folded _id, the ownership itself.
	if (ownOwners.some((v) => v.reference === personId)) return;
	const staleIds = ownEditors.filter((v) => v.reference === personId).map((v) => v._id);

	const postRes = await entuFetch(
		cfg.db,
		`entity/${entityId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_editor', reference: personId }])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`roleManagement: grant POST failed: ${postRes.status}`);

	for (const id of staleIds) {
		const delRes = await entuFetch(cfg.db, `property/${id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`roleManagement: grant cleanup DELETE failed: ${delRes.status}`);
	}
}

/** 'owner+editor' (admins) revokes both pools behind the lockout guard; 'editor-only' does not. */
async function revokeOwnGrant(
	cfg: EntuCfg,
	entityId: string,
	personId: string,
	fetchImpl: typeof fetch,
	scope: 'owner+editor' | 'editor-only'
): Promise<void> {
	const { ownOwners, ownEditors } = await fetchRights(cfg, entityId, fetchImpl);
	const matchingOwner = scope === 'owner+editor' ? ownOwners.filter((v) => v.reference === personId) : [];
	const matchingEditor = ownEditors.filter((v) => v.reference === personId);

	if (matchingOwner.length === 0 && matchingEditor.length === 0) {
		throw new RoleGrantMissingError(entityId, personId);
	}
	if (
		scope === 'owner+editor' &&
		matchingOwner.length > 0 &&
		ownOwners.length - matchingOwner.length === 0
	) {
		throw new RoleLockoutError(entityId, personId);
	}

	const ids = new Set([...matchingOwner, ...matchingEditor].map((v) => v._id));
	for (const id of ids) {
		const res = await entuFetch(cfg.db, `property/${id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!res.ok) throw new Error(`roleManagement: remove DELETE failed: ${res.status}`);
	}
}

export type RoleKind = 'admin' | 'librarian';

/** Own role holders and whether `viewerId` may write rights here, off one rights GET. */
export async function listRoleHolders(
	cfg: EntuCfg,
	entityId: string,
	viewerId: string,
	fetchImpl: typeof fetch = fetch,
	roster: RosterRow[] = []
): Promise<RoleListing> {
	const { ownOwners, ownEditors, allOwners } = await fetchRights(cfg, entityId, fetchImpl);
	return {
		persons: resolveNamesFromRoster(toRolePersons(ownOwners, ownEditors), roster),
		canManage: allOwners.some((v) => v.reference === viewerId)
	};
}

export const listAdmins = listRoleHolders;
export const addAdmin = grantRole;
export const listLibrarians = listRoleHolders;
export const addLibrarian = grantRole;

export async function removeAdmin(
	cfg: EntuCfg,
	dbEntityId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await revokeOwnGrant(cfg, dbEntityId, personId, fetchImpl, 'owner+editor');
}

export async function removeLibrarian(
	cfg: EntuCfg,
	libraryId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await revokeOwnGrant(cfg, libraryId, personId, fetchImpl, 'editor-only');
}

// (*MVOX:Tallis* — #134/S3 RED stubs + contract)
// (*MVOX:Palestrina* — #134/S3 GREEN implementation)
