// src/lib/admin/roleManagement.ts
//
// #134/S3 GREEN (ROLLUP REVISION) — the role-management read/write layer for
// the /admin surface, built on Entu's REAL aggregated-rights wire shape.
// The authoritative contract lives in roleManagement.spec.ts (unit) and
// src/routes/page.admin.spec.ts (route integration).
//
// `GET entity/{id}?props=_owner,_editor` answers a ROLLUP —
//
//   1. THE FOLD: every `_owner` value ALSO appears in `_editor` under the SAME
//      `_id` (ownership implies editorship; the read materialises it).
//   2. THE SPLICE: rights inherited from the PARENT entity (org → library via
//      the inherit-rights link; umbrella → org) are spliced into both arrays
//      with `inherited: true`; their `_id`s are the PARENT's property values —
//      deleting one from here would revoke rights on the parent entity.
//
// `fetchRights` is the single place that un-folds and filters the rollup;
// every other function builds on it, never reads the wire shape directly.

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { RosterRow } from '$lib/roster/rosterData';

export interface RolePerson {
	/** person entity id (the rights value's `reference`). */
	id: string;
	/** display name off the rights value's own `string`; falls back to `id`. */
	name: string;
	/** 'owner' outranks 'editor'; a person in both lists reports 'owner'. */
	role: 'owner' | 'editor';
	/**
	 * EVERY own rights property VALUE id backing this row — a person can hold an
	 * `_owner` value AND one or more separate `_editor` values on the same
	 * entity, and this row folds them ALL into one entry (one row per PERSON, so
	 * a keyed `{#each}` on `id` can never see a duplicate key). Matches
	 * `removeAdmin`, which deletes every own value the person holds.
	 */
	valueIds: string[];
}

/** One rights property value as the aggregated read answers it. */
export interface RightsValue {
	/** property value id — for OWN values, deletable via `DELETE property/{_id}`. */
	_id: string;
	/** person entity id. */
	reference?: string;
	/** display name of the referenced person. */
	string?: string;
	/**
	 * The TYPE of the referenced entity (e.g. 'person', 'database'). Entu's
	 * aggregated read can answer a rights value referencing a NON-person entity
	 * — the database entity's own `_owner` carries a self-reference
	 * (`entity_type: 'database'`, reference = its own `_id`) from bootstrap.
	 * Absent on older wire reads — fail-open (treated as a person) rather than
	 * dropping rows the reader has no type information for.
	 */
	entity_type?: string;
	/** present (true) on entries SPLICED IN from the parent entity's rights. */
	inherited?: boolean;
}

/** The entity's OWN rights, un-folded and with inherited entries dropped. */
export interface OwnRights {
	ownOwners: RightsValue[];
	ownEditors: RightsValue[];
	/**
	 * EVERY `_owner` value the rollup answers — own AND inherited. This is the
	 * "may I WRITE rights props here?" set, and it is deliberately NOT the
	 * listing set: entu-api requires the caller to sit in the entity's
	 * AGGREGATED `private._owner` before it accepts any rights write (POST
	 * `entity/{id}` and DELETE `property/{id}` alike), and that aggregate
	 * INCLUDES inherited owners. `ownOwners`/`ownEditors` stay own-only because
	 * listing/deleting a parent's property value is never this surface's to do.
	 */
	allOwners: RightsValue[];
}

/** One managed rights list plus whether the VIEWER may write to it. */
export interface RoleListing {
	persons: RolePerson[];
	/**
	 * The viewer holds an `_owner` value (own or inherited) on the entity, so
	 * entu-api will accept her rights writes. Fail-closed: rights props absent
	 * from the read (the private bucket is invisible to her) ⇒ false.
	 */
	canManage: boolean;
}

/**
 * GET `entity/{id}?props=_owner,_editor` and normalise Entu's aggregated
 * ROLLUP: (1) drop every `inherited: true` entry (they are property values of
 * the PARENT entity — not this entity's to list or delete), (2) un-fold —
 * `_owner` values are duplicated into `_editor` under the SAME `_id`, so
 * `ownEditors` excludes any `_id` present in `ownOwners`. `allOwners` keeps the
 * raw (inherited-inclusive) owner list for the write-permission question.
 */
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
	// #161 review fix — a rights value referencing a NON-person entity (the
	// database entity's own self-reference `_owner`) is never a manageable
	// admin/librarian row and never counts toward the lockout guard. Fail-open
	// on absence: a value with no `entity_type` at all (older wire reads) keeps
	// counting as a person; filter only on a KNOWN non-person type.
	const isPersonValue = (v: RightsValue): boolean =>
		v.entity_type === undefined || v.entity_type === 'person';

	const owner = (body.entity?._owner ?? []).filter(isPersonValue);
	const editor = (body.entity?._editor ?? []).filter(isPersonValue);

	const ownOwners = owner.filter((v) => !v.inherited);
	const ownOwnerIds = new Set(ownOwners.map((v) => v._id));
	const ownEditors = editor.filter((v) => !v.inherited && !ownOwnerIds.has(v._id));

	return { ownOwners, ownEditors, allOwners: owner };
}

export const ROLE_LOCKOUT = 'role-lockout' as const;
export const ROLE_GRANT_MISSING = 'role-grant-missing' as const;

/** Refusal to remove the LAST `_owner` of the organization (lockout prevention). */
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

/** The person holds no matching rights value on the entity — nothing to remove. */
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

/**
 * Owners first, then editors — ONE ROW PER PERSON.
 *
 * `fetchRights` un-folds by `_id`, which is correct for the wire shape but does
 * NOT collapse a person who holds an `_owner` value AND a SEPARATE own `_editor`
 * value on the same entity (two distinct `_id`s — entu-api's aggregation dedupes
 * `_editor` by `reference + inherited`, so exactly one such editor entry
 * survives alongside the owner value). Emitting a row per VALUE would put two
 * rows with the same person id into a `{#each … (person.id)}`, and Svelte 5
 * throws `each_key_duplicate` in production as well as dev — the whole page
 * dies. So the fold happens HERE, by person: 'owner' outranks 'editor' (the
 * documented `RolePerson.role` contract) and every backing value id is carried
 * along in `valueIds`.
 */
function toRolePersons(ownOwners: RightsValue[], ownEditors: RightsValue[]): RolePerson[] {
	const byPerson = new Map<string, RolePerson>();

	function fold(v: RightsValue, role: 'owner' | 'editor'): void {
		if (!v.reference) return;
		const existing = byPerson.get(v.reference);
		if (existing) {
			// 'owner' wins; a name already resolved from a value's `string` wins
			// over a later value that only carries the reference id.
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

	// Owners first so the Map's insertion order lists them ahead of editors.
	for (const v of ownOwners) fold(v, 'owner');
	for (const v of ownEditors) fold(v, 'editor');
	return [...byPerson.values()];
}

/**
 * #146 — a freshly POSTed `_editor`/`_owner` value carries only `reference`
 * (the person entity id), never `string` (display name): Entu's aggregated
 * read only backfills `string` once its own indexing catches up, so
 * `toRolePersons`' fallback (`name: v.reference`) shows the raw entity id
 * until then. The roster (already loaded for the person-picker native
 * <select>, #209) is a ready-made id→name lookup — every row whose `name`
 * still equals its
 * `id` (i.e. never resolved a display name off the rights value itself) gets
 * a second chance against it. A person absent from the roster (e.g. no
 * longer an active member) keeps the id fallback — never a blank row.
 */
function resolveNamesFromRoster(persons: RolePerson[], roster: RosterRow[]): RolePerson[] {
	if (roster.length === 0) return persons;
	const byPersonId = new Map(roster.map((r) => [r.personId, r.name]));
	return persons.map((p) => {
		if (p.name !== p.id) return p;
		const rosterName = byPersonId.get(p.id);
		return rosterName ? { ...p, name: rosterName } : p;
	});
}

/**
 * Grant `_editor` to `personId` on `entityId`.
 * GET rights → NO-OP when the person already holds an OWN `_owner` value (a
 * naive "replace" would DELETE the folded `_id` — i.e. the ownership itself)
 * → POST `[{ type: '_editor', reference: personId }]` → DELETE the person's
 * pre-existing OWN `_editor` value ids (replace semantics — Entu POST
 * APPENDS; POST-BEFORE-DELETE house rule). Inherited entries are never
 * "stale dupes" — never deleted.
 */
async function grantEditor(
	cfg: EntuCfg,
	entityId: string,
	personId: string,
	fetchImpl: typeof fetch
): Promise<void> {
	const { ownOwners, ownEditors } = await fetchRights(cfg, entityId, fetchImpl);
	// Owner already outranks the grant being added — nothing to write.
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

/**
 * Revoke the person's OWN rights values on `entityId`, deduped by `_id`.
 * `ownersScope` selects which own-value pool counts toward the lockout guard
 * and gets deleted: `'owner+editor'` (org admins — both pools are revocable
 * and the lockout guard applies) or `'editor-only'` (library librarians — only
 * the editor pool is this surface's to revoke; no lockout guard).
 */
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
		// Lockout guard runs BEFORE any write: removing every own _owner value
		// belonging to this person must not leave the entity with zero owners.
		throw new RoleLockoutError(entityId, personId);
	}

	const ids = new Set([...matchingOwner, ...matchingEditor].map((v) => v._id));
	for (const id of ids) {
		const res = await entuFetch(cfg.db, `property/${id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!res.ok) throw new Error(`roleManagement: remove DELETE failed: ${res.status}`);
	}
}

/**
 * The org's own admins PLUS whether `viewerId` may write rights here. Both come
 * off the SAME rights GET — the write-permission answer rides on the list read,
 * no extra round-trip (house rights-gating pattern).
 */
export async function listAdmins(
	cfg: EntuCfg,
	dbEntityId: string,
	viewerId: string,
	fetchImpl: typeof fetch = fetch,
	roster: RosterRow[] = []
): Promise<RoleListing> {
	const { ownOwners, ownEditors, allOwners } = await fetchRights(cfg, dbEntityId, fetchImpl);
	return {
		persons: resolveNamesFromRoster(toRolePersons(ownOwners, ownEditors), roster),
		canManage: allOwners.some((v) => v.reference === viewerId)
	};
}

export async function addAdmin(
	cfg: EntuCfg,
	dbEntityId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await grantEditor(cfg, dbEntityId, personId, fetchImpl);
}

export async function removeAdmin(
	cfg: EntuCfg,
	dbEntityId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await revokeOwnGrant(cfg, dbEntityId, personId, fetchImpl, 'owner+editor');
}

/**
 * The library's own librarians PLUS whether `viewerId` may write rights here.
 * An org owner arrives in the library's rollup as an INHERITED `_owner` (via the
 * inherit-rights link) — she is not listed as a librarian, but entu-api DOES
 * accept her writes, so `canManage` reads the inherited-inclusive owner set.
 */
export async function listLibrarians(
	cfg: EntuCfg,
	libraryId: string,
	viewerId: string,
	fetchImpl: typeof fetch = fetch,
	roster: RosterRow[] = []
): Promise<RoleListing> {
	const { ownOwners, ownEditors, allOwners } = await fetchRights(cfg, libraryId, fetchImpl);
	return {
		persons: resolveNamesFromRoster(toRolePersons(ownOwners, ownEditors), roster),
		canManage: allOwners.some((v) => v.reference === viewerId)
	};
}

export async function addLibrarian(
	cfg: EntuCfg,
	libraryId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await grantEditor(cfg, libraryId, personId, fetchImpl);
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
