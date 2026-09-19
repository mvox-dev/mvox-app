// #353 RED — the label index: "a label written at download time".
//
// THE STORE CANNOT NAME WHAT IT HOLDS (issue #353 gap 2): StoredFileRecord is
// bytes/filetype/sha256/size/openedAt keyed by fileId — offline, the store
// can say "fourteen files, 180 MB" and not which pieces they are.
//
// SPIKE-PROVEN DECISIONS this spec pins (spike-353 probes A/B/C, run against
// a real fake-indexeddb):
//   - Labels live in a SEPARATE IndexedDB database 'mvox-label-index' — NOT
//     in 'mvox-byte-store'. PROVEN: bumping the byte store's DB_VERSION runs
//     idbAdapter's onupgradeneeded, which is a CACHE FLUSH (deletes every
//     object store) — shipping labels inside that DB would WIPE EVERY
//     SINGER'S DOWNLOADED PARTS at the exact moment the feature is for.
//     Sibling DB proven harmless (probe C: byte rows intact).
//   - Same composite key as the byte store: JSON.stringify([db, personId,
//     fileId]) — the two halves join by key with no ambiguity.
//   - Lifecycle: written at put-time, EAGERLY removed when the byte row goes
//     away (hook seam below); orphans are structurally harmless (the read
//     order is heldFileIds first, labels only NAME held ids) but unbounded —
//     the LRU evicts silently on every over-cap put, so eager removal is the
//     backstop against a leak of small rows.
//   - byteStore.ts stays POLICY-ONLY: it learns nothing about labels — only
//     an optional `opts.onRowRemoved` hook reporting that a row went away.
//     The composition root (appByteStore.ts) wires that hook to the label
//     store's delete.
//   - NO TITLE LANDS IN StoredFileRecord — full-shape pin below.
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

		// The byte row survives, bytes and all — no upgrade, no flush.
		expect(await byteStore.heldFileIds('sampledb', 'person-1')).toEqual(['file-a']);
		const record = await byteStore.get(IDENTITY, 'file-a');
		expect(Array.from(new Uint8Array(record!.bytes))).toEqual(new Array(16).fill(5));
	});
});

describe('#353 — labels survive restart and read back with zero network', () => {
	it('a label written through one connection reads back VERBATIM from a cold one (the restart seam)', async () => {
		const factory = new IDBFactory();
		// Write through the REAL put path — the production putLabel, never
		// hand-set rows in the underlying DB.
		const writer = createLabelStore(createLabelIdbAdapter(factory));
		await writer.putLabel(IDENTITY, 'file-a', LABEL);

		// A brand-new adapter + store over the same factory = the cold read
		// after a full browser restart (the idbAdapter.spec re-open precedent).
		const reader = createLabelStore(createLabelIdbAdapter(factory));
		const held = await reader.labelsFor('sampledb', 'person-1');
		// FULL SHAPE — the exact four fields, nothing dropped, nothing added.
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
	// The label is written exactly when the device GAINED (or already held) an
	// offline copy: 'network-stored' (just downloaded) and 'cache' (already
	// held — the backfill that names bytes downloaded before #353 shipped).
	// 'network-uncached' and 'fallback-navigation' leave NOTHING in the byte
	// store (openFileBytes.ts DELIVERY REPORTING) — a label for absent bytes
	// would be an orphan minted on purpose.
	it('writes for network-stored and cache; never for network-uncached or fallback-navigation', async () => {
		const factory = new IDBFactory();
		const store = createLabelStore(createLabelIdbAdapter(factory));

		recordPartLabel(store, IDENTITY, 'file-uncached', { ...LABEL, filename: 'u.pdf' }, 'network-uncached');
		recordPartLabel(store, IDENTITY, 'file-fallback', { ...LABEL, filename: 'f.pdf' }, 'fallback-navigation');
		recordPartLabel(store, IDENTITY, 'file-stored', { ...LABEL, filename: 's.pdf' }, 'network-stored');
		recordPartLabel(store, IDENTITY, 'file-cached', { ...LABEL, filename: 'c.pdf' }, 'cache');

		// Fire-and-forget: wait for the two positive writes to land, then the
		// negatives are provably absent (same store, same event loop).
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
		// Two macrotask turns: an uncaught rejection here fails the run — that
		// IS the pin that the implementation swallows its own failure.
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
		// #353 GREEN fix-forward: the RED literal listed these two reversed
		// relative to its own ascending `fileId` sort ('file-a' < 'file-c') —
		// the sibling clearPartition test above sorts the same way and lists
		// its keys in the order the comparator actually produces. Corrected to
		// match; the property under test (every key on the device, both
		// partitions) is unchanged.
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
		// toEqual over the WHOLE record: a `title`/`work`/`label` field riding
		// in would fail this, which is the point.
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

	it.each([
		'src/routes/library/+page.svelte',
		'src/routes/+page.svelte',
		'src/routes/event/[id]/+page.svelte'
	])('%s records the label at its open handler — metadata is in hand exactly there', (page) => {
		// The three put()-reaching surfaces (spike 2a: openFileBytes is the ONLY
		// caller of store.put, reached from these three pages' handlers). The
		// write rides the existing `reason` branch — outside the delivery path,
		// so the label can never gate the open.
		expect(src(page)).toContain('recordPartLabel');
	});
});

// (*MVOX:Tallis* — #353 RED)
