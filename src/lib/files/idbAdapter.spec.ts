// #343 RED — the IndexedDB adapter, driven against a REAL IndexedDB
// implementation (fake-indexeddb — devDependency APPROVED on #343, issue
// comment IC_kwDOTubdKM8AAAABUHJaew: the happy-dom precedent, a double for
// the PLATFORM, not for the subject; `dependencies: {}` stays empty).
//
// The adapter is deliberately thin: get/put/touch/delete/list on rows keyed
// (db, personId, fileId). ALL policy (cap, eviction, null-identity, partition
// semantics) lives in the byteStore core and is specced there — nothing here
// duplicates it.
//
// The payload and its recency stamp sit in SEPARATE object stores under the
// same key (#343 review) so `touch` costs a number-sized write instead of
// re-persisting the score. That split is an implementation detail of this
// module — every test below reads through the public get/list, which rejoin
// the halves, so nothing here knows about two stores.
//
// The load-bearing pin is PERSISTENCE ACROSS RE-OPEN: two adapter instances
// over the same IDBFactory see the same rows. That is the mechanism behind
// the issue's RETAIN ruling — logout/token-expiry tear down the session (and
// with it every in-memory object), and re-login as the same (db, personId)
// must find the bytes still on disk without redownloading.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIdbAdapter } from './idbAdapter';
import type { StoredFileRecord } from './byteStore';

function record(fill: number, size = 16): StoredFileRecord {
	return {
		bytes: new Uint8Array(size).fill(fill).buffer,
		filetype: 'application/pdf',
		sha256: `sha-${fill}`,
		size,
		openedAt: 1_757_000_000_000 + fill
	};
}

describe('idbAdapter — against a real IndexedDB implementation', () => {
	it('round-trips a record: the bytes read back byte-identical, the metadata intact', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(5));

		const back = await adapter.get('polyphony', 'person-a', 'file-1');
		expect(back).toBeDefined();
		expect(new Uint8Array(back!.bytes)).toEqual(new Uint8Array(16).fill(5));
		expect(back!.filetype).toBe('application/pdf');
		expect(back!.sha256).toBe('sha-5');
		expect(back!.size).toBe(16);
		expect(back!.openedAt).toBe(1_757_000_000_005);
	});

	it('a get for a key never written is undefined — and keys are the full (db, personId, fileId) triple', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(5));

		expect(await adapter.get('polyphony', 'person-b', 'file-1')).toBeUndefined();
		expect(await adapter.get('crede', 'person-a', 'file-1')).toBeUndefined();
		expect(await adapter.get('polyphony', 'person-a', 'file-2')).toBeUndefined();
	});

	it('put on an existing key REPLACES the record — bytes and stamp both', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(5));
		await adapter.put('polyphony', 'person-a', 'file-1', record(9));

		const back = await adapter.get('polyphony', 'person-a', 'file-1');
		expect(new Uint8Array(back!.bytes)[0]).toBe(9);
		expect(back!.openedAt).toBe(1_757_000_000_009);
		expect((await adapter.list()).length).toBe(1);
	});

	// #343 review — the recency bump used to ride a full put(), which in
	// IndexedDB means re-persisting the whole ArrayBuffer to move one number.
	// `touch` is the narrow write that replaces it; these pin that it moves the
	// stamp, leaves the bytes alone, and shows up in list() (what eviction reads).
	it('touch moves the stamp and leaves the bytes untouched — byte-identical after, in get AND in list', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(5));

		await adapter.touch('polyphony', 'person-a', 'file-1', 1_757_999_999_999);

		const back = await adapter.get('polyphony', 'person-a', 'file-1');
		expect(back!.openedAt).toBe(1_757_999_999_999);
		expect(new Uint8Array(back!.bytes)).toEqual(new Uint8Array(16).fill(5));
		expect(back!.sha256).toBe('sha-5');
		expect(back!.size).toBe(16);
		const rows = await adapter.list();
		expect(rows.length).toBe(1);
		expect(rows[0].record.openedAt).toBe(1_757_999_999_999);
		expect(new Uint8Array(rows[0].record.bytes)).toEqual(new Uint8Array(16).fill(5));
	});

	it('touch on a key holding nothing writes nothing — a stamp alone is not a row', async () => {
		const adapter = createIdbAdapter(new IDBFactory());

		await adapter.touch('polyphony', 'person-a', 'file-ghost', 1_757_999_999_999);

		expect(await adapter.get('polyphony', 'person-a', 'file-ghost')).toBeUndefined();
		expect(await adapter.list()).toEqual([]);
	});

	it('touch reaches exactly one key — the neighbours keep their own stamps', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(1));
		await adapter.put('polyphony', 'person-b', 'file-1', record(2));
		await adapter.put('crede', 'person-a', 'file-1', record(3));

		await adapter.touch('polyphony', 'person-a', 'file-1', 1_757_999_999_999);

		expect((await adapter.get('polyphony', 'person-a', 'file-1'))!.openedAt).toBe(
			1_757_999_999_999
		);
		expect((await adapter.get('polyphony', 'person-b', 'file-1'))!.openedAt).toBe(
			1_757_000_000_002
		);
		expect((await adapter.get('crede', 'person-a', 'file-1'))!.openedAt).toBe(1_757_000_000_003);
	});

	it('delete takes the stamp with the payload — a later re-put is not haunted by the old recency', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(5));
		await adapter.touch('polyphony', 'person-a', 'file-1', 1_757_999_999_999);
		await adapter.delete('polyphony', 'person-a', 'file-1');

		await adapter.put('polyphony', 'person-a', 'file-1', record(7));

		expect((await adapter.get('polyphony', 'person-a', 'file-1'))!.openedAt).toBe(
			1_757_000_000_007
		);
	});

	it('delete removes exactly one row; list returns every remaining row with full key + record', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(1));
		await adapter.put('polyphony', 'person-b', 'file-2', record(2));
		await adapter.delete('polyphony', 'person-a', 'file-1');

		const rows = await adapter.list();
		expect(rows.length).toBe(1);
		expect(rows[0].db).toBe('polyphony');
		expect(rows[0].personId).toBe('person-b');
		expect(rows[0].fileId).toBe('file-2');
		expect(rows[0].record.sha256).toBe('sha-2');
	});

	it('RETAIN mechanism: rows survive a re-open — a SECOND adapter over the same factory reads what the first wrote', async () => {
		const factory = new IDBFactory();
		const first = createIdbAdapter(factory);
		await first.put('polyphony', 'person-a', 'file-1', record(5));

		// The session died; nothing in memory survives. Same disk, same key.
		const second = createIdbAdapter(factory);
		const back = await second.get('polyphony', 'person-a', 'file-1');
		expect(back).toBeDefined();
		expect(new Uint8Array(back!.bytes)).toEqual(new Uint8Array(16).fill(5));
	});

	it('what reaches the disk carries NO url — the persisted row is the record as given, nothing added', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put('polyphony', 'person-a', 'file-1', record(5));

		const rows = await adapter.list();
		expect(Object.keys(rows[0].record).sort()).toEqual([
			'bytes',
			'filetype',
			'openedAt',
			'sha256',
			'size'
		]);
		expect(JSON.stringify({ ...rows[0].record, bytes: undefined })).not.toMatch(/https?:/i);
	});
});

// (*MVOX:Tallis*)
