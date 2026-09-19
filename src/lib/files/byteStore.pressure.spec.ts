// #410 RED — "Vahemälu vabastab ise ruumi, kui seade täis saab": the
// storage-PRESSURE sweep on the byte store. Default node env; the store is
// the REAL policy core over the in-memory fake adapter, and the pressure
// signal is an INJECTED estimate() — node/happy-dom have no StorageManager
// (navigator.storage is undefined here, asserted below), so the seam is an
// option on createByteStore, exactly like the adapter itself.
//
// The pinned #410 contract (issue body + Gama's scope ruling 2026-09-18 (b)):
//
//   - PRESSURE IS A NUMBER THE APP READS, NOT A NOTIFICATION IT WAITS FOR:
//     the browser fires no OS pressure event; the signal is
//     estimate() → usage/quota. `PRESSURE_RATIO` (0.8) is exported — the
//     ratio at or above which the sweep evicts — and the sweep runs until
//     the ratio is strictly below the 0.7 relief target (hysteresis: never
//     oscillate around one line) OR only protected rows remain.
//   - `relieve()` on the ByteStore interface:
//       estimate absent            → { outcome: 'unsupported' }, never throws
//       estimate present           → { outcome: 'swept', before, after, removed }
//     where before/after are usage/quota ratios and removed[] lists the
//     evicted keys ({db, personId, fileId}) oldest-OPENED first. One
//     listMeta() read feeds the whole sweep (none at all below the pressure
//     line, review F2) — never list(), never get().
//   - THE PROTECTED SET IS AN INPUT: setProtectedKeys(ReadonlySet<string>)
//     of composite JSON-triple keys (JSON.stringify([db, personId, fileId]) —
//     the adapter's own collision-safe encoding). The store never knows
//     about agendas; the page builds the set (nextEventFileIds over every
//     JOINED collective of the signed-in person, ruled (b)). Protected rows
//     are never candidates — in relieve() OR in the put-time cap pass
//     (byteStore.spec.ts) — but the partition boundary stands: another
//     personId's row is NOT protected however identical its fileId.
//   - TRIGGERS: after every put (the existing evict point), and once at app
//     open before #409's prefetch (page wiring — page.works-wiring.spec.ts).
//     A put's own row survives its own after-put sweep (same exception the
//     cap pass already makes for the incoming write).
//   - A REAL QuotaExceededError ON PUT: relieve once, retry the put ONCE;
//     still failing → the error propagates to openFileBytes' existing belt
//     and the open degrades to 'network-uncached' — nothing thrown, nothing
//     lost but the cache row (openFileBytes.ts, #343 belt).
//   - RECENCY IS A RECORD OF USE, NOT DISPLAY (#367's verification): the
//     sweep reads listMeta() only — zero get(), zero touch, zero stamps
//     moved. A sweep that touches a stamp it did not evict is a bug.
//   - #352's manual remove is UNCHANGED and beats retention: clearPartition /
//     clearAllPartitions delete protected rows too — she asked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signFileUrlMock } = vi.hoisted(() => ({ signFileUrlMock: vi.fn() }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));

import * as byteStoreModule from './byteStore';
import {
	createByteStore,
	type ByteStore,
	type ByteStoreAdapter,
	type ByteStoreKey,
	type StoredFileRecord
} from './byteStore';
import { openFileBytes } from './openFileBytes';
import { createFakeAdapter, type FakeAdapter } from '$lib/testing/byteStoreFakes';

/** The #410 contract shape — an intersection until byteStore.ts declares it
 *  (the source pins below hold the interface itself to account; same idiom as
 *  byteStore.presence.spec.ts's PresenceCapable). */
type RelieveResult =
	| { outcome: 'unsupported' }
	| { outcome: 'swept'; before: number; after: number; removed: ByteStoreKey[] };
type PressureCapable = ByteStore & {
	relieve(): Promise<RelieveResult>;
	setProtectedKeys(keys: ReadonlySet<string>): void;
};
type PressureOpts = {
	capBytes?: number;
	onRowRemoved?: (key: ByteStoreKey) => void;
	/** The injectable pressure signal — defaults to navigator.storage?.estimate
	 *  (bound) when the platform has one; absent here (node), so relieve()
	 *  without this option must answer 'unsupported'. */
	estimate?: () => Promise<{ usage?: number; quota?: number }>;
};
const makeStore = createByteStore as unknown as (
	adapter: ByteStoreAdapter,
	opts?: PressureOpts
) => PressureCapable;

const A = { db: 'polyphony', personId: 'person-a' };
const B = { db: 'polyphony', personId: 'person-b' };
const C = { db: 'crede', personId: 'person-a' }; // same human, other collective

function bytes(n: number, fill = 7): ArrayBuffer {
	return new Uint8Array(n).fill(fill).buffer;
}

function data(n: number, fill = 7) {
	return { bytes: bytes(n, fill), filetype: 'application/pdf', sha256: `sha-${n}-${fill}` };
}

/** A fully-shaped record for direct adapter seeding — EXPLICIT openedAt, so
 *  eviction order and stamp movement are assertable numbers, never races. */
function seededRecord(n: number, openedAt: number): StoredFileRecord {
	return { bytes: bytes(n), filetype: 'application/pdf', sha256: `sha-${n}`, size: n, openedAt };
}

/** Composite protected key — the adapter's own JSON fixed-arity triple. */
function pkey(db: string, personId: string, fileId: string): string {
	return JSON.stringify([db, personId, fileId]);
}

/**
 * A DYNAMIC estimate() double: origin usage = `otherBytes` (the service
 * worker's shell cache, other origin storage — estimate() answers for the
 * whole origin, not this store alone) + whatever the adapter currently
 * holds. Reflects deletions the way a real browser would, so the sweep's
 * stop condition is observable however the implementation reads it. Computed
 * from the fake's raw rows() view — NOT adapter.listMeta — so the spy counts
 * on the adapter seams stay honest.
 */
function estimateOver(adapter: FakeAdapter, otherBytes: number, quota: number) {
	return vi.fn(async () => ({
		usage: otherBytes + adapter.rows().reduce((sum, r) => sum + r.record.size, 0),
		quota
	}));
}

let adapter: FakeAdapter;

beforeEach(() => {
	signFileUrlMock.mockReset();
	adapter = createFakeAdapter();
});

describe('#410 — the exported pressure line', () => {
	it('PRESSURE_RATIO is exported and pinned at 0.8 — a number the app reads, not a notification', () => {
		expect((byteStoreModule as unknown as Record<string, unknown>).PRESSURE_RATIO).toBe(0.8);
	});
});

describe('#410 — nothing is dropped while there is room', () => {
	// #410 review F2 — TIGHTENED from "one listMeta read" to ZERO: this sweep
	// also runs after EVERY put, and reading every row's metadata only to then
	// delete none is per-download cost paid by a device that is nowhere near
	// full. Below the line the sweep's whole vocabulary is `estimate()`.
	it('ratio 0.5 → relieve removes nothing and reads NOTHING: zero listMeta, zero deletes, full-shape result', async () => {
		// quota 1000: rows 2×50 + 400 other origin bytes → usage 500, ratio 0.5.
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(50, 1000));
		await adapter.put(A.db, A.personId, 'file-2', seededRecord(50, 2000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 400, 1000) });
		const listMetaSpy = vi.spyOn(adapter, 'listMeta');
		const listSpy = vi.spyOn(adapter, 'list');
		const getSpy = vi.spyOn(adapter, 'get');
		const deleteSpy = vi.spyOn(adapter, 'delete');

		const result = await store.relieve();

		expect(result).toEqual({ outcome: 'swept', before: 0.5, after: 0.5, removed: [] });
		expect(listMetaSpy).not.toHaveBeenCalled();
		expect(listSpy).not.toHaveBeenCalled();
		expect(getSpy).not.toHaveBeenCalled();
		expect(deleteSpy).not.toHaveBeenCalled();
		expect(adapter.rows().map((r) => r.fileId).sort()).toEqual(['file-1', 'file-2']);
	});
});

describe('#410 — approaching quota: least-recently-OPENED non-protected rows go until below the relief target', () => {
	it('ratio 0.85 → evicts oldest-opened first, stops strictly below 0.7, reports removed[] full-shape in eviction order', async () => {
		// quota 1000: 5 rows ×50 + 600 other → 850 (0.85 ≥ PRESSURE_RATIO).
		// Sweep: -50 → 0.80, -50 → 0.75, -50 → 0.70 (NOT < 0.7 — hysteresis is
		// strict), -50 → 0.65 → stop. Four oldest go, the newest survives.
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(50, 1000));
		await adapter.put(B.db, B.personId, 'file-2', seededRecord(50, 2000));
		await adapter.put(C.db, C.personId, 'file-3', seededRecord(50, 3000));
		await adapter.put(A.db, A.personId, 'file-4', seededRecord(50, 4000));
		await adapter.put(A.db, A.personId, 'file-5', seededRecord(50, 5000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 600, 1000) });

		const result = await store.relieve();

		expect(result.outcome).toBe('swept');
		if (result.outcome !== 'swept') return;
		// Full-shape result — every key accounted for (the partial-assertions lesson).
		expect(Object.keys(result).sort()).toEqual(['after', 'before', 'outcome', 'removed']);
		expect(result.before).toBeCloseTo(0.85, 10);
		expect(result.after).toBeCloseTo(0.65, 10);
		// Order pinned by openedAt, across partition lines, each entry the full key triple.
		expect(result.removed).toEqual([
			{ db: A.db, personId: A.personId, fileId: 'file-1' },
			{ db: B.db, personId: B.personId, fileId: 'file-2' },
			{ db: C.db, personId: C.personId, fileId: 'file-3' },
			{ db: A.db, personId: A.personId, fileId: 'file-4' }
		]);
		expect(adapter.rows().map((r) => ({ fileId: r.fileId, openedAt: r.record.openedAt }))).toEqual([
			{ fileId: 'file-5', openedAt: 5000 }
		]);
	});
});

describe("#410 — the next event's parts survive EVERY eviction", () => {
	it('with every candidate removed and the ratio still high, protected rows remain — never a full wipe', async () => {
		// quota 1000: 5 rows ×50 + 600 other → 0.85. The four OLDEST are
		// protected; the only candidate is the newest. It goes (0.80, still ≥
		// the 0.7 target) — then only protected rows remain and the sweep
		// RETURNS instead of wiping them.
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(50, 1000));
		await adapter.put(A.db, A.personId, 'file-2', seededRecord(50, 2000));
		await adapter.put(C.db, C.personId, 'file-3', seededRecord(50, 3000));
		await adapter.put(A.db, A.personId, 'file-4', seededRecord(50, 4000));
		await adapter.put(A.db, A.personId, 'file-5', seededRecord(50, 5000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 600, 1000) });
		store.setProtectedKeys(
			new Set([
				pkey(A.db, A.personId, 'file-1'),
				pkey(A.db, A.personId, 'file-2'),
				pkey(C.db, C.personId, 'file-3'),
				pkey(A.db, A.personId, 'file-4')
			])
		);

		const result = await store.relieve();

		expect(result.outcome).toBe('swept');
		if (result.outcome !== 'swept') return;
		expect(result.removed).toEqual([{ db: A.db, personId: A.personId, fileId: 'file-5' }]);
		expect(result.before).toBeCloseTo(0.85, 10);
		expect(result.after).toBeCloseTo(0.8, 10);
		expect(adapter.rows().map((r) => r.fileId).sort()).toEqual([
			'file-1',
			'file-2',
			'file-3',
			'file-4'
		]);
	});
});

describe('#410 — retention scope is the PERSON, never the device (Gama ruling (b))', () => {
	it("two dbs of the SAME personId are both honoured; a DIFFERENT personId's row with the SAME fileId is evicted first", async () => {
		// The cache partition is (db, personId). Protect file-x under BOTH of
		// person-a's collectives; person-b holds the same fileId on the same
		// device, oldest of all — #334's fourth fence: her bytes stay evictable.
		await adapter.put(B.db, B.personId, 'file-x', seededRecord(50, 1000)); // NOT protected
		await adapter.put(A.db, A.personId, 'file-x', seededRecord(50, 2000)); // protected
		await adapter.put(C.db, C.personId, 'file-x', seededRecord(50, 3000)); // protected
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 700, 1000) });
		store.setProtectedKeys(
			new Set([pkey(A.db, A.personId, 'file-x'), pkey(C.db, C.personId, 'file-x')])
		);

		const result = await store.relieve();

		expect(result.outcome).toBe('swept');
		if (result.outcome !== 'swept') return;
		// person-b's row went FIRST (oldest candidate); both protected rows of
		// person-a survive, across her two collectives.
		expect(result.removed).toEqual([{ db: B.db, personId: B.personId, fileId: 'file-x' }]);
		expect(await store.heldFileIds(A.db, A.personId)).toEqual(['file-x']);
		expect(await store.heldFileIds(C.db, C.personId)).toEqual(['file-x']);
		expect(await store.heldFileIds(B.db, B.personId)).toEqual([]);
	});
});

describe('#410 — trigger: after every put, not only at app open', () => {
	it('a put over the pressure ratio sweeps as part of the put — and never evicts its own just-written row', async () => {
		// quota 1000: 3 seeded rows ×50 + 600 other = 750 (no pressure yet).
		// The put's own 50 lands → 800 = 0.8 ≥ PRESSURE_RATIO → sweep:
		// -50 → 0.75, -50 → 0.70 (not < 0.7), -50 → 0.65 → stop. All three
		// dormant rows go; the newcomer — the only remaining candidate on the
		// way — is the put's OWN row and must survive its own sweep.
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(50, 1000));
		await adapter.put(A.db, A.personId, 'file-2', seededRecord(50, 2000));
		await adapter.put(B.db, B.personId, 'file-3', seededRecord(50, 3000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 600, 1000) });

		await store.put(A, 'file-new', data(50));

		expect(adapter.rows().map((r) => r.fileId)).toEqual(['file-new']);
		expect(await store.usage()).toBe(50);
	});

	it('without an estimate seam, a put runs exactly the pre-#410 cap pass — no sweep, nothing removed under the cap', async () => {
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(50, 1000));
		const store = makeStore(adapter, { capBytes: 10_000 });

		await store.put(A, 'file-new', data(50));

		expect(adapter.rows().map((r) => r.fileId).sort()).toEqual(['file-1', 'file-new']);
	});
});

describe('#410 — a REAL QuotaExceededError on put: relieve once, retry once', () => {
	function quotaError() {
		return new DOMException('the quota has been exceeded', 'QuotaExceededError');
	}

	it('first attempt throws quota → the sweep frees the oldest candidate → the retry lands the row', async () => {
		// quota 1000: dormant row 50 + 800 other → the write that just failed
		// has a sweep-worthy origin (850 with the incoming row counted). The
		// dormant row is freed BETWEEN the two put attempts, and there are
		// exactly TWO attempts — one failure, one retry, never a loop.
		await adapter.put(A.db, A.personId, 'file-old', seededRecord(50, 1000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 800, 1000) });
		const realPut = adapter.put.bind(adapter);
		const putSpy = vi
			.spyOn(adapter, 'put')
			.mockImplementationOnce(async () => {
				throw quotaError();
			})
			.mockImplementation(realPut);
		const deleteSpy = vi.spyOn(adapter, 'delete');

		await store.put(A, 'file-new', data(50));

		// Both attempts were for the SAME row; the dormant row's delete sits
		// between them (fail → relieve → retry).
		const newPuts = putSpy.mock.calls.filter((c) => c[2] === 'file-new');
		expect(newPuts.length).toBe(2);
		expect(deleteSpy.mock.calls).toContainEqual([A.db, A.personId, 'file-old']);
		expect(deleteSpy.mock.invocationCallOrder[0]).toBeGreaterThan(putSpy.mock.invocationCallOrder[0]);
		expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(putSpy.mock.invocationCallOrder[1]);
		expect(adapter.rows().some((r) => r.fileId === 'file-new')).toBe(true);
		expect(adapter.rows().some((r) => r.fileId === 'file-old')).toBe(false);
	});

	// #410 review F3 — the recovery must NOT be the ratio-gated sweep. A real
	// QuotaExceededError is the platform saying the device is out of room, and
	// that outranks whatever estimate() reports: a browser that OVER-reports
	// quota (so the ratio sits well below PRESSURE_RATIO — here 0.15) is
	// exactly the one that raises the error early. Gated, the sweep freed
	// nothing and the single retry was guaranteed to fail identically. Every
	// other quota fixture in this file sits at ratio 0.85, so the gated path
	// was never exercised and passed either way.
	it('estimate reports a LOW ratio (0.15) and the put still throws quota → the dormant row is freed anyway, between the two attempts', async () => {
		// quota 1000, other-origin 100, one dormant 50-byte row → ratio 0.15,
		// nowhere near the 0.8 pressure line.
		await adapter.put(A.db, A.personId, 'file-old', seededRecord(50, 1000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 100, 1000) });
		const realPut = adapter.put.bind(adapter);
		const putSpy = vi
			.spyOn(adapter, 'put')
			.mockImplementationOnce(async () => {
				throw quotaError();
			})
			.mockImplementation(realPut);
		const deleteSpy = vi.spyOn(adapter, 'delete');

		await store.put(A, 'file-new', data(50));

		const newPuts = putSpy.mock.calls.filter((c) => c[2] === 'file-new');
		expect(newPuts.length).toBe(2);
		expect(deleteSpy.mock.calls).toEqual([[A.db, A.personId, 'file-old']]);
		expect(deleteSpy.mock.invocationCallOrder[0]).toBeGreaterThan(putSpy.mock.invocationCallOrder[0]);
		expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(putSpy.mock.invocationCallOrder[1]);
		expect(adapter.rows().map((r) => r.fileId)).toEqual(['file-new']);
	});

	it('the recovery frees at most what the incoming record needs — a second dormant row survives', async () => {
		// Two dormant rows, incoming record 50 bytes: freeing the oldest alone
		// already covers it, so the younger one is not collateral.
		await adapter.put(A.db, A.personId, 'file-old', seededRecord(50, 1000));
		await adapter.put(A.db, A.personId, 'file-younger', seededRecord(50, 2000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 100, 1000) });
		const realPut = adapter.put.bind(adapter);
		vi.spyOn(adapter, 'put')
			.mockImplementationOnce(async () => {
				throw quotaError();
			})
			.mockImplementation(realPut);

		await store.put(A, 'file-new', data(50));

		expect(adapter.rows().map((r) => r.fileId).sort()).toEqual(['file-new', 'file-younger']);
	});

	it('a PROTECTED row is never what the quota recovery frees — the retry fails rather than evict the next event’s part', async () => {
		await adapter.put(A.db, A.personId, 'file-next', seededRecord(50, 1000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 100, 1000) });
		store.setProtectedKeys(new Set([pkey(A.db, A.personId, 'file-next')]));
		vi.spyOn(adapter, 'put').mockImplementation(async () => {
			throw quotaError();
		});

		await expect(store.put(A, 'file-new', data(50))).rejects.toMatchObject({
			name: 'QuotaExceededError'
		});
		expect(await store.heldFileIds(A.db, A.personId)).toEqual(['file-next']);
	});

	it('still failing after the one retry → the error propagates (openFileBytes below owns the degradation)', async () => {
		await adapter.put(A.db, A.personId, 'file-old', seededRecord(50, 1000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 800, 1000) });
		const putSpy = vi.spyOn(adapter, 'put').mockImplementation(async () => {
			throw quotaError();
		});

		await expect(store.put(A, 'file-new', data(50))).rejects.toMatchObject({
			name: 'QuotaExceededError'
		});
		// ONE retry, never a loop: exactly two attempts for the row.
		expect(putSpy.mock.calls.filter((c) => c[2] === 'file-new').length).toBe(2);
	});

	it("INTEGRATION — a persistently-full device still opens the file: reason 'network-uncached', nothing thrown (#343's belt is the surface)", async () => {
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 800, 1000) });
		vi.spyOn(adapter, 'put').mockImplementation(async () => {
			throw quotaError();
		});
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-abc?X-Amz-Expires=60');
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		const fetchImpl = vi.fn(
			async () =>
				new Response(pdfBytes.slice(), {
					status: 200,
					headers: { 'content-type': 'application/pdf' }
				})
		);

		const opened = await openFileBytes(
			{ db: A.db, token: 'jwt-abc' },
			A,
			'file-1',
			store,
			fetchImpl as unknown as typeof fetch
		);

		expect(opened.reason).toBe('network-uncached');
		expect(opened.url).toMatch(/^blob:/);
		expect(adapter.rows()).toEqual([]);
		opened.release();
	});
});

describe('#410 — manual remove beats retention (#352 unchanged)', () => {
	it('clearPartition removes protected rows too — she asked for this device to forget them', async () => {
		await adapter.put(A.db, A.personId, 'file-next', seededRecord(50, 1000));
		await adapter.put(A.db, A.personId, 'file-other', seededRecord(50, 2000));
		await adapter.put(C.db, C.personId, 'file-keep', seededRecord(50, 3000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 0, 1000) });
		store.setProtectedKeys(
			new Set([pkey(A.db, A.personId, 'file-next'), pkey(C.db, C.personId, 'file-keep')])
		);

		await store.clearPartition(A.db, A.personId);

		expect(await store.heldFileIds(A.db, A.personId)).toEqual([]);
		expect(await store.heldFileIds(C.db, C.personId)).toEqual(['file-keep']);
	});

	it('clearAllPartitions removes EVERYTHING, protected included', async () => {
		await adapter.put(A.db, A.personId, 'file-next', seededRecord(50, 1000));
		await adapter.put(B.db, B.personId, 'file-b', seededRecord(50, 2000));
		const store = makeStore(adapter, { capBytes: 10_000 });
		store.setProtectedKeys(new Set([pkey(A.db, A.personId, 'file-next')]));

		await store.clearAllPartitions();

		expect(adapter.rows()).toEqual([]);
	});
});

describe('#410 — estimate() absent: relieve is a supported no-op that says so', () => {
	it("node has no navigator.storage (the precondition this seam exists for)", () => {
		expect(globalThis.navigator?.storage).toBeUndefined();
	});

	it("no injected estimate and no platform StorageManager → { outcome: 'unsupported' }, nothing deleted, nothing thrown", async () => {
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(50, 1000));
		const store = makeStore(adapter, { capBytes: 10_000 });
		const deleteSpy = vi.spyOn(adapter, 'delete');

		const result = await store.relieve();

		expect(result).toEqual({ outcome: 'unsupported' });
		expect(deleteSpy).not.toHaveBeenCalled();
		expect(adapter.rows().map((r) => r.fileId)).toEqual(['file-1']);
	});
});

describe('#410 — recency is a record of USE, not of display (the #367 trap, applied to the sweep)', () => {
	it('a full relieve() moves ZERO recency stamps and calls get() ZERO times — listMeta and delete are its whole vocabulary', async () => {
		await adapter.put(A.db, A.personId, 'file-1', seededRecord(50, 1000));
		await adapter.put(A.db, A.personId, 'file-2', seededRecord(50, 2000));
		await adapter.put(C.db, C.personId, 'file-3', seededRecord(50, 3000));
		await adapter.put(A.db, A.personId, 'file-4', seededRecord(50, 4000));
		await adapter.put(A.db, A.personId, 'file-5', seededRecord(50, 5000));
		const store = makeStore(adapter, { capBytes: 10_000, estimate: estimateOver(adapter, 600, 1000) });
		const getSpy = vi.spyOn(adapter, 'get');
		const listSpy = vi.spyOn(adapter, 'list');
		const touchesBefore = adapter.touchLog.length;

		const result = await store.relieve();

		expect(result.outcome).toBe('swept');
		// The sweep evicted (file-1..file-4, per the eviction fixture above) —
		// and moved NOTHING it did not evict: the survivor's stamp is exactly
		// as seeded. A sweep that stamps a row it read is RED here.
		expect(adapter.touchLog.length).toBe(touchesBefore);
		expect(getSpy).not.toHaveBeenCalled();
		expect(listSpy).not.toHaveBeenCalled();
		expect(adapter.rows().map((r) => ({ fileId: r.fileId, openedAt: r.record.openedAt }))).toEqual([
			{ fileId: 'file-5', openedAt: 5000 }
		]);
	});
});

describe('#410 — source pins: the seam is declared where the next caller meets it', () => {
	const source = readFileSync(fileURLToPath(new URL('./byteStore.ts', String(import.meta.url))), 'utf-8');

	it('the ByteStore interface declares relieve() and setProtectedKeys()', () => {
		expect(source).toMatch(/relieve\(\): Promise</);
		expect(source).toMatch(/setProtectedKeys\(keys: ReadonlySet<string>\): void/);
	});

	it('the default estimate is navigator.storage?.estimate — the injectable seam, not a hard platform dependency', () => {
		expect(source).toMatch(/navigator\.storage/);
	});

	it('PRESSURE_RATIO is exported from the module source', () => {
		expect(source).toMatch(/export const PRESSURE_RATIO = 0\.8/);
	});
});

// (*MVOX:Tallis*)
