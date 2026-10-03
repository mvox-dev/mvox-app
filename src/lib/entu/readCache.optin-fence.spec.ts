// The read-cache opt-in fence: shared readers take the flag as an argument, default off.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { authStore } from '$lib/auth/session';
import { CACHED_READ } from './request';
import { flushReadCache, readCacheEntryCount, setReadCacheFactory } from './readCache';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { testCfg } from '$lib/testing/entuFetchKit';

const DB = 'sampledb';
const PERSON = 'person-1';
const CFG = testCfg(DB, 'tok-1');

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
		// Warm the cache first, so the rejection is the default's doing, not an empty cache.
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

	it.each([
		'src/lib/collectives/marker.ts',
		'src/lib/collective/databaseEntity.ts',
		'src/lib/seasons/entuSeasons.ts',
		'src/lib/events/eventDetail.ts',
		'src/lib/profile/profileData.ts',
		'src/lib/roster/rosterData.ts',
		'src/lib/collective/rosterNames.ts',
		'src/lib/library/libraryReads.ts',
		'src/lib/library/libraryAvailability.ts',
		'src/lib/library/librarianStore.ts',
		'src/lib/rsvp/rsvpData.ts',
		'src/lib/repertoire/repertoireData.ts'
	])('%s takes EntuFetchOptions and never hard-wires CACHED_READ', (path) => {
		const source = src(path);
		expect(source).toContain('EntuFetchOptions');
		expect(source).toMatch(/opts: EntuFetchOptions = \{\}/);
		expect(source).not.toMatch(/^\s*CACHED_READ\s*$/m);
		expect(source).not.toMatch(/,\s*CACHED_READ\s*\)/);
	});

	it('listSeasons threads its own opts into the resolveDatabaseEntityId underneath it', () => {
		expect(src('src/lib/seasons/entuSeasons.ts')).toContain(
			'resolveDatabaseEntityId(cfg, fetchImpl, opts)'
		);
	});

	it('the real-names overlay threads its own opts all the way down', () => {
		expect(src('src/lib/collective/rosterNames.ts')).toContain(
			'resolveDatabaseEntityId(cfg, fetchImpl, opts)'
		);
		expect(src('src/lib/roster/rosterData.ts')).toContain(
			'readRosterNamesSetting(cfg, fetchImpl, opts)'
		);
		expect(src('src/lib/roster/rosterData.ts')).toContain(
			'listRecordNamesByPerson(cfg, fetchImpl, opts)'
		);
		expect(src('src/lib/events/eventDetail.ts')).toContain(
			'resolveRealNameByPerson(cfg, fetchImpl, opts)'
		);
	});

	it('the library borrower-name chain threads its own opts all the way down', () => {
		const library = src('src/lib/library/libraryAvailability.ts');
		expect(library).toContain('listMyProfiles(cfg, personId, fetchImpl, opts)');
		expect(library).toContain('resolveRealNameByPerson(cfg, fetchImpl, opts)');
	});

	it('the librarian resolution threads its own opts all the way down', () => {
		const store = src('src/lib/library/librarianStore.ts');
		expect(store).toContain('resolveDatabaseEntityId(cfg, fetchImpl, opts)');
		expect(store).toContain('resolveMyLibraryId(cfg, fetchImpl, dbEntityId, opts)');
	});

	it('the my-loans copy labels thread their own opts all the way down', () => {
		const library = src('src/lib/library/libraryAvailability.ts');
		expect(library).toContain('resolveCopyName(cfg, id, fetchImpl, opts)');
	});

	it('the repertoire resolver threads its own options into both of its reads', () => {
		const rep = src('src/lib/repertoire/repertoireData.ts');
		expect(rep).toMatch(/interface RepertoireReadOptions extends EntuFetchOptions/);
		expect(rep).toContain('listProgramItems(cfg, id, fetchImpl, options)');
		expect(rep).toContain('listRepertoireItems(cfg, seasonId, fetchImpl, options)');
	});

	it('the works join threads its own options into all four of its reads', () => {
		const rows = src('src/lib/repertoire/workRows.ts');
		expect(rows).toContain('options: RepertoireReadOptions = {}');
		expect(rows).toContain('listWorks(cfg, fetchImpl, options)');
		expect(rows).toContain('listAllEditions(cfg, fetchImpl, options)');
		expect(rows).toContain('listAllCopies(cfg, fetchImpl, options)');
		expect(rows).toContain('resolveEventWorksBatch(cfg, eventIds, seasonId, fetchImpl, options)');
		expect(rows).not.toMatch(/^\s*CACHED_READ\s*$/m);
		expect(rows).not.toMatch(/,\s*CACHED_READ\s*\)/);
	});
});

describe('#434 — the CACHED_READ allowlist (structural, not per-endpoint)', () => {
	const ALLOWED = [
		'src/lib/entu/fetchOptions.ts',
		'src/lib/entu/request.ts',
		'src/lib/collectives/discover.ts',
		'src/lib/agenda/agendaData.ts',
		'src/lib/events/eventPageData.ts',
		'src/lib/library/libraryPageData.ts'
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

	function switchesTheCacheOn(source: string): boolean {
		// One statement only, so a comment in a function body never matches; no trailing \b, so
		// CACHED_READ_STORE_ONLY is caught too.
		return /^[ \t]*(?:import|export)\b[^;\n]*\bCACHED_READ/m.test(source);
	}

	it('the fence catches the store-only flag too, not just CACHED_READ', () => {
		expect(switchesTheCacheOn("import { CACHED_READ_STORE_ONLY } from './fetchOptions';")).toBe(
			true
		);
		expect(switchesTheCacheOn("import { CACHED_READ } from './fetchOptions';")).toBe(true);
		expect(switchesTheCacheOn('// NO CACHED_READ_STORE_ONLY here yet, on purpose.')).toBe(false);
	});

	it('only the allowlisted files switch the read cache on', () => {
		const root = resolve(process.cwd());
		const files = collect(SRC)
			.filter((path) => switchesTheCacheOn(readFileSync(path, 'utf-8')))
			.map((path) => path.slice(root.length + 1).split(sep).join('/'))
			.sort();
		expect(files).toEqual(ALLOWED);
	});
});

// (*MVOX:Josquin*)
// (*MVOX:Tallis*)
