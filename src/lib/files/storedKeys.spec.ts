// The exact key strings each on-device store writes: a changed key hides a user's data from them.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIdbAdapter } from './idbAdapter';
import { createLabelIdbAdapter } from './labelIdbAdapter';
import { createInkStore } from '$lib/strokes/inkStore';
import { createSavedFeedbackStore } from '$lib/feedback/savedFeedback';
import { createProblemLog } from '$lib/problems/problemLog';
import { readCachePut, setReadCacheFactory } from '$lib/entu/readCacheStore';

async function storedKeys(factory: IDBFactory, dbName: string, store: string): Promise<unknown[]> {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = factory.open(dbName);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
		const req = database.transaction(store, 'readonly').objectStore(store).getAllKeys();
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	database.close();
	return keys;
}

describe('stored keys stay byte-identical', () => {
	it('byte store: payload and recency rows sit under ["db","person","file"]', async () => {
		const factory = new IDBFactory();
		await createIdbAdapter(factory).put('sampledb', 'person-a', 'file-1', {
			bytes: new ArrayBuffer(4),
			filetype: 'application/pdf',
			sha256: 'sha',
			size: 4,
			openedAt: 1
		});
		const expected = ['["sampledb","person-a","file-1"]'];
		expect(await storedKeys(factory, 'mvox-byte-store', 'files')).toEqual(expected);
		expect(await storedKeys(factory, 'mvox-byte-store', 'recency')).toEqual(expected);
	});

	it('label index: ["db","person","file"]', async () => {
		const factory = new IDBFactory();
		await createLabelIdbAdapter(factory).put('sampledb', 'person-a', 'file-1', {
			work: 'w',
			composer: 'c',
			edition: 'e',
			filename: 'f.pdf'
		});
		expect(await storedKeys(factory, 'mvox-label-index', 'labels')).toEqual([
			'["sampledb","person-a","file-1"]'
		]);
	});

	it('ink: ["db","person","file#page"]', async () => {
		const factory = new IDBFactory();
		await createInkStore(factory).save(
			{ db: 'sampledb', personId: 'person-a', fileId: 'file-1', page: 3 },
			{ v: 1, strokes: [] }
		);
		expect(await storedKeys(factory, 'mvox-ink', 'pages')).toEqual([
			'["sampledb","person-a","file-1#3"]'
		]);
	});

	it('saved feedback: ["db","person","id"]', async () => {
		const factory = new IDBFactory();
		await createSavedFeedbackStore(factory).put({
			id: 'fb-1',
			db: 'sampledb',
			personId: 'person-a',
			description: 'd',
			pagePath: '/',
			page: {} as never
		});
		expect(await storedKeys(factory, 'mvox-saved-feedback', 'items')).toEqual([
			'["sampledb","person-a","fb-1"]'
		]);
	});

	it('read cache: ["db","person","pathAndQuery"]', async () => {
		const factory = new IDBFactory();
		setReadCacheFactory(factory);
		try {
			await readCachePut('sampledb', 'person-a', 'entity?limit=5', {
				body: {},
				readAt: '2026-01-01T00:00:00.000Z',
				bytes: 2
			});
			expect(await storedKeys(factory, 'mvox-read-cache', 'reads')).toEqual([
				'["sampledb","person-a","entity?limit=5"]'
			]);
		} finally {
			setReadCacheFactory(undefined);
		}
	});

	it('problem log: a two-part key ["db","person"]', async () => {
		const factory = new IDBFactory();
		await createProblemLog(factory).add('sampledb', 'person-a', {
			area: 'a',
			action: 'b',
			detail: 'c'
		});
		expect(await storedKeys(factory, 'mvox-problem-log', 'people')).toEqual([
			'["sampledb","person-a"]'
		]);
	});
});

// (*MVOX:Josquin*)
