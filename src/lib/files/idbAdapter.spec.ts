// The IndexedDB adapter against a real implementation (fake-indexeddb): rows keyed by file key.
// Policy lives in the byteStore core. Persistence across re-open is the load-bearing pin: re-login
// as the same person must find the bytes still on disk.
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
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));

		const back = await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' });
		expect(back).toBeDefined();
		expect(new Uint8Array(back!.bytes)).toEqual(new Uint8Array(16).fill(5));
		expect(back!.filetype).toBe('application/pdf');
		expect(back!.sha256).toBe('sha-5');
		expect(back!.size).toBe(16);
		expect(back!.openedAt).toBe(1_757_000_000_005);
	});

	it('a get for a key never written is undefined — and keys are the full (db, personId, fileId) triple', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));

		expect(await adapter.get({ db: 'sampledb', personId: 'person-b', fileId: 'file-1' })).toBeUndefined();
		expect(await adapter.get({ db: 'crede', personId: 'person-a', fileId: 'file-1' })).toBeUndefined();
		expect(await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-2' })).toBeUndefined();
	});

	it('put on an existing key REPLACES the record — bytes and stamp both', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(9));

		const back = await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' });
		expect(new Uint8Array(back!.bytes)[0]).toBe(9);
		expect(back!.openedAt).toBe(1_757_000_000_009);
		expect((await adapter.list()).length).toBe(1);
	});

	// `touch` moves one number where put() would re-persist the whole buffer: it must move the
	// stamp, leave the bytes alone, and show in list() (what eviction reads).
	it('touch moves the stamp and leaves the bytes untouched — byte-identical after, in get AND in list', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));

		await adapter.touch({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, 1_757_999_999_999);

		const back = await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' });
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

		await adapter.touch({ db: 'sampledb', personId: 'person-a', fileId: 'file-ghost' }, 1_757_999_999_999);

		expect(await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-ghost' })).toBeUndefined();
		expect(await adapter.list()).toEqual([]);
	});

	it('touch reaches exactly one key — the neighbours keep their own stamps', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(1));
		await adapter.put({ db: 'sampledb', personId: 'person-b', fileId: 'file-1' }, record(2));
		await adapter.put({ db: 'crede', personId: 'person-a', fileId: 'file-1' }, record(3));

		await adapter.touch({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, 1_757_999_999_999);

		expect((await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }))!.openedAt).toBe(
			1_757_999_999_999
		);
		expect((await adapter.get({ db: 'sampledb', personId: 'person-b', fileId: 'file-1' }))!.openedAt).toBe(
			1_757_000_000_002
		);
		expect((await adapter.get({ db: 'crede', personId: 'person-a', fileId: 'file-1' }))!.openedAt).toBe(1_757_000_000_003);
	});

	it('delete takes the stamp with the payload — a later re-put is not haunted by the old recency', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));
		await adapter.touch({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, 1_757_999_999_999);
		await adapter.delete({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' });

		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(7));

		expect((await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }))!.openedAt).toBe(
			1_757_000_000_007
		);
	});

	it('delete removes exactly one row; list returns every remaining row with full key + record', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(1));
		await adapter.put({ db: 'sampledb', personId: 'person-b', fileId: 'file-2' }, record(2));
		await adapter.delete({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' });

		const rows = await adapter.list();
		expect(rows.length).toBe(1);
		expect(rows[0].db).toBe('sampledb');
		expect(rows[0].personId).toBe('person-b');
		expect(rows[0].fileId).toBe('file-2');
		expect(rows[0].record.sha256).toBe('sha-2');
	});

	it('RETAIN mechanism: rows survive a re-open — a SECOND adapter over the same factory reads what the first wrote', async () => {
		const factory = new IDBFactory();
		const first = createIdbAdapter(factory);
		await first.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));

		// The session died; nothing in memory survives. Same disk, same key.
		const second = createIdbAdapter(factory);
		const back = await second.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' });
		expect(back).toBeDefined();
		expect(new Uint8Array(back!.bytes)).toEqual(new Uint8Array(16).fill(5));
	});

	it('what reaches the disk carries NO url — the persisted row is the record as given, nothing added', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));

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

	// The keys-only seam the presence query rides.
	it('listKeys answers every held (db, personId, fileId) triple — and nothing else, including keys delete() removed', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5));
		await adapter.put({ db: 'sampledb', personId: 'person-b', fileId: 'file-2' }, record(6));
		await adapter.put({ db: 'crede', personId: 'person-a', fileId: 'file-3' }, record(7));

		const keys = await adapter.listKeys();
		expect([...keys].sort((a, b) => a.fileId.localeCompare(b.fileId))).toEqual([
			{ db: 'sampledb', personId: 'person-a', fileId: 'file-1' },
			{ db: 'sampledb', personId: 'person-b', fileId: 'file-2' },
			{ db: 'crede', personId: 'person-a', fileId: 'file-3' }
		]);

		await adapter.delete({ db: 'sampledb', personId: 'person-b', fileId: 'file-2' });
		expect((await adapter.listKeys()).map((k) => k.fileId).sort()).toEqual(['file-1', 'file-3']);
	});

	it('listKeys reads NO payload — the returned objects carry the triple alone, no bytes, no record', async () => {
		const adapter = createIdbAdapter(new IDBFactory());
		await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5, 4096));

		const keys = await adapter.listKeys();
		// Full-shape pin: any `record`/`bytes` member here means the payload
		// store was read, which is exactly the 200MB-into-heap cost this
		// method exists to avoid.
		expect(Object.keys(keys[0]).sort()).toEqual(['db', 'fileId', 'personId']);
	});

	// The metadata seam every size sum rides: reading `size` through the payload store would put
	// the whole 200MB cap into the heap on every profile load.
	describe('listMeta — sizes and stamps without the bytes', () => {
		it('answers the triple plus size and openedAt for every held row, and nothing delete removed', async () => {
			const adapter = createIdbAdapter(new IDBFactory());
			await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(1, 10));
			await adapter.put({ db: 'sampledb', personId: 'person-b', fileId: 'file-2' }, record(2, 20));
			await adapter.put({ db: 'crede', personId: 'person-a', fileId: 'file-3' }, record(3, 30));

			const metas = await adapter.listMeta();
			expect([...metas].sort((a, b) => a.fileId.localeCompare(b.fileId))).toEqual([
				{
					db: 'sampledb',
					personId: 'person-a',
					fileId: 'file-1',
					size: 10,
					openedAt: 1_757_000_000_001
				},
				{
					db: 'sampledb',
					personId: 'person-b',
					fileId: 'file-2',
					size: 20,
					openedAt: 1_757_000_000_002
				},
				{
					db: 'crede',
					personId: 'person-a',
					fileId: 'file-3',
					size: 30,
					openedAt: 1_757_000_000_003
				}
			]);

			await adapter.delete({ db: 'sampledb', personId: 'person-b', fileId: 'file-2' });
			expect((await adapter.listMeta()).map((m) => m.fileId).sort()).toEqual(['file-1', 'file-3']);
		});

		it('reads NO payload — the returned objects carry the triple and two numbers, no bytes, no record', async () => {
			const adapter = createIdbAdapter(new IDBFactory());
			await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5, 4096));

			const metas = await adapter.listMeta();
			// Full-shape pin, same law as listKeys above: a `record`/`bytes`
			// member here would mean the payload store was read.
			expect(Object.keys(metas[0]).sort()).toEqual([
				'db',
				'fileId',
				'openedAt',
				'personId',
				'size'
			]);
		});

		it('a touch moves the stamp and CARRIES THE SIZE FORWARD — metadata never drifts from the row it describes', async () => {
			const adapter = createIdbAdapter(new IDBFactory());
			await adapter.put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5, 4096));

			await adapter.touch({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, 1_757_999_999_999);

			// `size` is a duplicate of bytes.byteLength kept beside the stamp; a
			// touch that dropped it would silently zero this row out of every
			// usage sum and let the cap overrun.
			expect(await adapter.listMeta()).toEqual([
				{
					db: 'sampledb',
					personId: 'person-a',
					fileId: 'file-1',
					size: 4096,
					openedAt: 1_757_999_999_999
				}
			]);
			// The full reads still agree with it.
			const rows = await adapter.list();
			expect(rows[0].record.size).toBe(4096);
			expect(rows[0].record.openedAt).toBe(1_757_999_999_999);
			expect((await adapter.get({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }))!.size).toBe(4096);
		});

		it('on an empty store it is an empty list, not a throw', async () => {
			const adapter = createIdbAdapter(new IDBFactory());
			expect(await adapter.listMeta()).toEqual([]);
		});

		it('survives a re-open, like every other read — a SECOND adapter over the same factory sees the metadata', async () => {
			const factory = new IDBFactory();
			await createIdbAdapter(factory).put({ db: 'sampledb', personId: 'person-a', fileId: 'file-1' }, record(5, 64));

			expect(await createIdbAdapter(factory).listMeta()).toEqual([
				{
					db: 'sampledb',
					personId: 'person-a',
					fileId: 'file-1',
					size: 64,
					openedAt: 1_757_000_000_005
				}
			]);
		});
	});
});

// (*MVOX:Tallis*)
