// The byte store's presence query: one heldFileIds(db, personId) call per list that moves no
// recency, since a per-row get() would count as an open and reorder eviction by render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createByteStore, type ByteStore, type StoredFileRecord } from './byteStore';
import { createFakeAdapter, createFakeByteStore, type FakeAdapter } from '$lib/testing/byteStoreFakes';

const A = { db: 'sampledb', personId: 'person-a' };
const B = { db: 'sampledb', personId: 'person-b' };
const C = { db: 'crede', personId: 'person-a' }; // same human, other collective

function bytes(n: number, fill = 7): ArrayBuffer {
	return new Uint8Array(n).fill(fill).buffer;
}

function data(n: number, fill = 7) {
	return { bytes: bytes(n, fill), filetype: 'application/pdf', sha256: `sha-${n}-${fill}` };
}

/** A fully-shaped record for direct adapter seeding — the arrange step
 *  bypasses store.put so each openedAt stamp is EXPLICIT and assertable. */
function seededRecord(n: number, openedAt: number): StoredFileRecord {
	return {
		bytes: bytes(n),
		filetype: 'application/pdf',
		sha256: `sha-${n}`,
		size: n,
		openedAt
	};
}

let adapter: FakeAdapter;
let store: ByteStore;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-09-14T10:00:00.000Z'));
	adapter = createFakeAdapter();
	store = createByteStore(adapter, { capBytes: 100 });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('#351 — presence is NOT an open (the invisible-failure acceptance)', () => {
	it('N presence calls move NO recency: touchLog untouched, every openedAt stamp exactly as seeded, nothing written', async () => {
		// Seeded via the adapter with EXPLICIT stamps, so any stamp movement —
		// however implemented — is visible as a changed number, not a race.
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(10, 1000));
		await adapter.put(A.db, A.personId, 'file-2', seededRecord(10, 2000));
		const putsAfterSeeding = adapter.putLog.length;

		const answers: string[][] = [];
		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(1000); // time passes between renders
			answers.push(await store.heldFileIds(A.db, A.personId));
		}

		// Full-shape pin on every answer — not a contains-check.
		for (const answer of answers) {
			expect([...answer].sort()).toEqual(['file-1', 'file-2']);
		}
		// THE acceptance: no touch, no re-put, no stamp moved. A get()-based
		// presence check fails all three of these at once.
		expect(adapter.touchLog).toEqual([]);
		expect(adapter.putLog.length).toBe(putsAfterSeeding);
		expect(
			adapter.rows().map((r) => ({ fileId: r.fileId, openedAt: r.record.openedAt }))
		).toEqual([
			{ fileId: 'file-1', openedAt: 1000 },
			{ fileId: 'file-2', openedAt: 2000 }
		]);
	});
});

describe('#351 — one call answers one partition', () => {
	it('returns the held fileIds for exactly the asked (db, personId) — same person in two dbs gets disjoint answers', async () => {
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(10, 1000));
		await adapter.put(A.db, A.personId, 'file-2', seededRecord(10, 1100));
		await adapter.put(C.db, C.personId, 'file-3', seededRecord(10, 1200));
		await adapter.put(B.db, B.personId, 'file-4', seededRecord(10, 1300));

		expect([...(await store.heldFileIds(A.db, A.personId))].sort()).toEqual(['file-1', 'file-2']);
		expect(await store.heldFileIds(C.db, C.personId)).toEqual(['file-3']);
		expect(await store.heldFileIds(B.db, B.personId)).toEqual(['file-4']);
		// A partition nothing was ever stored under answers empty, not throws.
		expect(await store.heldFileIds('sampledb', 'person-nobody')).toEqual([]);
	});
});

describe('#351 — downloaded, then evicted: gone on the NEXT query (reflect-on-next-query; the store has no events)', () => {
	it('an over-cap put evicts the oldest row, and the next presence answer no longer names it', async () => {
		await store.put(A, 'file-old', data(60));
		expect(await store.heldFileIds(A.db, A.personId)).toEqual(['file-old']);

		vi.advanceTimersByTime(1000);
		// 60 + 60 > 100 → the cap evicts file-old to admit the newcomer.
		await store.put(A, 'file-new', data(60));

		expect(await store.heldFileIds(A.db, A.personId)).toEqual(['file-new']);
	});
});

describe('#351 review finding 2 — presence reads KEYS, never PAYLOADS', () => {
	it('heldFileIds goes through adapter.listKeys and NEVER adapter.list — the row-reading seam is not touched', async () => {
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(10, 1000));
		await adapter.put(A.db, A.personId, 'file-2', seededRecord(10, 1100));
		await adapter.put(B.db, B.personId, 'file-3', seededRecord(10, 1200));
		const listSpy = vi.spyOn(adapter, 'list');
		const listKeysSpy = vi.spyOn(adapter, 'listKeys');

		expect([...(await store.heldFileIds(A.db, A.personId))].sort()).toEqual(['file-1', 'file-2']);

		// `list()` deserialises every stored ArrayBuffer (idbAdapter's
		// PAYLOAD_STORE.getAll) — up to the whole 200MB cap, into the JS heap,
		// on a route that asks this on every load. Presence must not call it.
		expect(listSpy).not.toHaveBeenCalled();
		expect(listKeysSpy).toHaveBeenCalledTimes(1);
	});

	it('clearPartition also works from keys alone — deleting bytes never needs to read them', async () => {
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(10, 1000));
		await adapter.put(B.db, B.personId, 'file-2', seededRecord(10, 1100));
		const listSpy = vi.spyOn(adapter, 'list');

		await store.clearPartition(A.db, A.personId);

		expect(listSpy).not.toHaveBeenCalled();
		expect(adapter.rows().map((r) => r.fileId)).toEqual(['file-2']);
	});
});

describe('#351 — the fake store implements the SAME presence member (reconciled, not a divergent duplicate)', () => {
	it('createFakeByteStore().heldFileIds exists and answers exactly what its heldFor answers', async () => {
		const fake = createFakeByteStore();
		fake.seed({ db: 'db-1', personId: 'p-1' }, 'file-a', data(4));
		fake.seed({ db: 'db-1', personId: 'p-1' }, 'file-b', data(4));
		fake.seed({ db: 'db-2', personId: 'p-1' }, 'file-c', data(4));

		const answer = await fake.heldFileIds('db-1', 'p-1');
		expect([...answer].sort()).toEqual(['file-a', 'file-b']);
		expect([...answer].sort()).toEqual([...fake.heldFor('db-1', 'p-1')].sort());
		expect(await fake.heldFileIds('db-2', 'p-1')).toEqual(['file-c']);
	});
});

// (*MVOX:Tallis*)
