// IndexedDB persistence for the label index.

// A sibling database to the byte store, never a store in it: a bump of that DB_VERSION
// flushes every downloaded part.
import { compositeKey, lazyDb, reqToPromise } from './idb';
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

/** `factory` is injectable so a spec can pass an isolated `new IDBFactory()`. */
export function createLabelIdbAdapter(factory?: IDBFactory): LabelStoreAdapter {
	const idb = factory ?? indexedDB;
	const getDb = lazyDb(idb, LABEL_DB_NAME, DB_VERSION, (database) => {
		if (!database.objectStoreNames.contains(LABEL_STORE)) {
			database.createObjectStore(LABEL_STORE);
		}
	});

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
