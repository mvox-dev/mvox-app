// #353 — IndexedDB persistence for the label index.
//
// A SIBLING database to the byte store's ('mvox-byte-store'), never a store
// inside it (see labelStore.ts's module doc — bumping the byte store's own
// DB_VERSION runs a full cache flush, which would delete every singer's
// downloaded parts on the very upgrade meant to name them; spike probe C
// verified writing here leaves the byte store's rows, bytes included,
// untouched).
//
// Deliberately thin, mirroring idbAdapter.ts's shape: one object store,
// keyed by the SAME composite key the byte store uses, JSON-encoded rather
// than delimited (no separator character is safe against a db name, person
// id or Entu file-property id, none of which this module controls the shape
// of).
import type { LabelStoreAdapter, PartLabel } from './labelStore';

export const LABEL_DB_NAME = 'mvox-label-index';
const DB_VERSION = 1;
const LABEL_STORE = 'labels';

interface LabelRow {
	db: string;
	personId: string;
	fileId: string;
	label: PartLabel;
}

function compositeKey(db: string, personId: string, fileId: string): string {
	return JSON.stringify([db, personId, fileId]);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = factory.open(LABEL_DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const database = req.result;
			if (!database.objectStoreNames.contains(LABEL_STORE)) {
				database.createObjectStore(LABEL_STORE);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/**
 * A thin adapter over one IndexedDB database. `factory` is injectable so the
 * spec can hand in an isolated `new IDBFactory()` per test; the app passes
 * nothing and gets the browser's `indexedDB`.
 */
export function createLabelIdbAdapter(factory?: IDBFactory): LabelStoreAdapter {
	const idb = factory ?? indexedDB;
	let dbPromise: Promise<IDBDatabase> | null = null;
	function getDb(): Promise<IDBDatabase> {
		if (!dbPromise) dbPromise = openDb(idb);
		return dbPromise;
	}

	return {
		async get(db, personId, fileId) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const tx = database.transaction(LABEL_STORE, 'readonly');
			const row = (await reqToPromise(tx.objectStore(LABEL_STORE).get(key))) as LabelRow | undefined;
			return row?.label;
		},

		async put(db, personId, fileId, label) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const row: LabelRow = { db, personId, fileId, label };
			const tx = database.transaction(LABEL_STORE, 'readwrite');
			await reqToPromise(tx.objectStore(LABEL_STORE).put(row, key));
		},

		async delete(db, personId, fileId) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const tx = database.transaction(LABEL_STORE, 'readwrite');
			await reqToPromise(tx.objectStore(LABEL_STORE).delete(key));
		},

		async listFor(db, personId) {
			const database = await getDb();
			const tx = database.transaction(LABEL_STORE, 'readonly');
			const rows = (await reqToPromise(tx.objectStore(LABEL_STORE).getAll())) as LabelRow[];
			return rows
				.filter((row) => row.db === db && row.personId === personId)
				.map((row) => ({ fileId: row.fileId, label: row.label }));
		}
	};
}

// (*MVOX:Josquin* — #353 GREEN)
