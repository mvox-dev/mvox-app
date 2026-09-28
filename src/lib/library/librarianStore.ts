// src/lib/library/librarianStore.ts
import { writable, type Writable } from 'svelte/store';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
// TYPE-ONLY (module-graph note below): `$lib/entu/fetchOptions` is the
// dependency-free sibling of `$lib/entu/request`, and this import is erased at
// build time regardless — naming the options type here costs the root layout
// nothing.
import type { EntuFetchOptions } from '$lib/entu/fetchOptions';

export type LibrarianState = 'loading' | 'librarian' | 'not-librarian' | 'error';

export interface LibrarianResult {
	state: LibrarianState;
	libraryId: string | null;
}

export const librarianStore: Writable<LibrarianState> = writable('loading');

// #434 slice 4 review round 2, finding 2 — `libraryEntityIdStore` is GONE. It
// held the library id `resolveLibrarian` answered, and its only readers were
// /library's three write paths, which passed it as the `_parent` of a lending
// or work CREATE. Once review round 1 made that resolution cache-backed
// (`libraryPageData.loadLibrarianState`), the store could hand a stored id to a
// live POST — the "GET that is a STEP INSIDE a write" readCache.ts forbids the
// flag on. The write paths now resolve their parent live
// (`libraryPageData.resolveWriteLibraryId`), which left nothing reading the
// store: `state: 'librarian'` already implies a library was found (a null id is
// `not-librarian`), and /admin keeps its own local `libraryId` off
// `LibrarianResult`. A store only ever written to is state that cannot be
// wrong and cannot be right.
export function resetLibrarian(): void {
	librarianStore.set('loading');
}

// NOTE (module-graph): `$lib/entu/request` pulls in `$lib/entu-config`, which
// statically imports `$env/dynamic/public`. This module is imported by the root
// layout for `librarianStore`/`resetLibrarian` alongside auth/gate wiring — same trap
// documented in `completionGate.ts` (see its module note). Importing `entuFetch`
// (and `$lib/collective/databaseEntity`, which pulls the same chain) LAZILY
// inside `resolveLibrarian` / `resolveMyLibraryId` (not at module top-level)
// keeps the $env chain out of `+layout`'s module-eval time, so specs that
// render the layout without stubbing `$env/dynamic/public` (e.g. happy-dom
// layout specs) aren't broken by wiring this store in.
//
// #161 (collective = database, Mihkel ruling 2026-08-16) — the library entity
// is scoped to the DATABASE entity, never a `limit=1` global query. The
// retired person -> active member row -> organization `_parent` walk is gone;
// `resolveDatabaseEntityId` (`entity?_type.string=database&limit=1`, exactly
// one per db) supplies the scope, and the library is looked up under that id.
//
// #143 review F4 — THROWS on a non-2xx library list, never `null`. `null` is
// reserved for the one FACTUAL emptiness this function can assert ("no library
// entity is parented under the database entity"), and `resolveLibrarian` maps
// that to `not-librarian`. A transient 500 answered with `null` would have been
// indistinguishable from that fact, so `admin/+page.svelte`'s `state ===
// 'error'` branch (which exists precisely to keep a failed read from rendering
// as "this collective has no library") could never fire for it: the page would
// reach `status = 'ready'`, skip `refreshLibrarians`, and show a real librarian
// a library-less collective with no error and no retry. `resolveDatabaseEntityId`
// already throws (`DatabaseEntityLookupError`) on the same failure kind one
// call up; matching it keeps the whole resolution fail-loud (house rule) and
// keeps `resolveLibrarian` on the pre-branch contract of `{ state: 'error' }`
// for any non-2xx.
export class LibraryLookupError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'LibraryLookupError';
		this.status = status;
	}
}

// #161 review fix round 2 — `personId` is GONE from this signature. Once the
// person -> member -> organization walk was replaced by `resolveDatabaseEntityId`,
// the whole lookup became db-scoped and nothing in the body read the person. A
// dead param in position 2 of 3 is worse than noise: a caller that correctly
// drops it slides `fetchImpl` into the `personId` slot and silently falls back
// to the global `fetch`. `resolveLibrarian` still takes `personId` — it needs it
// for the `_owner`/`_editor` membership test — and no longer forwards it here.
// #173 — `dbEntityId` (3rd param, OPTIONAL) lets a caller that has ALREADY
// resolved the database entity thread it straight in, skipping the internal
// `resolveDatabaseEntityId` round-trip. Omitted, behavior is identical to
// before — this function resolves it itself.
// #434 slice 4 review round, finding 1 — `opts` (trailing, DEFAULT OFF) is the
// read-cache flag, threaded into BOTH reads under here (the database entity and
// the library list). This is a SHARED reader — /roster's lending-eligibility
// chain and /admin's librarian panel call it too — so it hard-wires nothing;
// the library page switches the flag on from `libraryPageData.ts`
// (readCache.optin-fence.spec.ts).
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
		// No visible database entity: there is no collective to scope the
		// library lookup to, so no library can be resolved.
		if (!resolved) return null;
		resolvedDbEntityId = resolved;
	}

	// #321 class (1) — exactly one `library` is parented under the collective's
	// database entity. The invariant is a seed/design one, not an Entu
	// constraint: the librarian-seed strategy creates ONE library per collective
	// and is idempotent on `_type.string=library&_parent.reference=<collective>`
	// (entu/research `docs/migration/findings/2026-05-23-librarian-seed-strategy.md`
	// 3.3; the /library design spec states the same as "Expect 0 or 1 hits (one
	// library per org)" — db-scoped since #161 made the database entity the
	// collective). Nothing in `src/` creates a `library`: `entityCreate` only
	// ever writes work/edition/copy/lending UNDER an already-resolved library id.
	// So `limit=1` is an explicit, ample bound — a second row would be damaged
	// data, not a truncation this read could observe — and the `entities?.[0]`
	// pick below cannot be a silent prefix of a longer list.
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

// #173 — `dbEntityId` (4th param, OPTIONAL) forwards straight to
// `resolveMyLibraryId`; see its header for the round-trip-skipping contract.
// #434 slice 4 review round, finding 1 — `opts` (trailing, DEFAULT OFF) reaches
// all THREE reads this resolution makes (database entity, library list, the
// library's `_owner`/`_editor`). It has to reach all three: this function maps
// ANY throw to `{ state: 'error' }`, so one un-threaded link offline is the
// library page showing a red "librarian state could not be loaded" alert beside
// a listing that restored perfectly. Shared reader — no flag is named here.
export async function resolveLibrarian(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch,
	dbEntityId?: string,
	opts: EntuFetchOptions = {}
): Promise<LibrarianResult> {
	try {
		const libraryId = await resolveMyLibraryId(cfg, fetchImpl, dbEntityId, opts);
		// #143 review F4 — `null` here is now ONLY the factual "no library entity
		// is visible under the collective's database entity" (no database entity,
		// or an empty library list). Every failure kind (database-entity lookup,
		// library list) throws and lands in the catch below as `state: 'error'`.
		if (!libraryId) return { state: 'not-librarian', libraryId: null };

		const { entuFetch } = await import('$lib/entu/request');
		const res = await entuFetch(
			cfg.db,
			`entity/${libraryId}?props=_owner,_editor`,
			cfg.token,
			{},
			fetchImpl,
			opts
		);
		if (!res.ok) return { state: 'error', libraryId: null };

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
		const state = isOwner || isEditor ? 'librarian' : 'not-librarian';
		return { state, libraryId };
	} catch {
		return { state: 'error', libraryId: null };
	}
}
