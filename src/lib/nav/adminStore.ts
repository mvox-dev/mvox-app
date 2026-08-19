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
export async function resolveAdmin(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<AdminState> {
	try {
		const { entuFetch } = await import('$lib/entu/request');
		const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');

		const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
		// No visible database entity: we cannot evaluate any rights, so we do not
		// pretend to have evaluated any.
		if (!dbEntityId) return 'error';

		const res = await entuFetch(
			cfg.db,
			`entity/${dbEntityId}?props=_owner,_editor`,
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
		const isOwner = (dbEntity._owner ?? []).some((p) => p.reference === personId);
		const isEditor = (dbEntity._editor ?? []).some((p) => p.reference === personId);
		return isOwner || isEditor ? 'admin' : 'not-admin';
	} catch {
		return 'error';
	}
}

// (*MVOX:Palestrina*)
// (*MVOX:Palestrina* — TU.1/#109 review: rights read off the person's OWN org,
//  by id, instead of the `limit=1` umbrella-federation guess)
// (*MVOX:Palestrina* — #161: rights read off the DATABASE entity, collective = database)
