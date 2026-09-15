// #351 RED — the PRESENCE QUERY on the byte store: one non-touching call
// answering "which fileIds does this (db, personId) partition hold?", so a
// list can badge N rows without stamping N opens.
//
// THE TRAP THIS CONTRACT EXISTS TO PREVENT (issue #351, "read this before
// writing the presence check"): ByteStore.get() COUNTS AS AN OPEN — recency
// is what bounds the store, and a per-row get() would stamp every listed file
// as freshly opened on every render. LRU collapses to render order, eviction
// starts discarding the wrong bytes, and nothing fails visibly. So:
//
//   - The presence query is ONE call per list, keyed (db, personId) like
//     clearPartition — NOT one call per row, NOT built on get().
//   - It moves NO recency: no adapter.touch, no openedAt change, no put.
//   - It lives on the REAL ByteStore interface (byteStore.ts). The fake
//     (byteStoreFakes.ts) already had a test-only heldFor(db, personId) with
//     no real-interface counterpart — that divergence is RECONCILED here: the
//     real interface gains heldFileIds(db, personId): Promise<string[]> and
//     the fake implements the same member (delegating, not duplicating).
//     Named heldFileIds — "held", a statement about presence, because a name
//     that reads like a bytes-read (get*/read*/load*) invites the next caller
//     to treat it as one, and a bytes-read is exactly what it must never be.
//   - There is NO live invalidation — the store has no events. A row evicted
//     by the cap stops appearing ON THE NEXT QUERY; that is the whole
//     contract (reflect-on-next-query).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createByteStore, type ByteStore, type StoredFileRecord } from './byteStore';
import { createFakeAdapter, createFakeByteStore, type FakeAdapter } from '$lib/testing/byteStoreFakes';

/** The #351 contract shape — an intersection until byteStore.ts declares it
 *  (the source pin below holds the interface itself to account). */
type PresenceCapable = ByteStore & {
	heldFileIds(db: string, personId: string): Promise<string[]>;
};

const A = { db: 'polyphony', personId: 'person-a' };
const B = { db: 'polyphony', personId: 'person-b' };
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
let store: PresenceCapable;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-09-14T10:00:00.000Z'));
	adapter = createFakeAdapter();
	store = createByteStore(adapter, { capBytes: 100 }) as PresenceCapable;
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
		expect(await store.heldFileIds('polyphony', 'person-nobody')).toEqual([]);
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

	it('the adapter seam DECLARES the keys-only method, so no implementation can quietly answer presence from rows', () => {
		const source = readFileSync(fileURLToPath(new URL('./byteStore.ts', import.meta.url)), 'utf-8');
		expect(source).toMatch(/listKeys\(\): Promise<ByteStoreKey\[\]>/);
	});
});

describe('#351 — the fake store implements the SAME presence member (reconciled, not a divergent duplicate)', () => {
	it('createFakeByteStore().heldFileIds exists and answers exactly what its heldFor answers', async () => {
		const fake = createFakeByteStore();
		fake.seed({ db: 'db-1', personId: 'p-1' }, 'file-a', data(4));
		fake.seed({ db: 'db-1', personId: 'p-1' }, 'file-b', data(4));
		fake.seed({ db: 'db-2', personId: 'p-1' }, 'file-c', data(4));

		const presence = fake as unknown as PresenceCapable;
		const answer = await presence.heldFileIds('db-1', 'p-1');
		expect([...answer].sort()).toEqual(['file-a', 'file-b']);
		expect([...answer].sort()).toEqual([...fake.heldFor('db-1', 'p-1')].sort());
		expect(await presence.heldFileIds('db-2', 'p-1')).toEqual(['file-c']);
	});
});

describe('#351 — source pins: the member sits on the REAL interface and reads as presence, never as a bytes-read', () => {
	const source = readFileSync(fileURLToPath(new URL('./byteStore.ts', import.meta.url)), 'utf-8');

	it('the ByteStore interface declares heldFileIds(db, personId): Promise<string[]>', () => {
		expect(source).toMatch(/heldFileIds\(db: string, personId: string\): Promise<string\[\]>/);
	});

	it('the doc beside it states this is a presence query and NOT an open — the one fact the next caller must meet', () => {
		expect(source).toMatch(/presence/i);
		expect(source).toMatch(/not an open|never an open|not count as an open|no recency/i);
	});
});

// (*MVOX:Tallis*)
