// #352 RED — the STORE half of "Remove downloaded parts from this device"
// (profile storage section): scoped usage queries + the device-wide clear.
//
// WHAT THIS ADDS AND WHAT IT MUST NOT TOUCH:
//
//   - usage() is PINNED byte-exact as the GLOBAL sum across ALL partitions
//     (byteStore.spec.ts "usage sums stored byte sizes across ALL
//     partitions") — it is NOT repurposed here. The profile section needs a
//     partition-scoped answer AND an everything-else aggregate, so the
//     interface gains TWO NEW members:
//
//       usageForPartition(db, personId): Promise<{ count: number; size: number }>
//       usageForOthers(db, personId): Promise<{ count: number; size: number }>
//
//     "Others" means every row whose (db, personId) is NOT the asked pair —
//     which INCLUDES the same human's partition in another collective
//     (identity C below): partitions are (db, personId), and the profile
//     section's "everything else on this device" bucket is a statement about
//     the DEVICE, not about the human (issue #352's ruling).
//
//   - Both queries obey #351's law: they are NOT opens. No adapter.touch, no
//     recency movement, no re-put — a usage read on every profile render that
//     stamped rows as opened would corrupt LRU eviction order exactly the way
//     a get()-based presence check would have (byteStore.presence.spec.ts).
//     Unlike heldFileIds they MAY go through adapter.list() — the answer
//     needs record.size, which keys do not carry, and this runs on the
//     profile page's storage section, not on every list row render.
//
//   - clearAllPartitions(): Promise<void> — the "Remove everything downloaded
//     on this device" mechanism: empties EVERY partition, including ones
//     belonging to identities not signed in. Like clearPartition it works
//     from KEYS alone (deleting bytes never needs to read them — #351 review
//     finding 2, pinned for clearPartition in byteStore.presence.spec.ts).
//
//   - NOTHING here wires ANY clear to an auth path. clearPartition /
//     clearAllPartitions remain bare mechanisms; the #343 RETAIN suite
//     (src/lib/auth/storage.spec.ts, incl. its STRUCTURAL source grep) must
//     pass UNMODIFIED alongside this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createByteStore, type ByteStore, type StoredFileRecord } from './byteStore';
import {
	createFakeAdapter,
	createFakeByteStore,
	type FakeAdapter
} from '$lib/testing/byteStoreFakes';

/** The #352 contract shape — an intersection until byteStore.ts declares it
 *  (the source pins below hold the interface itself to account). */
type StorageControlCapable = ByteStore & {
	usageForPartition(db: string, personId: string): Promise<{ count: number; size: number }>;
	usageForOthers(db: string, personId: string): Promise<{ count: number; size: number }>;
	clearAllPartitions(): Promise<void>;
};

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
 *  bypasses store.put so each openedAt stamp is EXPLICIT and assertable
 *  (the byteStore.presence.spec.ts idiom). */
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
let store: StorageControlCapable;

/** A holds 10+20, B holds 5, C holds 30 — every partition-vs-others split
 *  below is computable by hand from these four rows. */
async function seedThreePartitions(): Promise<void> {
	await adapter.put(A.db, A.personId, 'file-a1', seededRecord(10, 1000));
	await adapter.put(A.db, A.personId, 'file-a2', seededRecord(20, 2000));
	await adapter.put(B.db, B.personId, 'file-b1', seededRecord(5, 3000));
	await adapter.put(C.db, C.personId, 'file-c1', seededRecord(30, 4000));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));
	adapter = createFakeAdapter();
	store = createByteStore(adapter, { capBytes: 100 }) as StorageControlCapable;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('#352 — scoped usage: one partition vs everything else (full-shape answers)', () => {
	it('usageForPartition answers {count, size} for exactly the asked (db, personId)', async () => {
		await seedThreePartitions();
		// Full-shape toEqual — never a partial contains-check (the
		// partial-assertions lesson).
		expect(await store.usageForPartition(A.db, A.personId)).toEqual({ count: 2, size: 30 });
		expect(await store.usageForPartition(B.db, B.personId)).toEqual({ count: 1, size: 5 });
		expect(await store.usageForPartition(C.db, C.personId)).toEqual({ count: 1, size: 30 });
	});

	it('usageForOthers aggregates every OTHER partition — INCLUDING the same human in another collective (identity C)', async () => {
		await seedThreePartitions();
		// Asked as A (the signed-in identity): others = B (5) + C (30). C is the
		// SAME personId in a different db — it must land in the others bucket,
		// because the partition key is the pair, not the person.
		expect(await store.usageForOthers(A.db, A.personId)).toEqual({ count: 2, size: 35 });
		// Asked as C: others = A (10+20) + B (5).
		expect(await store.usageForOthers(C.db, C.personId)).toEqual({ count: 3, size: 35 });
	});

	it('an empty store and an unknown partition answer {count: 0, size: 0} — never throw, never undefined', async () => {
		expect(await store.usageForPartition(A.db, A.personId)).toEqual({ count: 0, size: 0 });
		expect(await store.usageForOthers(A.db, A.personId)).toEqual({ count: 0, size: 0 });
		await seedThreePartitions();
		expect(await store.usageForPartition('sampledb', 'person-nobody')).toEqual({
			count: 0,
			size: 0
		});
	});

	it('partition + others always reconciles with the PINNED global usage() — no row counted twice, none dropped', async () => {
		await seedThreePartitions();
		const mine = await store.usageForPartition(A.db, A.personId);
		const others = await store.usageForOthers(A.db, A.personId);
		expect(mine.size + others.size).toBe(await store.usage());
		expect(mine.count + others.count).toBe((await adapter.listKeys()).length);
	});
});

describe('#352 — scoped usage is NOT an open (#351 law: reads move no recency)', () => {
	it('repeated usage queries: touchLog untouched, no re-put, every openedAt stamp exactly as seeded', async () => {
		await seedThreePartitions();
		const putsAfterSeeding = adapter.putLog.length;

		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(1000); // time passes between renders
			await store.usageForPartition(A.db, A.personId);
			await store.usageForOthers(A.db, A.personId);
		}

		expect(adapter.touchLog).toEqual([]);
		expect(adapter.putLog.length).toBe(putsAfterSeeding);
		expect(
			adapter.rows().map((r) => ({ fileId: r.fileId, openedAt: r.record.openedAt }))
		).toEqual([
			{ fileId: 'file-a1', openedAt: 1000 },
			{ fileId: 'file-a2', openedAt: 2000 },
			{ fileId: 'file-b1', openedAt: 3000 },
			{ fileId: 'file-c1', openedAt: 4000 }
		]);
	});
});

describe('#352 — remove-mine at the store level: clearPartition moves the numbers, misses on the next get', () => {
	it('after clearPartition(A): global usage drops by exactly A\'s size, A answers zero, others unchanged', async () => {
		await seedThreePartitions();
		expect(await store.usage()).toBe(65);

		await store.clearPartition(A.db, A.personId);

		expect(await store.usage()).toBe(35);
		expect(await store.usageForPartition(A.db, A.personId)).toEqual({ count: 0, size: 0 });
		// The others-aggregate FROM A's seat is untouched — nothing of B's or
		// C's went with A's rows.
		expect(await store.usageForOthers(A.db, A.personId)).toEqual({ count: 2, size: 35 });
		// The next get() of a removed id MISSES — the refetch path at this
		// level is exactly "undefined, go to the network".
		expect(await store.get(A, 'file-a1')).toBeUndefined();
		expect(await store.get(A, 'file-a2')).toBeUndefined();
		expect(await store.get(B, 'file-b1')).toBeDefined();
		expect(await store.get(C, 'file-c1')).toBeDefined();
	});
});

describe('#352 — clearAllPartitions: the device-wide wipe, signed-in or not', () => {
	it('empties EVERY partition — including ones belonging to identities not signed in', async () => {
		await seedThreePartitions();

		await store.clearAllPartitions();

		expect(adapter.rows()).toEqual([]);
		expect(await store.usage()).toBe(0);
		expect(await store.usageForPartition(A.db, A.personId)).toEqual({ count: 0, size: 0 });
		expect(await store.usageForOthers(A.db, A.personId)).toEqual({ count: 0, size: 0 });
		expect(await store.heldFileIds(B.db, B.personId)).toEqual([]);
		expect(await store.get(A, 'file-a1')).toBeUndefined();
		expect(await store.get(B, 'file-b1')).toBeUndefined();
		expect(await store.get(C, 'file-c1')).toBeUndefined();
	});

	it('works from KEYS alone — deleting bytes never needs to read them (#351 review finding 2, the clearPartition law)', async () => {
		await seedThreePartitions();
		const listSpy = vi.spyOn(adapter, 'list');

		await store.clearAllPartitions();

		expect(listSpy).not.toHaveBeenCalled();
		expect(adapter.rows()).toEqual([]);
	});

	it('on an empty store it is a no-op, not a throw', async () => {
		await expect(store.clearAllPartitions()).resolves.toBeUndefined();
		expect(adapter.rows()).toEqual([]);
	});
});

describe('#352 — the fake store implements the SAME members (reconciled, not a divergent duplicate)', () => {
	it('createFakeByteStore(): usageForPartition / usageForOthers answer the seeded state, full shape', async () => {
		const fake = createFakeByteStore() as unknown as ReturnType<typeof createFakeByteStore> &
			StorageControlCapable;
		fake.seed({ db: 'sampledb', personId: 'person-a' }, 'file-1', data(10));
		fake.seed({ db: 'sampledb', personId: 'person-a' }, 'file-2', data(20));
		fake.seed({ db: 'sampledb', personId: 'person-b' }, 'file-3', data(5));
		fake.seed({ db: 'crede', personId: 'person-a' }, 'file-4', data(30));

		expect(await fake.usageForPartition('sampledb', 'person-a')).toEqual({
			count: 2,
			size: 30
		});
		expect(await fake.usageForOthers('sampledb', 'person-a')).toEqual({ count: 2, size: 35 });
	});

	it('createFakeByteStore(): clearAllPartitions empties every partition', async () => {
		const fake = createFakeByteStore() as unknown as ReturnType<typeof createFakeByteStore> &
			StorageControlCapable;
		fake.seed({ db: 'sampledb', personId: 'person-a' }, 'file-1', data(10));
		fake.seed({ db: 'crede', personId: 'person-a' }, 'file-2', data(30));

		await fake.clearAllPartitions();

		expect(fake.heldFor('sampledb', 'person-a')).toEqual([]);
		expect(fake.heldFor('crede', 'person-a')).toEqual([]);
		expect(await fake.usage()).toBe(0);
	});
});

describe('#352 — source pins: the members sit on the REAL interface; usage() itself is untouched', () => {
	const source = readFileSync(fileURLToPath(new URL('./byteStore.ts', import.meta.url)), 'utf-8');

	it('the ByteStore interface declares the two scoped-usage members and the device-wide clear', () => {
		expect(source).toMatch(/usageForPartition\(db: string, personId: string\): Promise</);
		expect(source).toMatch(/usageForOthers\(db: string, personId: string\): Promise</);
		expect(source).toMatch(/clearAllPartitions\(\): Promise<void>/);
	});

	it('the global usage() signature survives unrepurposed — no parameters grew on it', () => {
		expect(source).toMatch(/usage\(\): Promise<number>/);
	});

	it('the adapter seam DECLARES the metadata read, so no implementation can quietly answer a size sum from rows', () => {
		expect(source).toMatch(/listMeta\(\): Promise<ByteStoreMeta\[\]>/);
	});

	it('the policy core CALLS adapter.list() nowhere — the grep, not just the spies', () => {
		// The spies below prove it for the paths this file drives; this pins it
		// for the whole module, so a future size question cannot quietly reach
		// for rows again. Matched on the call form (`await adapter.list()`) —
		// every adapter call in that module is awaited, and the prose around
		// them names the method freely.
		expect(source).not.toMatch(/await adapter\.list\(\)/);
	});
});

// #352 REVIEW — THE OOM FINDING. loadStorageSection fires usageForPartition
// and usageForOthers CONCURRENTLY on every profile load, and again after every
// remove-confirm. Both went through adapter.list(), which in idbAdapter is
// PAYLOAD_STORE.getAll() — structured-clone-deserialising every stored
// ArrayBuffer. Against a full store (BYTE_STORE_CAP_BYTES = 200MB) that is two
// simultaneous 200MB heap allocations, ~400MB peak on a phone, purely to sum
// two complementary columns of record.size. The sizes now come from
// adapter.listMeta() — keys + size + stamp, no payload touched.
describe('#352 review — every size sum reads METADATA, never payloads', () => {
	it('usageForPartition and usageForOthers go through adapter.listMeta and NEVER adapter.list', async () => {
		await seedThreePartitions();
		const listSpy = vi.spyOn(adapter, 'list');
		const listMetaSpy = vi.spyOn(adapter, 'listMeta');

		expect(await store.usageForPartition(A.db, A.personId)).toEqual({ count: 2, size: 30 });
		expect(await store.usageForOthers(A.db, A.personId)).toEqual({ count: 2, size: 35 });

		expect(listSpy).not.toHaveBeenCalled();
		expect(listMetaSpy).toHaveBeenCalledTimes(2);
	});

	it('the global usage() sum reads metadata too — it is the same column of numbers', async () => {
		await seedThreePartitions();
		const listSpy = vi.spyOn(adapter, 'list');

		expect(await store.usage()).toBe(65);

		expect(listSpy).not.toHaveBeenCalled();
	});

	it('the cap/eviction pass on put() reads metadata — a download must not pull every OTHER cached score into the heap', async () => {
		await seedThreePartitions(); // 65 of a 100-byte cap held
		const listSpy = vi.spyOn(adapter, 'list');

		// 65 + 50 > 100 → evicts globally-oldest (file-a1, stamp 1000) and, still
		// over, file-a2 (2000). The eviction decision itself is the thing that
		// must be reachable without the bytes.
		await store.put(A, 'file-new', data(50));

		expect(listSpy).not.toHaveBeenCalled();
		expect(
			adapter
				.rows()
				.map((r) => r.fileId)
				.sort()
		).toEqual(['file-b1', 'file-c1', 'file-new']);
		expect(await store.usage()).toBe(85);
	});

	it('a profile load is survivable at the cap: the two usage reads deserialise NOT ONE stored ArrayBuffer', async () => {
		// The failure this fix exists for, stated as bytes rather than as call
		// counts: seed near the cap, then count what the reads actually pull.
		await adapter.put(A.db, A.personId, 'file-big-a', seededRecord(40, 1000));
		await adapter.put(B.db, B.personId, 'file-big-b', seededRecord(40, 2000));

		let bytesRead = 0;
		const realList = adapter.list.bind(adapter);
		vi.spyOn(adapter, 'list').mockImplementation(async () => {
			const rows = await realList();
			bytesRead += rows.reduce((sum, r) => sum + r.record.bytes.byteLength, 0);
			return rows;
		});

		const [mine, others] = await Promise.all([
			store.usageForPartition(A.db, A.personId),
			store.usageForOthers(A.db, A.personId)
		]);

		expect(mine).toEqual({ count: 1, size: 40 });
		expect(others).toEqual({ count: 1, size: 40 });
		expect(bytesRead).toBe(0);
	});
});

// (*MVOX:Tallis*)
