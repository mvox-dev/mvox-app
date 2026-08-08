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
// LAZILY inside `resolveAdmin` (not at module top-level) keeps the $env chain out
// of `+layout`'s module-eval time, so specs that render the layout without
// stubbing `$env/dynamic/public` (e.g. happy-dom layout specs) aren't broken by
// wiring this store in.
export async function resolveAdmin(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<AdminState> {
	try {
		const { entuFetch } = await import('$lib/entu/request');
		const res = await entuFetch(
			cfg.db,
			'entity?_type.string=organization&props=_owner,_editor&limit=1',
			cfg.token,
			{},
			fetchImpl
		);
		if (!res.ok) return 'error';

		const body = (await res.json()) as {
			entities?: Array<{
				_id: string;
				_owner?: Array<{ reference?: string }>;
				_editor?: Array<{ reference?: string }>;
			}>;
		};
		const org = body.entities?.[0];
		if (!org) return 'not-admin';

		const isOwner = (org._owner ?? []).some((p) => p.reference === personId);
		const isEditor = (org._editor ?? []).some((p) => p.reference === personId);
		return isOwner || isEditor ? 'admin' : 'not-admin';
	} catch {
		return 'error';
	}
}

// (*MVOX:Palestrina*)
