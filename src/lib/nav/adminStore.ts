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
// (and `$lib/org/myOrg`, which pulls the same chain) LAZILY inside `resolveAdmin`
// (not at module top-level) keeps the $env chain out of `+layout`'s module-eval
// time, so specs that render the layout without stubbing `$env/dynamic/public`
// (e.g. happy-dom layout specs) aren't broken by wiring this store in.
//
// TU.1/#109 review — rights are read off THE PERSON'S OWN collective org, by id.
// This used to be `entity?_type.string=organization&props=_owner,_editor&limit=1`
// + `entities[0]`, which live-verifiably evaluates rights on the UMBRELLA
// FEDERATION: all six polyphony org entities are `_sharing: domain`, so every
// authenticated session reads all six and `limit=1` answers "Eesti Kammerkooride
// Liit" first (probe-67, count: 6). An EFK `_owner`/`_editor` with no rights on
// the umbrella lost the admin nav and /admin/invite; an umbrella rights-holder
// was shown 'admin' for a collective she does not administer. The org now comes
// from `resolveMyOrgId` (the person's own member `_parent`) and rights are read
// off THAT entity by id.
//
// 'error' vs 'not-admin': 'not-admin' is a RIGHTS ANSWER — it is only returned
// when the org was actually read and the person is in neither list. An
// unresolvable prerequisite (no visible membership, ambiguous membership, HTTP
// failure, org not readable by id) is 'error', never a silent "not admin".
export async function resolveAdmin(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<AdminState> {
	try {
		const { entuFetch } = await import('$lib/entu/request');
		const { resolveMyOrgId } = await import('$lib/org/myOrg');

		const orgId = await resolveMyOrgId(cfg, personId, fetchImpl);
		// No visible collective membership for this person: we cannot evaluate any
		// org's rights, so we do not pretend to have evaluated one.
		if (!orgId) return 'error';

		const res = await entuFetch(
			cfg.db,
			`entity/${orgId}?props=_owner,_editor`,
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
		const org = body.entity;
		if (!org) return 'error';

		// Rights props live in the PRIVATE bucket: a reader without rights on the
		// org sees the entity but no `_owner`/`_editor` at all. That IS the answer
		// "you are not an admin of this org" — the org itself resolved fine.
		const isOwner = (org._owner ?? []).some((p) => p.reference === personId);
		const isEditor = (org._editor ?? []).some((p) => p.reference === personId);
		return isOwner || isEditor ? 'admin' : 'not-admin';
	} catch {
		return 'error';
	}
}

// (*MVOX:Palestrina*)
// (*MVOX:Palestrina* — TU.1/#109 review: rights read off the person's OWN org,
//  by id, instead of the `limit=1` umbrella-federation guess)
