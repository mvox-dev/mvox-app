// Is the signed-in person an admin of the selected collective, and at which tier?
import { writable, type Writable } from 'svelte/store';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { reportProblem } from '$lib/problems/reportProblem';

export type AdminState = 'loading' | 'admin' | 'not-admin' | 'error';

export const adminStore: Writable<AdminState> = writable('loading');

export function resetAdmin(): void {
	adminStore.set('loading');
}

// entuFetch loads lazily to keep its $env chain out of the root layout's module eval.
// Rights are read off the database entity (#161); 'not-admin' comes only from a real read,
// and an unreadable prerequisite is 'error', never a silent "not admin".
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

	// No `_owner`/`_editor` visible is itself the answer: rights live in the private bucket.
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
	} catch (e) {
		reportProblem({ area: 'admin', action: 'reading the admin rights', error: e });
		return 'error';
	}
}

export type OwnerTier = 'owner' | 'editor' | 'none' | 'error';

// Owner, not just admin: an invite onto another person needs db-entity `_owner` (#294).
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
	} catch (e) {
		reportProblem({ area: 'admin', action: 'reading the owner tier', error: e });
		return 'error';
	}
}

// (*MVOX:Palestrina*)
