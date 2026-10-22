// #353, #427: the part-label store, and the call sites that hand it a name.
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdbLabelStore, LABEL_DB_NAME } from './labelIdbStore';
import { recordPartLabel, storedPartLabel, type LabelStore, type PartLabel } from './labelStore';
import { createByteStore } from './byteStore';
import { createIdbAdapter } from './idbAdapter';
import { createFakeAdapter } from '$lib/testing/byteStoreFakes';

const IDENTITY = { db: 'sampledb', personId: 'person-1' };

const LABEL: PartLabel = {
	work: 'Bogoróditse Djévo',
	composer: 'Arvo Pärt',
	edition: 'SATB 1990',
	filename: 'bogoroditse-sopran.pdf'
};

function bytes(fill: number, size = 16): { bytes: ArrayBuffer; filetype: string; sha256: string } {
	return {
		bytes: new Uint8Array(size).fill(fill).buffer,
		filetype: 'application/pdf',
		sha256: `sha-${fill}`
	};
}

beforeEach(() => {
	vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('#353 — the label database is a SIBLING, never the byte store (the flush-on-bump fact)', () => {
	it('names its own database', () => {
		expect(LABEL_DB_NAME).toBe('mvox-label-index');
		expect(LABEL_DB_NAME).not.toBe('mvox-byte-store');
	});

	it('opening and writing the label DB leaves the byte store untouched (spike probe C)', async () => {
		const factory = new IDBFactory();
		const byteStore = createByteStore(createIdbAdapter(factory));
		await byteStore.put({ ...IDENTITY, fileId: 'file-a' }, bytes(5));

		const labels = createIdbLabelStore(factory);
		await labels.putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);

		expect(await byteStore.heldFileIds({ db: 'sampledb', personId: 'person-1' })).toEqual(['file-a']);
		const record = await byteStore.get({ ...IDENTITY, fileId: 'file-a' });
		expect(Array.from(new Uint8Array(record!.bytes))).toEqual(new Array(16).fill(5));
	});
});

describe('#353 — labels survive restart and read back with zero network', () => {
	it('a label written through one connection reads back VERBATIM from a cold one (the restart seam)', async () => {
		const factory = new IDBFactory();
		const writer = createIdbLabelStore(factory);
		await writer.putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);

		const reader = createIdbLabelStore(factory);
		const held = await reader.labelsFor({ db: 'sampledb', personId: 'person-1' });
		expect(held.get('file-a')).toEqual({
			work: 'Bogoróditse Djévo',
			composer: 'Arvo Pärt',
			edition: 'SATB 1990',
			filename: 'bogoroditse-sopran.pdf'
		});
		expect(held.size).toBe(1);
	});

	it('labelsFor answers with a fetch that THROWS if called — the read path owes the network nothing', async () => {
		vi.stubGlobal('fetch', () => {
			throw new Error('#353: label read touched the network');
		});
		const factory = new IDBFactory();
		const store = createIdbLabelStore(factory);
		await store.putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);
		const held = await store.labelsFor({ db: 'sampledb', personId: 'person-1' });
		expect(held.get('file-a')).toEqual(LABEL);
	});

	it('labels are partitioned by (db, personId) — one identity never reads another\'s names', async () => {
		const factory = new IDBFactory();
		const store = createIdbLabelStore(factory);
		await store.putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);
		await store.putLabel({ db: 'crede', personId: 'person-2', fileId: 'file-b' }, {
			work: 'Other',
			composer: 'Other',
			edition: '',
			filename: 'other.pdf'
		});
		const held = await store.labelsFor({ db: 'sampledb', personId: 'person-1' });
		expect([...held.keys()]).toEqual(['file-a']);
	});

	it('a second person in the same db is excluded', async () => {
		const store = createIdbLabelStore(new IDBFactory());
		await store.putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);
		await store.putLabel({ db: 'sampledb', personId: 'person-2', fileId: 'file-b' }, LABEL);
		const held = await store.labelsFor({ db: 'sampledb', personId: 'person-1' });
		expect([...held.keys()]).toEqual(['file-a']);
	});

	it('the same person in another db is excluded', async () => {
		const store = createIdbLabelStore(new IDBFactory());
		await store.putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);
		await store.putLabel({ db: 'crede', personId: 'person-1', fileId: 'file-c' }, LABEL);
		const held = await store.labelsFor({ db: 'sampledb', personId: 'person-1' });
		expect([...held.keys()]).toEqual(['file-a']);
	});
});

describe('#1021 — reads touch only the rows they answer for', () => {
	const NEIGHBOURS = [
		{ db: 'sampledb', personId: 'person-10', fileId: 'file-x' },
		{ db: 'sampledb', personId: 'person-2', fileId: 'file-y' },
		{ db: 'crede', personId: 'person-1', fileId: 'file-z' }
	];

	async function seeded(): Promise<LabelStore> {
		const store = createIdbLabelStore(new IDBFactory());
		await store.putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);
		await store.putLabel({ ...IDENTITY, fileId: 'file-b' }, { ...LABEL, filename: 'b.pdf' });
		for (const key of NEIGHBOURS) await store.putLabel(key, { ...LABEL, filename: 'other.pdf' });
		return store;
	}

	it('naming one file reads that one row and lists nothing', async () => {
		const store = await seeded();
		const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
		const get = vi.spyOn(IDBObjectStore.prototype, 'get');
		expect(await storedPartLabel(store, { ...IDENTITY, fileId: 'file-b' })).toEqual({ ...LABEL, filename: 'b.pdf' });
		expect(await storedPartLabel(store, { ...IDENTITY, fileId: 'file-none' })).toBeUndefined();
		expect(getAll).not.toHaveBeenCalled();
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("listing a person's labels reads only that person's rows", async () => {
		const store = await seeded();
		const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
		const held = await store.labelsFor(IDENTITY);
		expect([...held.keys()].sort()).toEqual(['file-a', 'file-b']);
		const rowsRead = getAll.mock.results.map((r) => (r.value as IDBRequest<unknown[]>).result.length);
		expect(rowsRead).toEqual([2]);
	});
});

describe('#353 — recordPartLabel: the put-time write, gated on DELIVERY reason', () => {
	it('writes for network-stored and cache; never for network-uncached or fallback-navigation', async () => {
		const factory = new IDBFactory();
		const store = createIdbLabelStore(factory);

		await Promise.all([
			recordPartLabel(store, { ...IDENTITY, fileId: 'file-uncached' }, { ...LABEL, filename: 'u.pdf' }, 'network-uncached'),
			recordPartLabel(store, { ...IDENTITY, fileId: 'file-fallback' }, { ...LABEL, filename: 'f.pdf' }, 'fallback-navigation'),
			recordPartLabel(store, { ...IDENTITY, fileId: 'file-stored' }, { ...LABEL, filename: 's.pdf' }, 'network-stored'),
			recordPartLabel(store, { ...IDENTITY, fileId: 'file-cached' }, { ...LABEL, filename: 'c.pdf' }, 'cache')
		]);

		const held = await store.labelsFor({ db: 'sampledb', personId: 'person-1' });
		expect([...held.keys()].sort()).toEqual(['file-cached', 'file-stored']);
	});

	it('never throws and never rejects into the caller — a label write failure cannot gate delivery (#343: the cache is never a gate)', async () => {
		const store: LabelStore = {
			async putLabel() {
				throw new Error('idb dead');
			},
			async remove() {
				throw new Error('idb dead');
			},
			async labelOf() {
				return undefined;
			},
			async labelsFor() {
				return new Map();
			}
		};
		await expect(
			recordPartLabel(store, { ...IDENTITY, fileId: 'file-a' }, LABEL, 'network-stored')
		).resolves.toBeUndefined();
	});
});

describe('#353 — eager label removal rides the byte-row lifecycle (opts.onRowRemoved seam)', () => {
	it('evict reports the removed key', async () => {
		const onRowRemoved = vi.fn();
		const store = createByteStore(createFakeAdapter(), { onRowRemoved });
		await store.put({ ...IDENTITY, fileId: 'file-a' }, bytes(1));
		await store.evict({ ...IDENTITY, fileId: 'file-a' });
		expect(onRowRemoved.mock.calls).toEqual([
			[{ db: 'sampledb', personId: 'person-1', fileId: 'file-a' }]
		]);
	});

	it('clearPartition reports each removed key of THAT partition and no other', async () => {
		const onRowRemoved = vi.fn();
		const store = createByteStore(createFakeAdapter(), { onRowRemoved });
		await store.put({ ...IDENTITY, fileId: 'file-a' }, bytes(1));
		await store.put({ ...IDENTITY, fileId: 'file-b' }, bytes(2));
		await store.put({ db: 'crede', personId: 'person-2', fileId: 'file-c' }, bytes(3));
		await store.clearPartition({ db: 'sampledb', personId: 'person-1' });
		expect(onRowRemoved.mock.calls.map(([key]) => key).sort((a, b) => a.fileId.localeCompare(b.fileId))).toEqual([
			{ db: 'sampledb', personId: 'person-1', fileId: 'file-a' },
			{ db: 'sampledb', personId: 'person-1', fileId: 'file-b' }
		]);
	});

	it('clearAllPartitions reports every key on the device', async () => {
		const onRowRemoved = vi.fn();
		const store = createByteStore(createFakeAdapter(), { onRowRemoved });
		await store.put({ ...IDENTITY, fileId: 'file-a' }, bytes(1));
		await store.put({ db: 'crede', personId: 'person-2', fileId: 'file-c' }, bytes(3));
		await store.clearAllPartitions();
		expect(onRowRemoved.mock.calls.map(([key]) => key).sort((a, b) => a.fileId.localeCompare(b.fileId))).toEqual([
			{ db: 'sampledb', personId: 'person-1', fileId: 'file-a' },
			{ db: 'crede', personId: 'person-2', fileId: 'file-c' }
		]);
	});

	it('an over-cap put reports the LRU rows it silently evicts — the unbounded-orphan leak, closed', async () => {
		vi.useFakeTimers();
		const onRowRemoved = vi.fn();
		const store = createByteStore(createFakeAdapter(), { capBytes: 100, onRowRemoved });
		vi.setSystemTime(1_000);
		await store.put({ ...IDENTITY, fileId: 'file-old' }, bytes(1, 60));
		vi.setSystemTime(2_000);
		await store.put({ ...IDENTITY, fileId: 'file-new' }, bytes(2, 60));
		expect(onRowRemoved.mock.calls).toEqual([
			[{ db: 'sampledb', personId: 'person-1', fileId: 'file-old' }]
		]);
	});
});

describe('#353 — StoredFileRecord is UNCHANGED: no title, no label, byteStore.ts stays policy-only', () => {
	it('the persisted record is exactly the five #343 fields — full-shape toEqual', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_757_000_000_000);
		const adapter = createFakeAdapter();
		const store = createByteStore(adapter);
		const payload = new Uint8Array(16).fill(7).buffer;
		await store.put({ ...IDENTITY, fileId: 'file-a' }, { bytes: payload, filetype: 'application/pdf', sha256: 'sha-7' });

		expect(adapter.putLog).toHaveLength(1);
		expect(adapter.putLog[0].record).toEqual({
			bytes: payload,
			filetype: 'application/pdf',
			sha256: 'sha-7',
			size: 16,
			openedAt: 1_757_000_000_000
		});
		expect(Object.keys(adapter.putLog[0].record).sort()).toEqual([
			'bytes',
			'filetype',
			'openedAt',
			'sha256',
			'size'
		]);
	});
});

describe('#353 — composition: the app byte store removes the label when it removes the bytes', () => {
	it('clearing a partition through the app byte store empties that partition in the app label store', async () => {
		vi.stubGlobal('indexedDB', new IDBFactory());
		vi.resetModules();
		const { getAppByteStore } = await import('./appByteStore');
		const { getAppLabelStore } = await import('./appLabelStore');
		await getAppByteStore().put({ ...IDENTITY, fileId: 'file-a' }, bytes(5));
		await getAppLabelStore().putLabel({ ...IDENTITY, fileId: 'file-a' }, LABEL);
		expect(await getAppLabelStore().labelsFor({ db: 'sampledb', personId: 'person-1' })).toEqual(
			new Map([['file-a', LABEL]])
		);

		await getAppByteStore().clearPartition({ db: 'sampledb', personId: 'person-1' });

		await vi.waitFor(async () =>
			expect(await getAppLabelStore().labelsFor({ db: 'sampledb', personId: 'person-1' })).toEqual(new Map())
		);
	});
});

// (*MVOX:Tallis* — #353 RED)
