// #434 slice 4/6 RED — the library's data entry points, and the defaults of the
// shared readers under them.
//
// CONTRACT (see src/routes/library/page.offline.spec.ts's header for the whole
// slice):
//   - libraryData's listWorks / listLendings / listEditions / listCopies /
//     resolveBorrowerNames stay SHARED, so their DEFAULT is uncached: nothing
//     stored, and offline a rejection even when a stored copy of the same key
//     exists.
//   - loadLibraryListing(cfg, fetchImpl) -> { works, lendings, borrowerNames },
//     loadLibraryEditions(cfg, workId, fetchImpl), loadLibraryCopies(cfg,
//     editionId, fetchImpl) — CACHED_READ: stored online, served offline with
//     the SAME result, the served copy's readAt on `servedFromCache`.
//   - refreshLibraryLendings(cfg, fetchImpl) -> { lendings, borrowerNames } —
//     CACHED_READ_STORE_ONLY: online it stores exactly what the listing's
//     lending read stores (so a later offline listing shows the post-write
//     availability); offline it REJECTS and never touches `servedFromCache`.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { authStore } from '$lib/auth/session';
import {
	flushReadCache,
	readCacheEntryCount,
	resetServedFromCache,
	servedFromCache,
	setReadCacheFactory
} from '$lib/entu/readCache';
import { listWorks, listLendings } from './libraryData';
import {
	loadLibraryListing,
	loadLibraryEditions,
	loadLibraryCopies,
	refreshLibraryLendings
} from './libraryPageData';

const DB = 'sampledb';
const PERSON = 'person-1';
const CFG = { db: DB, token: 'tok-1' };

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

interface LendingRow {
	id: string;
	copy: string;
	member: string;
	returnedAt?: string;
}

/** An online Entu whose lending log is `lendings` (changed between calls to
 *  model a write landing). The borrower m-2 -> p-2 is named "Liisa Laulja". */
function online(lendings: LendingRow[]) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=work&')) {
			return json({
				count: 1,
				entities: [{ _id: 'w-1', name: [{ string: 'Messa di Gloria' }], composer: [{ string: 'Puccini' }] }]
			});
		}
		if (url.includes('_type.string=lending&')) {
			return json({
				count: lendings.length,
				entities: lendings.map((l) => ({
					_id: l.id,
					copy: [{ reference: l.copy }],
					member: [{ reference: l.member }],
					assigned_at: [{ date: '2026-09-01' }],
					...(l.returnedAt ? { returned_at: [{ date: l.returnedAt }] } : {})
				}))
			});
		}
		if (url.includes('entity/m-2?props=person')) {
			return json({ entity: { _id: 'm-2', person: [{ reference: 'p-2' }] } });
		}
		if (url.includes('_type.string=profile') && url.includes('_parent.reference=p-2')) {
			return json({
				count: 1,
				entities: [{ _id: 'prof-2', name: [{ string: 'Liisa Laulja' }], _sharing: [{ string: 'domain' }] }]
			});
		}
		if (url.includes('_type.string=edition&') && url.includes('_parent.reference=w-1')) {
			return json({ count: 1, entities: [{ _id: 'e-1', name: [{ string: 'Carus 2019' }] }] });
		}
		if (url.includes('_type.string=copy&') && url.includes('_parent.reference=e-1')) {
			return json({ count: 1, entities: [{ _id: 'c-1', copy_number: [{ number: 3 }] }] });
		}
		return json({ count: 0, entities: [] });
	});
}

function offline() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

const LENT: LendingRow[] = [{ id: 'l-1', copy: 'c-1', member: 'm-2' }];
const RETURNED: LendingRow[] = [{ id: 'l-1', copy: 'c-1', member: 'm-2', returnedAt: '2026-09-28' }];

beforeEach(() => {
	setReadCacheFactory(new IDBFactory());
	resetServedFromCache();
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: Date.now() + 3_600_000
	});
});

afterEach(() => {
	setReadCacheFactory(undefined);
	resetServedFromCache();
	authStore.set({ status: 'anonymous' });
});

describe('#434 slice 4 — the shared library readers stay uncached by default', () => {
	it('listWorks / listLendings called the default way store nothing', async () => {
		await listWorks(CFG, online(LENT));
		await listLendings(CFG, online(LENT));
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('the default listLendings REJECTS offline even with a stored copy of the same key', async () => {
		await loadLibraryListing(CFG, online(LENT));
		await flushReadCache();
		expect(await readCacheEntryCount()).toBeGreaterThan(0);
		await expect(listLendings(CFG, offline())).rejects.toThrow('Failed to fetch');
	});
});

describe('#434 slice 4 — loadLibraryListing / loadLibraryEditions / loadLibraryCopies are cache-backed', () => {
	it('the listing comes back offline identical to the online one, stamped with its read time', async () => {
		const live = await loadLibraryListing(CFG, online(LENT));
		expect(live.works.items.map((w) => w.id)).toEqual(['w-1']);
		expect(live.lendings.items.map((l) => l.id)).toEqual(['l-1']);
		expect(live.borrowerNames.get('m-2')).toBe('Liisa Laulja');
		await flushReadCache();
		expect(get(servedFromCache)).toBeNull();

		resetServedFromCache();
		const stored = await loadLibraryListing(CFG, offline());
		expect(stored.works).toEqual(live.works);
		expect(stored.lendings).toEqual(live.lendings);
		expect([...stored.borrowerNames]).toEqual([...live.borrowerNames]);
		expect(get(servedFromCache)).not.toBeNull();
	});

	it('editions and copies of an opened node come back offline', async () => {
		const editions = await loadLibraryEditions(CFG, 'w-1', online(LENT));
		const copies = await loadLibraryCopies(CFG, 'e-1', online(LENT));
		await flushReadCache();

		resetServedFromCache();
		expect(await loadLibraryEditions(CFG, 'w-1', offline())).toEqual(editions);
		expect(await loadLibraryCopies(CFG, 'e-1', offline())).toEqual(copies);
		expect(get(servedFromCache)).not.toBeNull();
	});

	it('a node never opened online still rejects offline', async () => {
		await loadLibraryEditions(CFG, 'w-1', online(LENT));
		await flushReadCache();
		await expect(loadLibraryEditions(CFG, 'w-9', offline())).rejects.toThrow('Failed to fetch');
	});
});

describe('#434 slice 4 — refreshLibraryLendings stores without serving', () => {
	it('online, it moves the stored lendings past the write: a later offline listing shows the copy returned', async () => {
		await loadLibraryListing(CFG, online(LENT));
		await flushReadCache();

		// The write (a return) lands; the page re-reads the lendings.
		const fresh = await refreshLibraryLendings(CFG, online(RETURNED));
		expect(fresh.lendings.items[0].returnedAt).toBe('2026-09-28');
		await flushReadCache();

		resetServedFromCache();
		const stored = await loadLibraryListing(CFG, offline());
		expect(stored.lendings.items[0].returnedAt).toBe('2026-09-28');
	});

	it('offline, it REJECTS — never a stored copy — and leaves servedFromCache untouched', async () => {
		await loadLibraryListing(CFG, online(LENT));
		await flushReadCache();

		resetServedFromCache();
		await expect(refreshLibraryLendings(CFG, offline())).rejects.toThrow('Failed to fetch');
		expect(get(servedFromCache)).toBeNull();
	});
});

// (*MVOX:Tallis* — #434 slice 4/6 RED)
