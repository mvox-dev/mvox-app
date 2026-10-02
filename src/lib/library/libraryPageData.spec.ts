// The library page's data entry points and the defaults of the shared readers under them.
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
import { listWorks, listLendings, listAllEditions, listAllCopies } from './libraryData';
import { listActiveMembers } from '$lib/roster/rosterData';
import {
	loadLibraryListing,
	loadLibraryEditions,
	loadLibraryCopies,
	refreshLibraryLendings,
	loadLibrarianState,
	loadLibrarianPickers,
	resolveWriteLibraryId
} from './libraryPageData';
import { json } from '$lib/testing/entuFetchKit';

const DB = 'sampledb';
const PERSON = 'person-1';
const CFG = { db: DB, token: 'tok-1' };
const DB_ENTITY = 'db-entity-1';
const LIBRARY = 'lib-1';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

interface LendingRow {
	id: string;
	copy: string;
	member: string;
	returnedAt?: string;
}

function online(lendings: LendingRow[]) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=work&')) {
			return json({
				count: 1,
				entities: [{ _id: 'w-1', name: [{ string: 'Messa di Gloria' }], composer: [{ string: 'Puccini' }] }]
			}, 200, JSON_HEADERS);
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
			}, 200, JSON_HEADERS);
		}
		if (url.includes('entity/m-2?props=person')) {
			return json({ entity: { _id: 'm-2', person: [{ reference: 'p-2' }] } }, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=profile') && url.includes('_parent.reference=p-2')) {
			return json({
				count: 1,
				entities: [{ _id: 'prof-2', name: [{ string: 'Liisa Laulja' }], _sharing: [{ string: 'domain' }] }]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=edition&') && url.includes('_parent.reference=w-1')) {
			return json(
				{ count: 1, entities: [{ _id: 'e-1', name: [{ string: 'Carus 2019' }] }] },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes('_type.string=copy&') && url.includes('_parent.reference=e-1')) {
			return json(
				{ count: 1, entities: [{ _id: 'c-1', copy_number: [{ number: 3 }] }] },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: DB_ENTITY }] }, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=library&')) {
			return json({ count: 1, entities: [{ _id: LIBRARY }] }, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${LIBRARY}?props=_owner,_editor`)) {
			return json({ entity: { _id: LIBRARY, _owner: [{ reference: PERSON }] } }, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=edition&props=')) {
			return json({
				count: 1,
				entities: [
					{
						_id: 'e-1',
						name: [{ string: 'Carus 2019' }],
						_parent: [{ reference: 'w-1', entity_type: 'work' }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=copy&props=')) {
			return json({
				count: 1,
				entities: [
					{
						_id: 'c-1',
						copy_number: [{ number: 3 }],
						_parent: [{ reference: 'e-1', entity_type: 'edition' }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=member&status.string=active')) {
			return json(
				{ count: 1, entities: [{ _id: 'm-2', person: [{ reference: 'p-2' }] }] },
				200,
				JSON_HEADERS
			);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
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

describe('#434 slice 4 review round 2, finding 1 — the librarian panel feeds are cache-backed', () => {
	it('the three pickers called the SHARED way store nothing', async () => {
		await listAllEditions(CFG, online(LENT));
		await listAllCopies(CFG, online(LENT));
		await listActiveMembers(CFG, online(LENT));
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('loadLibrarianPickers comes back offline identical to the online answer, stamped', async () => {
		const live = await loadLibrarianPickers(CFG, online(LENT));
		expect(live.editions.items.map((e) => e.id)).toEqual(['e-1']);
		expect(live.copies.items.map((c) => c.id)).toEqual(['c-1']);
		expect(live.members.items.map((mbr) => mbr.memberId)).toEqual(['m-2']);
		await flushReadCache();
		expect(get(servedFromCache)).toBeNull();

		resetServedFromCache();
		const stored = await loadLibrarianPickers(CFG, offline());
		expect(stored).toEqual(live);
		expect(get(servedFromCache)).not.toBeNull();
	});

	it('the librarian STATE and its pickers restore together — the panel never resolves to a half-load', async () => {
		expect(await loadLibrarianState(CFG, PERSON, online(LENT))).toEqual({
			state: 'librarian',
			libraryId: LIBRARY
		});
		await loadLibrarianPickers(CFG, online(LENT));
		await flushReadCache();

		resetServedFromCache();
		const stub = offline();
		expect(await loadLibrarianState(CFG, PERSON, stub)).toEqual({
			state: 'librarian',
			libraryId: LIBRARY
		});
		await expect(loadLibrarianPickers(CFG, stub)).resolves.toBeDefined();
	});
});

describe('#434 slice 4 review round 2, finding 2 — the WRITE parent is never cache-served', () => {
	it('resolveWriteLibraryId stores nothing — the default, flag-free resolution', async () => {
		expect(await resolveWriteLibraryId(CFG, online(LENT))).toBe(LIBRARY);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('resolveWriteLibraryId REJECTS offline even though the panel restores the same id', async () => {
		expect(await loadLibrarianState(CFG, PERSON, online(LENT))).toEqual({
			state: 'librarian',
			libraryId: LIBRARY
		});
		await flushReadCache();

		expect((await loadLibrarianState(CFG, PERSON, offline())).libraryId).toBe(LIBRARY);
		await expect(resolveWriteLibraryId(CFG, offline())).rejects.toThrow('Failed to fetch');
	});

	it('it leaves servedFromCache alone — a write-path read never age-stamps the screen', async () => {
		await loadLibrarianState(CFG, PERSON, online(LENT));
		await flushReadCache();

		resetServedFromCache();
		await resolveWriteLibraryId(CFG, online(LENT));
		expect(get(servedFromCache)).toBeNull();
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
