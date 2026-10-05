// Feedback saved on the device until it reaches Entu, keyed (db, personId, id) like #343's parts.
import type { StrokeData } from '$lib/strokes/strokes';
import { compositeKey, lazyDb, reqToPromise } from '$lib/files/idb';
import type { PageContext } from './pageMetadata';

export interface SavedFeedback {
	id: string;
	db: string;
	personId: string;
	screenshot: Blob;
	strokes: StrokeData;
	description: string;
	pagePath: string;
	page: PageContext;
	/** Set once a send's create has landed, so a retry replaces that entity instead of adding one. */
	entityId?: string;
}

export interface SavedFeedbackStore {
	put(item: SavedFeedback): Promise<void>;
	list(db: string, personId: string): Promise<SavedFeedback[]>;
	delete(db: string, personId: string, id: string): Promise<void>;
}

type Row = Omit<SavedFeedback, 'screenshot'> & { bytes: ArrayBuffer; filetype: string };

const DB_NAME = 'mvox-saved-feedback';
const DB_VERSION = 1;
const STORE = 'items';

export function createSavedFeedbackStore(factory?: IDBFactory): SavedFeedbackStore {
	const getDb = lazyDb(factory ?? indexedDB, DB_NAME, DB_VERSION, (database) => {
		database.createObjectStore(STORE);
	});

	return {
		async put(item) {
			const { screenshot, ...rest } = item;
			const row: Row = { ...rest, bytes: await screenshot.arrayBuffer(), filetype: screenshot.type };
			const database = await getDb();
			const req = database
				.transaction(STORE, 'readwrite')
				.objectStore(STORE)
				.put(row, compositeKey(item.db, item.personId, item.id));
			await reqToPromise(req);
		},

		async list(db, personId) {
			const database = await getDb();
			const rows = (await reqToPromise(
				database.transaction(STORE, 'readonly').objectStore(STORE).getAll()
			)) as Row[];
			return rows
				.filter((row) => row.db === db && row.personId === personId)
				.map(({ bytes, filetype, ...rest }) => ({
					...rest,
					screenshot: new Blob([bytes], { type: filetype })
				}));
		},

		async delete(db, personId, id) {
			const database = await getDb();
			const req = database
				.transaction(STORE, 'readwrite')
				.objectStore(STORE)
				.delete(compositeKey(db, personId, id));
			await reqToPromise(req);
		}
	};
}

let instance: SavedFeedbackStore | null = null;

/** Null on a device with no IndexedDB: nothing can have been saved there. */
export function getSavedFeedbackStore(): SavedFeedbackStore | null {
	if (typeof indexedDB === 'undefined') return null;
	instance ??= createSavedFeedbackStore();
	return instance;
}

// (*MVOX:Josquin*)
