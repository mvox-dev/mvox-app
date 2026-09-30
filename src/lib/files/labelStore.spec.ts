// #353, #427: the part-label store, and the call sites that hand it a name.
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabelIdbAdapter, LABEL_DB_NAME } from './labelIdbAdapter';
import { createLabelStore, recordPartLabel, type PartLabel } from './labelStore';
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

afterEach(() => {
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
		await byteStore.put(IDENTITY, 'file-a', bytes(5));

		const labels = createLabelStore(createLabelIdbAdapter(factory));
		await labels.putLabel(IDENTITY, 'file-a', LABEL);

		expect(await byteStore.heldFileIds('sampledb', 'person-1')).toEqual(['file-a']);
		const record = await byteStore.get(IDENTITY, 'file-a');
		expect(Array.from(new Uint8Array(record!.bytes))).toEqual(new Array(16).fill(5));
	});
});

describe('#353 — labels survive restart and read back with zero network', () => {
	it('a label written through one connection reads back VERBATIM from a cold one (the restart seam)', async () => {
		const factory = new IDBFactory();
		const writer = createLabelStore(createLabelIdbAdapter(factory));
		await writer.putLabel(IDENTITY, 'file-a', LABEL);

		const reader = createLabelStore(createLabelIdbAdapter(factory));
		const held = await reader.labelsFor('sampledb', 'person-1');
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
		const store = createLabelStore(createLabelIdbAdapter(factory));
		await store.putLabel(IDENTITY, 'file-a', LABEL);
		const held = await store.labelsFor('sampledb', 'person-1');
		expect(held.get('file-a')).toEqual(LABEL);
	});

	it('labels are partitioned by (db, personId) — one identity never reads another\'s names', async () => {
		const factory = new IDBFactory();
		const store = createLabelStore(createLabelIdbAdapter(factory));
		await store.putLabel(IDENTITY, 'file-a', LABEL);
		await store.putLabel({ db: 'crede', personId: 'person-2' }, 'file-b', {
			work: 'Other',
			composer: 'Other',
			edition: '',
			filename: 'other.pdf'
		});
		const held = await store.labelsFor('sampledb', 'person-1');
		expect([...held.keys()]).toEqual(['file-a']);
	});

	it('a null identity THROWS — same law as the byte store, no anonymous partition key', async () => {
		const store = createLabelStore(createLabelIdbAdapter(new IDBFactory()));
		await expect(store.putLabel(null, 'file-a', LABEL)).rejects.toThrow(/identity/i);
	});
});

describe('#353 — recordPartLabel: the put-time write, gated on DELIVERY reason', () => {
	it('writes for network-stored and cache; never for network-uncached or fallback-navigation', async () => {
		const factory = new IDBFactory();
		const store = createLabelStore(createLabelIdbAdapter(factory));

		recordPartLabel(store, IDENTITY, 'file-uncached', { ...LABEL, filename: 'u.pdf' }, 'network-uncached');
		recordPartLabel(store, IDENTITY, 'file-fallback', { ...LABEL, filename: 'f.pdf' }, 'fallback-navigation');
		recordPartLabel(store, IDENTITY, 'file-stored', { ...LABEL, filename: 's.pdf' }, 'network-stored');
		recordPartLabel(store, IDENTITY, 'file-cached', { ...LABEL, filename: 'c.pdf' }, 'cache');

		await vi.waitFor(async () => {
			const held = await store.labelsFor('sampledb', 'person-1');
			expect([...held.keys()].sort()).toEqual(['file-cached', 'file-stored']);
		});
	});

	it('never throws and never rejects into the caller — a label write failure cannot gate delivery (#343: the cache is never a gate)', async () => {
		const store = createLabelStore({
			async get() {
				return undefined;
			},
			async put() {
				throw new Error('idb dead');
			},
			async delete() {
				throw new Error('idb dead');
			},
			async listFor() {
				return [];
			}
		});
		expect(() => recordPartLabel(store, IDENTITY, 'file-a', LABEL, 'network-stored')).not.toThrow();
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
	});
});

describe('#353 — eager label removal rides the byte-row lifecycle (opts.onRowRemoved seam)', () => {
	it('evict reports the removed key', async () => {
		const onRowRemoved = vi.fn();
		const store = createByteStore(createFakeAdapter(), { onRowRemoved });
		await store.put(IDENTITY, 'file-a', bytes(1));
		await store.evict(IDENTITY, 'file-a');
		expect(onRowRemoved.mock.calls).toEqual([
			[{ db: 'sampledb', personId: 'person-1', fileId: 'file-a' }]
		]);
	});

	it('clearPartition reports each removed key of THAT partition and no other', async () => {
		const onRowRemoved = vi.fn();
		const store = createByteStore(createFakeAdapter(), { onRowRemoved });
		await store.put(IDENTITY, 'file-a', bytes(1));
		await store.put(IDENTITY, 'file-b', bytes(2));
		await store.put({ db: 'crede', personId: 'person-2' }, 'file-c', bytes(3));
		await store.clearPartition('sampledb', 'person-1');
		expect(onRowRemoved.mock.calls.map(([key]) => key).sort((a, b) => a.fileId.localeCompare(b.fileId))).toEqual([
			{ db: 'sampledb', personId: 'person-1', fileId: 'file-a' },
			{ db: 'sampledb', personId: 'person-1', fileId: 'file-b' }
		]);
	});

	it('clearAllPartitions reports every key on the device', async () => {
		const onRowRemoved = vi.fn();
		const store = createByteStore(createFakeAdapter(), { onRowRemoved });
		await store.put(IDENTITY, 'file-a', bytes(1));
		await store.put({ db: 'crede', personId: 'person-2' }, 'file-c', bytes(3));
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
		await store.put(IDENTITY, 'file-old', bytes(1, 60));
		vi.setSystemTime(2_000);
		await store.put(IDENTITY, 'file-new', bytes(2, 60));
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
		await store.put(IDENTITY, 'file-a', { bytes: payload, filetype: 'application/pdf', sha256: 'sha-7' });

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

describe('#353 — composition + call sites: the label index is WIRED, not beside the app', () => {
	const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

	it('appByteStore wires onRowRemoved to the label store — eviction anywhere removes the name', () => {
		const source = src('src/lib/files/appByteStore.ts');
		expect(source).toContain('onRowRemoved');
		expect(source).toMatch(/appLabelStore|LabelStore/);
	});

	it('the app label store singleton exists (the page seam specs substitute)', () => {
		const source = src('src/lib/files/appLabelStore.ts');
		expect(source).toContain('getAppLabelStore');
	});

	it.each(['src/routes/+page.svelte', 'src/routes/part/[fileId]/+page.svelte'])(
		'%s records the label where the bytes land — the delivery `reason` is only knowable there',
		(page) => {
			expect(src(page)).toContain('recordPartLabel');
		}
	);

	it.each(['src/routes/library/+page.svelte', 'src/lib/events/EventWorksSection.svelte'])(
		'%s hands the part label to the viewer through the navigation state',
		(page) => {
			const source = src(page);
			expect(source).toContain('partLabel');
			expect(source).toMatch(/goto\([^;]*state:/s);
		}
	);
});

// (*MVOX:Tallis* — #353 RED)
