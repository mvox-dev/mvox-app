// src/lib/nav/adminStore.ts
import { writable, type Writable } from 'svelte/store';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type AdminState = 'loading' | 'admin' | 'not-admin' | 'error';

export const adminStore: Writable<AdminState> = writable('loading');

export function resetAdmin(): void {
	adminStore.set('loading');
}

// NOTE (module-graph): `$lib/entu/request` pulls in `$lib/entu-config`, which
// statically imports `$env/dynamic/public`. This module is imported by the root
// layout for `adminStore`/`resetAdmin` alongside auth/gate wiring — same trap
// documented in `completionGate.ts` (see its module note). Importing `entuFetch`
// (and `$lib/collective/databaseEntity`, which pulls the same chain) LAZILY
// inside `resolveAdmin` (not at module top-level) keeps the $env chain out of
// `+layout`'s module-eval time, so specs that render the layout without
// stubbing `$env/dynamic/public` (e.g. happy-dom layout specs) aren't broken by
// wiring this store in.
//
// #161 (collective = database, Mihkel ruling 2026-08-16) — rights are read off
// THE DATABASE ENTITY, by id: `resolveDatabaseEntityId`
// (`entity?_type.string=database&limit=1`, exactly one per db) replaces the
// retired person -> active member row -> organization `_parent` walk. In a
// single-collective database every member belongs to this database's
// collective, so there is no more per-person org resolution — `personId` is
// still threaded through, but only to match against the database entity's
// `_owner`/`_editor` lists below.
//
// 'error' vs 'not-admin': 'not-admin' is a RIGHTS ANSWER — it is only returned
// when the database entity was actually read and the person is in neither
// list. An unresolvable prerequisite (no visible database entity, HTTP
// failure) is 'error', never a silent "not admin".
//
// #173 — `dbEntityId` (4th param, OPTIONAL) lets a caller that has ALREADY
// resolved the database entity (e.g. admin/+page.svelte, which needs the id
// for its own purposes anyway) thread it straight in, skipping the internal
// `resolveDatabaseEntityId` round-trip. Omitted, behavior is identical to
// before — this function resolves it itself.
// #294 — the shared read: resolveAdmin ("does this person have ANY admin
// rights") and resolveOwnerTier ("is it specifically owner-tier", below) are
// two independent, narrow questions over the SAME `_owner,_editor` fetch —
// one wire call, two callers, never a duplicated GET/parse. Deliberately not
// a general owner/editor capability layer: nothing here returns a role or a
// permission set, only the raw reference lists each caller reduces on its own.
async function readDbRightsLists(
	cfg: EntuCfg,
	fetchImpl: typeof fetch,
	dbEntityId?: string
): Promise<{ owners: string[]; editors: string[] } | 'error'> {
	const { entuFetch } = await import('$lib/entu/request');

	let resolvedDbEntityId = dbEntityId;
	if (!resolvedDbEntityId) {
		const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
		const resolved = await resolveDatabaseEntityId(cfg, fetchImpl);
		// No visible database entity: we cannot evaluate any rights, so we do
		// not pretend to have evaluated any.
		if (!resolved) return 'error';
		resolvedDbEntityId = resolved;
	}

	const res = await entuFetch(
		cfg.db,
		`entity/${resolvedDbEntityId}?props=_owner,_editor`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) return 'error';

	const body = (await res.json()) as {
		entity?: {
			_id?: string;
			_owner?: Array<{ reference?: string }>;
			_editor?: Array<{ reference?: string }>;
		};
	};
	const dbEntity = body.entity;
	if (!dbEntity) return 'error';

	// Rights props live in the PRIVATE bucket: a reader without rights on the
	// database entity sees it but no `_owner`/`_editor` at all. That IS the
	// answer "you are not an admin of this collective" — the entity itself
	// resolved fine.
	return {
		owners: (dbEntity._owner ?? [])
			.map((p) => p.reference)
			.filter((r): r is string => Boolean(r)),
		editors: (dbEntity._editor ?? [])
			.map((p) => p.reference)
			.filter((r): r is string => Boolean(r))
	};
}

export async function resolveAdmin(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch,
	dbEntityId?: string
): Promise<AdminState> {
	try {
		const rights = await readDbRightsLists(cfg, fetchImpl, dbEntityId);
		if (rights === 'error') return 'error';
		const isOwner = rights.owners.includes(personId);
		const isEditor = rights.editors.includes(personId);
		return isOwner || isEditor ? 'admin' : 'not-admin';
	} catch {
		return 'error';
	}
}

export type OwnerTier = 'owner' | 'editor' | 'none' | 'error';

/**
 * #294 — is this caller specifically OWNER-tier on the database entity, or
 * merely editor? Not a general capability layer (one boundary, not a role
 * system — there is a parked roles-versus-rights question this must not
 * pre-empt): the roster's invite/reinvite/withdraw controls are the first
 * place mvox needs this distinction, because the platform itself enforces it
 * on the write these controls perform — the 2026-09-09 admin-cascade probe
 * (`scripts/migrations/probes/probe-294-admin-invite-cascade-2026-09-09.ts`)
 * minted an invite onto another member's person as a db-entity `_owner` (HTTP
 * 200) and was refused as a db-entity `_editor` (HTTP 403, Entu's own text:
 * "User not in _owner property"). `resolveAdmin`'s 'admin'/'not-admin' cannot
 * express this split on its own (it collapses both tiers into 'admin'), so
 * this is a second, independent, equally narrow answer over the same read —
 * never folded into `AdminState`, which forty-plus call sites already treat
 * as a two-value gate.
 *
 * 'none'/'error' mirror `resolveAdmin`'s discipline: 'none' is a RIGHTS
 * ANSWER (the entity was read, the person is in neither list); an
 * unresolvable prerequisite is 'error', never a silent "no rights".
 */
export async function resolveOwnerTier(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch,
	dbEntityId?: string
): Promise<OwnerTier> {
	try {
		const rights = await readDbRightsLists(cfg, fetchImpl, dbEntityId);
		if (rights === 'error') return 'error';
		if (rights.owners.includes(personId)) return 'owner';
		if (rights.editors.includes(personId)) return 'editor';
		return 'none';
	} catch {
		return 'error';
	}
}

// (*MVOX:Palestrina*)
// (*MVOX:Palestrina* — TU.1/#109 review: rights read off the person's OWN org,
//  by id, instead of the `limit=1` umbrella-federation guess)
// (*MVOX:Palestrina* — #161: rights read off the DATABASE entity, collective = database)
// (*MVOX:Palestrina* — #294 GREEN: readDbRightsLists shared helper + resolveOwnerTier)
