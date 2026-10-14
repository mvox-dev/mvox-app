// Can the viewer edit the collective's library entity (_owner or _editor on it)?
import { writable, type Writable } from 'svelte/store';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { EntuFetchOptions } from '$lib/entu/fetchOptions';
import { reportProblem } from '$lib/problems/reportProblem';
import type { EditRightState } from '$lib/nav/dbRights';

export interface LibraryEditRightResult {
	state: EditRightState;
	libraryId: string | null;
}

export const libraryEditRight: Writable<EditRightState> = writable('loading');

export function resetLibraryEditRight(): void {
	libraryEditRight.set('loading');
}

// A non-2xx throws, never null: null means "no library", and /admin would then skip
// refreshRole('librarian') and show a real librarian a library-less collective.
export class LibraryLookupError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'LibraryLookupError';
		this.status = status;
	}
}

export async function resolveMyLibraryId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	dbEntityId?: string,
	opts: EntuFetchOptions = {}
): Promise<string | null> {
	const { entuFetch } = await import('$lib/entu/request');

	let resolvedDbEntityId = dbEntityId;
	if (!resolvedDbEntityId) {
		const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
		const resolved = await resolveDatabaseEntityId(cfg, fetchImpl, opts);
		if (!resolved) return null;
		resolvedDbEntityId = resolved;
	}

	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=library&_parent.reference=${encodeURIComponent(resolvedDbEntityId)}&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) {
		throw new LibraryLookupError(
			`resolveMyLibraryId: library lookup failed: HTTP ${res.status} in db '${cfg.db}'`,
			res.status
		);
	}

	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	return body.entities?.[0]?._id ?? null;
}

export async function resolveLibraryEditRight(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch,
	dbEntityId?: string,
	opts: EntuFetchOptions = {}
): Promise<LibraryEditRightResult> {
	try {
		const libraryId = await resolveMyLibraryId(cfg, fetchImpl, dbEntityId, opts);
		if (!libraryId) return { state: 'not-editor', libraryId: null };

		const { entuFetch } = await import('$lib/entu/request');
		const res = await entuFetch(
			cfg.db,
			`entity/${libraryId}?props=_owner,_editor`,
			cfg.token,
			{},
			fetchImpl,
			opts
		);
		if (!res.ok) {
			reportProblem({ area: 'library', action: 'reading the librarian rights', error: new Error(`HTTP ${res.status}`) });
			return { state: 'error', libraryId: null };
		}

		const body = (await res.json()) as {
			entity?: {
				_owner?: Array<{ reference?: string }>;
				_editor?: Array<{ reference?: string }>;
			};
		};
		const lib = body.entity;
		if (!lib) return { state: 'error', libraryId: null };

		const isOwner = (lib._owner ?? []).some((p) => p.reference === personId);
		const isEditor = (lib._editor ?? []).some((p) => p.reference === personId);
		const state = isOwner || isEditor ? 'editor' : 'not-editor';
		return { state, libraryId };
	} catch (e) {
		reportProblem({ area: 'library', action: 'reading the librarian rights', error: e });
		return { state: 'error', libraryId: null };
	}
}
