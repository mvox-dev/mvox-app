// The byte store's policy core through its public interface, over an in-memory adapter.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BYTE_STORE_CAP_BYTES,
	createByteStore,
	type ByteStore
} from './byteStore';
import { createFakeAdapter, type FakeAdapter } from '$lib/testing/byteStoreFakes';

const A = { db: 'sampledb', personId: 'person-a' };
const B = { db: 'sampledb', personId: 'person-b' };
const C = { db: 'crede', personId: 'person-a' }; // same human, other collective

function bytes(n: number, fill = 7): ArrayBuffer {
	return new Uint8Array(n).fill(fill).buffer;
}

function data(n: number, fill = 7) {
	return { bytes: bytes(n, fill), filetype: 'application/pdf', sha256: `sha-${n}-${fill}` };
}

let adapter: FakeAdapter;
let store: ByteStore;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-09-12T10:00:00.000Z'));
	adapter = createFakeAdapter();
	store = createByteStore(adapter, { capBytes: 100 });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('byteStore — read/write through the interface', () => {
	it('a miss is undefined; a put makes the same key a hit with the same bytes', async () => {
		expect(await store.get(A, 'file-1')).toBeUndefined();
		await store.put(A, 'file-1', data(10));
		const rec = await store.get(A, 'file-1');
		expect(rec).toBeDefined();
		expect(new Uint8Array(rec!.bytes)).toEqual(new Uint8Array(bytes(10)));
		expect(rec!.filetype).toBe('application/pdf');
		expect(rec!.sha256).toBe('sha-10-7');
		expect(rec!.size).toBe(10);
	});

	it('the stored record is EXACTLY the pinned shape — no URL field, no signed-URL string anywhere in it', async () => {
		await store.put(A, 'file-1', data(10));
		const persisted = adapter.putLog.at(-1)!.record;
		// Full-shape pin (the partial-assertions lesson): every key accounted for.
		expect(Object.keys(persisted).sort()).toEqual(['bytes', 'filetype', 'openedAt', 'sha256', 'size']);
		const scan = JSON.stringify({ ...persisted, bytes: undefined });
		expect(scan).not.toMatch(/https?:/i);
		expect(scan).not.toMatch(/X-Amz/i);
	});

	it('evict removes exactly the named row', async () => {
		await store.put(A, 'file-1', data(10));
		await store.put(A, 'file-2', data(10));
		await store.evict(A, 'file-1');
		expect(await store.get(A, 'file-1')).toBeUndefined();
		expect(await store.get(A, 'file-2')).toBeDefined();
	});

	it('usage sums stored byte sizes across ALL partitions', async () => {
		await store.put(A, 'file-1', data(10));
		await store.put(B, 'file-2', data(20));
		await store.put(C, 'file-3', data(30));
		expect(await store.usage()).toBe(60);
	});
});

describe('byteStore — identity partition (correctness boundary)', () => {
	it('the SAME fileId under different (db, personId) identities holds independent bytes', async () => {
		await store.put(A, 'file-1', data(10, 1));
		await store.put(C, 'file-1', data(10, 2));
		expect(new Uint8Array((await store.get(A, 'file-1'))!.bytes)[0]).toBe(1);
		expect(new Uint8Array((await store.get(C, 'file-1'))!.bytes)[0]).toBe(2);
	});

	it("after a switch, A's bytes are unreachable via every accessor path under B — get answers only the asking identity's partition", async () => {
		await store.put(A, 'file-1', data(10));
		// B (second person, same db) and C (same person, other db) both miss.
		expect(await store.get(B, 'file-1')).toBeUndefined();
		expect(await store.get(C, 'file-1')).toBeUndefined();
	});

	it('null identity: get AND put THROW (pinned choice) — no accessor can construct a key for anonymous', async () => {
		await expect(store.get(null, 'file-1')).rejects.toThrow(/identity/i);
		await expect(store.put(null, 'file-1', data(10))).rejects.toThrow(/identity/i);
		// And nothing was persisted by the rejected put.
		expect(adapter.rows()).toEqual([]);
	});
});

describe('byteStore — clearPartition (mechanism only; NOT an auth hook)', () => {
	it('empties exactly the named partition and leaves every other partition intact', async () => {
		await store.put(A, 'file-1', data(10));
		await store.put(A, 'file-2', data(10));
		await store.put(B, 'file-3', data(10));
		await store.put(C, 'file-4', data(10));

		await store.clearPartition(A.db, A.personId);

		expect(await store.get(A, 'file-1')).toBeUndefined();
		expect(await store.get(A, 'file-2')).toBeUndefined();
		expect(await store.get(B, 'file-3')).toBeDefined();
		expect(await store.get(C, 'file-4')).toBeDefined();
	});
});

describe('byteStore — GLOBAL cap, least-recently-OPENED eviction', () => {
	it('an over-cap put evicts the oldest-OPENED rows until the newcomer fits — across partition lines', async () => {
		// cap 100: A holds 40 (opened t0), B holds 40 (opened t1).
		await store.put(A, 'file-a', data(40));
		vi.advanceTimersByTime(1000);
		await store.put(B, 'file-b', data(40));
		vi.advanceTimersByTime(1000);

		// C's 40 pushes usage to 120 → the DORMANT A row goes, regardless of
		// its partition; B (more recently opened) survives.
		await store.put(C, 'file-c', data(40));

		expect(await store.get(A, 'file-a')).toBeUndefined();
		expect(await store.get(B, 'file-b')).toBeDefined();
		expect(await store.get(C, 'file-c')).toBeDefined();
		expect(await store.usage()).toBe(80);
	});

	it('a cached get() moves recency WITHOUT rewriting the bytes — one touch, no second put (review: the hot path)', async () => {
		await store.put(A, 'file-a', data(40));
		expect(adapter.putLog.length).toBe(1);
		vi.advanceTimersByTime(1000);

		const rec = await store.get(A, 'file-a');

		// The stamp moved — on the record handed back AND on what is persisted.
		expect(rec!.openedAt).toBe(Date.now());
		expect(adapter.rows()[0].record.openedAt).toBe(Date.now());
		expect(adapter.touchLog).toEqual([
			{ db: A.db, personId: A.personId, fileId: 'file-a', openedAt: Date.now() }
		]);
		// And the ArrayBuffer was NOT re-persisted to carry it.
		expect(adapter.putLog.length).toBe(1);
	});

	it('a MISS moves no recency — there is no row to stamp', async () => {
		expect(await store.get(A, 'file-nothing')).toBeUndefined();
		expect(adapter.touchLog).toEqual([]);
		expect(adapter.putLog).toEqual([]);
	});

	it('a get() IS an open — it refreshes recency, changing who gets evicted', async () => {
		await store.put(A, 'file-a', data(40));
		vi.advanceTimersByTime(1000);
		await store.put(B, 'file-b', data(40));
		vi.advanceTimersByTime(1000);

		// Re-open A: now B is the least-recently-opened row.
		await store.get(A, 'file-a');
		vi.advanceTimersByTime(1000);
		await store.put(C, 'file-c', data(40));

		expect(await store.get(A, 'file-a')).toBeDefined();
		expect(await store.get(B, 'file-b')).toBeUndefined();
		expect(await store.get(C, 'file-c')).toBeDefined();
	});

	it('eviction frees only as much as the newcomer needs — never a full wipe', async () => {
		await store.put(A, 'file-a', data(30));
		vi.advanceTimersByTime(1000);
		await store.put(A, 'file-b', data(30));
		vi.advanceTimersByTime(1000);
		await store.put(A, 'file-c', data(30));
		vi.advanceTimersByTime(1000);

		// 90 held; +30 exceeds 100 → exactly ONE eviction (the oldest) suffices.
		await store.put(B, 'file-d', data(30));

		expect(await store.get(A, 'file-a')).toBeUndefined();
		expect(await store.get(A, 'file-b')).toBeDefined();
		expect(await store.get(A, 'file-c')).toBeDefined();
		expect(await store.get(B, 'file-d')).toBeDefined();
	});

	it('a single record larger than the cap is REJECTED loudly, and nothing already held is destroyed for it', async () => {
		await store.put(A, 'file-a', data(40));
		await expect(store.put(A, 'file-huge', data(150))).rejects.toThrow(/cap/i);
		expect(await store.get(A, 'file-a')).toBeDefined();
		expect(await store.get(A, 'file-huge')).toBeUndefined();
	});

	it('the default cap constant is a positive integer number of bytes', () => {
		expect(Number.isInteger(BYTE_STORE_CAP_BYTES)).toBe(true);
		expect(BYTE_STORE_CAP_BYTES).toBeGreaterThan(0);
	});
});

describe('#410 — protected rows are not candidates in the put-time evictUntilFits', () => {
	/** Composite key = the adapter's own JSON fixed-arity triple — collision-
	 *  safe against any separator character appearing in a db/person/file id. */
	function pkey(db: string, personId: string, fileId: string): string {
		return JSON.stringify([db, personId, fileId]);
	}

	it('an over-cap put with a PROTECTED oldest row evicts the next-oldest instead', async () => {
		// cap 100: A holds 40 (opened t0, PROTECTED), B holds 40 (opened t1).
		await store.put(A, 'file-next', data(40));
		vi.advanceTimersByTime(1000);
		await store.put(B, 'file-mid', data(40));
		vi.advanceTimersByTime(1000);
		store.setProtectedKeys(new Set([pkey(A.db, A.personId, 'file-next')]));

		// C's 40 pushes usage to 120 → the globally-oldest row is A's, but it
		// is the next event's part — the NEXT-oldest (B's) goes instead.
		await store.put(C, 'file-new', data(40));

		expect(await store.get(A, 'file-next')).toBeDefined();
		expect(await store.get(B, 'file-mid')).toBeUndefined();
		expect(await store.get(C, 'file-new')).toBeDefined();
		expect(await store.usage()).toBe(80);
	});

	it('the default is EMPTY — a store never handed a protected set evicts exactly as before (the fixtures above are the pin)', async () => {
		// Belt for the additive-parameter claim: same shape as the first cap
		// fixture, no setProtectedKeys call anywhere — oldest still goes.
		await store.put(A, 'file-a', data(40));
		vi.advanceTimersByTime(1000);
		await store.put(B, 'file-b', data(40));
		vi.advanceTimersByTime(1000);
		await store.put(C, 'file-c', data(40));
		expect(await store.get(A, 'file-a')).toBeUndefined();
		expect(await store.get(B, 'file-b')).toBeDefined();
	});
});

// (*MVOX:Tallis*)
