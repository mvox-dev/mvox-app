// #343 RED — the byte-store POLICY CORE, driven through the public ByteStore
// interface against an in-memory adapter (default node env — no DOM, no
// IndexedDB; the persistence layer has its own spec, idbAdapter.spec.ts).
//
// The pinned design, from the issue body + Gama's 2026-09-12 ruling
// (issue comment IC_kwDOTubdKM8AAAABUHDKvg):
//
//   - KEY = (db, personId, fileId). One human holds a different person-id per
//     collective; the partition stops the app serving one identity's bytes to
//     another. That is a CORRECTNESS boundary, NOT a security boundary
//     (browser storage is origin-scoped) — and the module head must say so
//     (source pins below; Gama: "a comment claiming isolation we cannot
//     enforce is worse than no comment").
//   - NULL identity (anonymous): accessors THROW — pinned choice (fail
//     loudly over silent no-op, the house rule). No accessor can construct a
//     key without an identity.
//   - CAP is GLOBAL across all partitions; eviction is least-recently-OPENED
//     across all partitions (a dormant identity's bytes age out on their
//     own). A get() is an open; a put() counts as the first open. A get()
//     moves recency through `adapter.touch` — the stamp alone, never a
//     rewrite of the byte payload (review: the cached open is the hot path).
//   - clearPartition(db, personId) empties exactly one partition. It is a
//     bare mechanism here — #334 owns the member-facing control — and it is
//     NOT wired to any auth path (see storage.spec.ts).
//   - STALENESS IS STRUCTURAL — no validator field beyond the key: the
//     replace flow retires the file-property _id itself (probe ledger
//     scripts/migrations/seed-results/probe-343-file-replace-identity-live-
//     2026-09-12T07-56-06-582Z.json: delete-then-post mints a NEW _id, and
//     even a POST carrying the old _id appends a NEW property). NO ETag
//     logic: the bucket exposes NO headers to CORS fetch (ledger
//     probe-343-signed-url-headers-live-2026-09-12T08-03-54-345Z.json —
//     Access-Control-Expose-Headers absent, ETag reads null client-side), so
//     the module records that as a comment-level statement, never as code.
//   - The stored record carries an app-computed SHA-256 of the bytes —
//     #333's hash-pin hook. Compute-and-record only; COMPARISON logic is out
//     of scope and must not exist here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BYTE_STORE_CAP_BYTES,
	createByteStore,
	type ByteStore
} from './byteStore';
import { createFakeAdapter, type FakeAdapter } from '$lib/testing/byteStoreFakes';

const A = { db: 'polyphony', personId: 'person-a' };
const B = { db: 'polyphony', personId: 'person-b' };
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

describe('byteStore — the module says what it must, where the reader meets it (source pins)', () => {
	const source = readFileSync(fileURLToPath(new URL('./byteStore.ts', import.meta.url)), 'utf-8');

	it('states the retention posture: the partition is a correctness boundary and NOT a security boundary', () => {
		// Gama's exact enforcement phrase family (issue comment
		// IC_kwDOTubdKM8AAAABUHDKvg): both halves must be present.
		expect(source).toMatch(/correctness/i);
		expect(source).toMatch(/not a security boundary/i);
	});

	it('states the cap and the eviction rule beside them: global cap, least-recently-opened', () => {
		expect(source).toMatch(/global cap/i);
		expect(source).toMatch(/least-recently-opened/i);
	});

	it('records WHY there is no ETag validator (comment-level statement, never code)', () => {
		// The statement: ETag exists server-side but is unreadable via CORS
		// fetch (Access-Control-Expose-Headers absent) — probe ledger cited in
		// this spec's header. Presence of the words, absence of the code:
		expect(source).toMatch(/ETag/);
		expect(source).toMatch(/CORS|Expose-Headers/i);
		expect(source).not.toMatch(/headers\.get/i);
		expect(source).not.toMatch(/['"`]etag['"`]/i);
	});

	it("records the #333 hash-pin hook: the stored sha256 is the app-computed digest of the fetched bytes", () => {
		expect(source).toMatch(/#333/);
		expect(source).toMatch(/sha-?256/i);
	});

	it('never touches auth or identity stores — identity arrives as an argument only', () => {
		expect(source).not.toMatch(/selectedCollective/);
		expect(source).not.toMatch(/\$lib\/auth/);
	});
});

// (*MVOX:Tallis*)
