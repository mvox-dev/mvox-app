// src/lib/library/librarianStore.ts
import { writable, type Writable } from 'svelte/store';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type LibrarianState = 'loading' | 'librarian' | 'not-librarian' | 'error';

export const librarianStore: Writable<LibrarianState> = writable('loading');

export function resetLibrarian(): void {
	librarianStore.set('loading');
}

// NOTE (module-graph): `$lib/entu/request` pulls in `$lib/entu-config`, which
// statically imports `$env/dynamic/public`. This module is imported by the root
// layout for `librarianStore`/`resetLibrarian` alongside auth/gate wiring — same trap
// documented in `completionGate.ts` (see its module note). Importing `entuFetch`
// LAZILY inside `resolveLibrarian` (not at module top-level) keeps the $env chain out
// of `+layout`'s module-eval time, so specs that render the layout without
// stubbing `$env/dynamic/public` (e.g. happy-dom layout specs) aren't broken by
// wiring this store in.
export async function resolveLibrarian(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<LibrarianState> {
	try {
		const { entuFetch } = await import('$lib/entu/request');
		const res = await entuFetch(
			cfg.db,
			'entity?_type.string=library&props=_owner,_editor&limit=1',
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
		const lib = body.entities?.[0];
		if (!lib) return 'not-librarian';

		const isOwner = (lib._owner ?? []).some((p) => p.reference === personId);
		const isEditor = (lib._editor ?? []).some((p) => p.reference === personId);
		return isOwner || isEditor ? 'librarian' : 'not-librarian';
	} catch {
		return 'error';
	}
}
