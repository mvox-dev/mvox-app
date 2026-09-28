// #434 slice 2/6 review round, finding 2 — the OPT-IN FENCE.
//
// readCache.ts's header states the law: "OPT IN, NEVER BLANKET ... a reader
// gets the flag in the same slice that ships its screen's 'as of <time>' line.
// A flag on a reader whose screen has no age line yet is a stored copy painted
// as if it were live." The first cut of slice 2 broke it by hard-wiring
// CACHED_READ INSIDE three SHARED readers — `checkCollectiveMarker`,
// `resolveDatabaseEntityId`, `listSeasons`/`listEvents` — which is a blanket by
// another route: `resolveDatabaseEntityId` alone has FIFTEEN call sites, EIGHT
// of them a GET that is a STEP INSIDE A WRITE (season/event/series create,
// sectionActions, linkActions, inviteData — each resolves the id and then POSTs
// it as `_parent`), and `listSeasons` also serves /library, whose own age line
// is slice 3's.
//
// So the flag is an ARGUMENT, defaulting to off, and this file is the fence
// around where it may be switched on. Two halves:
//   (1) BEHAVIOUR — the default really is uncached: a `resolveDatabaseEntityId`
//       called the way every write path calls it stores nothing and, offline,
//       rejects; the same call with CACHED_READ stores and serves.
//   (2) STRUCTURE — an ALLOWLIST of the files that may name CACHED_READ at all,
//       the same shape swPolicy.ts's fence takes ("deliberately structural, not
//       a per-endpoint blacklist, so it cannot erode one route at a time
//       later"). Slices 3-6 add their own screens' readers here ON PURPOSE,
//       as a visible line in a diff, not by a flag drifting into a shared
//       module.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { authStore } from '$lib/auth/session';
import { CACHED_READ } from './request';
import { flushReadCache, readCacheEntryCount, setReadCacheFactory } from './readCache';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';

const DB = 'sampledb';
const PERSON = 'person-1';
const CFG = { db: DB, token: 'tok-1' };

function online() {
	return vi.fn(async () =>
		new Response(JSON.stringify({ count: 1, entities: [{ _id: 'db-entity-1' }] }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		})
	);
}

function offline() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

beforeEach(() => {
	setReadCacheFactory(new IDBFactory());
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: Date.now() + 3_600_000
	});
});

afterEach(() => {
	setReadCacheFactory(undefined);
	authStore.set({ status: 'anonymous' });
});

describe('#434 — a write-path resolveDatabaseEntityId is NOT cache-backed', () => {
	it('the default call (what every resolve-then-POST site makes) stores nothing', async () => {
		expect(await resolveDatabaseEntityId(CFG, online())).toBe('db-entity-1');
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('the default call REJECTS offline — a stale _parent id is never fed into a write', async () => {
		// Warm the cache the way the AGENDA's path does, so there IS a stored
		// answer for this exact key: the rejection below is then the default's
		// own doing, not an empty cache.
		expect(await resolveDatabaseEntityId(CFG, online(), CACHED_READ)).toBe('db-entity-1');
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(1);

		await expect(resolveDatabaseEntityId(CFG, offline())).rejects.toThrow('Failed to fetch');
	});

	it('the same call WITH CACHED_READ is served from the cache offline — the agenda path still works', async () => {
		expect(await resolveDatabaseEntityId(CFG, online(), CACHED_READ)).toBe('db-entity-1');
		await flushReadCache();
		expect(await resolveDatabaseEntityId(CFG, offline(), CACHED_READ)).toBe('db-entity-1');
	});
});

describe('#434 — the shared readers hard-wire no flag', () => {
	const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

	// Each of these is called from screens that have no "as of <time>" line
	// (and, for resolveDatabaseEntityId, from eight write paths). They must
	// take the flag as an argument and never name it.
	it.each([
		'src/lib/collectives/marker.ts',
		'src/lib/collective/databaseEntity.ts',
		'src/lib/seasons/entuSeasons.ts',
		// Slice 3: the event page's reader and the profile read under its
		// conductor line — both shared (post-write refresh, profile page).
		'src/lib/events/eventDetail.ts',
		'src/lib/profile/profileData.ts'
	])('%s takes EntuFetchOptions and never hard-wires CACHED_READ', (path) => {
		const source = src(path);
		expect(source).toContain('EntuFetchOptions');
		expect(source).toMatch(/opts: EntuFetchOptions = \{\}/);
		// The name may appear in prose; never as an argument.
		expect(source).not.toMatch(/^\s*CACHED_READ\s*$/m);
		expect(source).not.toMatch(/,\s*CACHED_READ\s*\)/);
	});

	it('listSeasons threads its own opts into the resolveDatabaseEntityId underneath it', () => {
		// The season query is useless offline without the `_parent` id it filters
		// on, so the agenda's flag has to reach BOTH reads — but only via the
		// argument, which is what makes the write paths' default hold.
		expect(src('src/lib/seasons/entuSeasons.ts')).toContain(
			'resolveDatabaseEntityId(cfg, fetchImpl, opts)'
		);
	});
});

describe('#434 — the CACHED_READ allowlist (structural, not per-endpoint)', () => {
	/** Every non-spec file under src/ that names CACHED_READ in an import or
	 *  export — i.e. every file that can actually pass the flag. */
	const ALLOWED = [
		// The definition itself, and request.ts's re-export of it.
		'src/lib/entu/fetchOptions.ts',
		'src/lib/entu/request.ts',
		// Slice 2: collective discovery — the app's ONE identity read.
		'src/lib/collectives/discover.ts',
		// Slice 2: the agenda's own entry point, the screen with the age line.
		'src/lib/agenda/agendaData.ts',
		// Slice 3: the event page's own entry points — the mounted screen's
		// cache-backed load AND the store-only twin the agenda's next-event
		// prefetch and the page's post-write refresh use (slice 3 review round,
		// findings 1 and 2).
		'src/lib/events/eventPageData.ts'
	].sort();

	const SRC = resolve(process.cwd(), 'src');

	function collect(dir: string, out: string[] = []): string[] {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) {
				if (entry === 'paraglide') continue; // generated
				collect(path, out);
			} else if (
				(path.endsWith('.ts') || path.endsWith('.svelte')) &&
				!path.endsWith('.spec.ts')
			) {
				out.push(path);
			}
		}
		return out;
	}

	/** Names ANY of the flags in an `import`/`export` statement — the only way a
	 *  file can hold the binding and pass it to `entuFetch`. */
	function switchesTheCacheOn(source: string): boolean {
		// ONE line: `[^;\n]*` must not run past the end of the statement, or an
		// `export function ...` header would reach a CACHED_READ mentioned in a
		// comment inside its body (libraryData.ts's "NO CACHED_READ here yet").
		//
		// No trailing `\b` (slice 3 review round): `_` is a word character, so
		// `\bCACHED_READ\b` does NOT match `CACHED_READ_STORE_ONLY` — the fence
		// would have let the store-only flag, and any later variant, spread
		// unwatched. Storing without serving is a lesser claim than serving, but
		// not a free one: a stored body is still a body a SERVING reader of the
		// same key can hand back later (a signed `property/{id}` url, a stale
		// `_id` a write is about to target), and it still spends the shared byte
		// budget. Same fence, both flags.
		return /^[ \t]*(?:import|export)\b[^;\n]*\bCACHED_READ/m.test(source);
	}

	it('the fence catches the store-only flag too, not just CACHED_READ', () => {
		expect(switchesTheCacheOn("import { CACHED_READ_STORE_ONLY } from './fetchOptions';")).toBe(
			true
		);
		expect(switchesTheCacheOn("import { CACHED_READ } from './fetchOptions';")).toBe(true);
		// Prose is still not an opt-in.
		expect(switchesTheCacheOn('// NO CACHED_READ_STORE_ONLY here yet, on purpose.')).toBe(false);
	});

	it('only the allowlisted files switch the read cache on', () => {
		// Prose-only mentions (libraryData.ts saying why it stays OFF, and the
		// three shared readers' own doc comments) are not an opt-in: the fence is
		// over the BINDING, which is what a call site needs to pass it.
		const root = resolve(process.cwd());
		const files = collect(SRC)
			.filter((path) => switchesTheCacheOn(readFileSync(path, 'utf-8')))
			.map((path) => path.slice(root.length + 1).split(sep).join('/'))
			.sort();
		expect(files).toEqual(ALLOWED);
	});
});

// (*MVOX:Josquin* — #434 slice 2 review round, finding 2)
// (*MVOX:Tallis* — #434 slice 3 RED: event page entries)
