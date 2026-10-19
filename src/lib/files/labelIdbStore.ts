// IndexedDB persistence for the label index.

// A sibling database to the byte store, never a store in it: a bump of that DB_VERSION
// flushes every downloaded part.
import { compositeKey, lazyDb, reqToPromise } from './idb';
import type { LabelStore, PartLabel } from './labelStore';

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
export function createIdbLabelStore(factory?: IDBFactory): LabelStore {
	const idb = factory ?? indexedDB;
	const getDb = lazyDb(idb, LABEL_DB_NAME, DB_VERSION, (database) => {
		if (!database.objectStoreNames.contains(LABEL_STORE)) {
			database.createObjectStore(LABEL_STORE);
		}
	});

	return {
		async putLabel({ db, personId, fileId }, label) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const row: LabelRow = { db, personId, fileId, label };
			const tx = database.transaction(LABEL_STORE, 'readwrite');
			await reqToPromise(tx.objectStore(LABEL_STORE).put(row, key));
		},

		async remove({ db, personId, fileId }) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const tx = database.transaction(LABEL_STORE, 'readwrite');
			await reqToPromise(tx.objectStore(LABEL_STORE).delete(key));
		},

		async labelsFor({ db, personId }) {
			const database = await getDb();
			const tx = database.transaction(LABEL_STORE, 'readonly');
			const rows = (await reqToPromise(tx.objectStore(LABEL_STORE).getAll())) as LabelRow[];
			return new Map(
				rows.filter((row) => row.db === db && row.personId === personId).map((row) => [row.fileId, row.label])
			);
		}
	};
}

// (*MVOX:Josquin* — #353 GREEN)
