// #343 — IndexedDB persistence for the offline byte store.
//
// Deliberately thin: get/put/touch/delete/list on rows keyed (db, personId,
// fileId). ALL policy (cap, eviction, null-identity, partition semantics)
// lives in the byteStore core and is specced there — nothing here duplicates
// it.
//
// TWO OBJECT STORES, ONE KEY (#343 review). IndexedDB has no partial update:
// writing a record writes the whole value, bytes included. The payload
// (bytes + filetype + sha256 + size) and the recency stamp therefore live in
// separate stores under the same composite key, so `touch` — which the core
// calls on EVERY cached open — costs one number-sized write instead of
// re-persisting a multi-megabyte score. get/list rejoin the two halves, so
// the seam above this module still sees one `StoredFileRecord`.
//
// A row whose payload exists with no recency stamp is not a state this module
// produces (put writes both, delete removes both); should it ever be read,
// `openedAt` reads as 0 — oldest possible, so eviction claims it first rather
// than letting an unstamped row sit uncollectable.

import type { ByteStoreAdapter, ByteStoreRow, StoredFileRecord } from './byteStore';

const DB_NAME = 'mvox-byte-store';
// v2 = the payload/recency split. The bump is a CACHE FLUSH, not a migration:
// `onupgradeneeded` drops whatever is there and creates both stores empty.
// Everything in here is re-downloadable by definition, so carrying old rows
// across a layout change would be migration code written for no gain.
const DB_VERSION = 2;
const PAYLOAD_STORE = 'files';
const RECENCY_STORE = 'recency';

/** The payload half: a full row MINUS its recency stamp. */
interface PayloadRow {
	db: string;
	personId: string;
	fileId: string;
	record: Omit<StoredFileRecord, 'openedAt'>;
}

// JSON-encoded triple, not a delimited string: any separator character risks
// collision with a db name, person id or Entu file-property id, none of
// which this module controls the shape of. JSON.stringify of a fixed-arity
// array has no such ambiguity.
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
		const req = factory.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const database = req.result;
			for (const name of Array.from(database.objectStoreNames)) {
				database.deleteObjectStore(name);
			}
			database.createObjectStore(PAYLOAD_STORE);
			database.createObjectStore(RECENCY_STORE);
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
export function createIdbAdapter(factory?: IDBFactory): ByteStoreAdapter {
	// Lazy default: evaluated only when the app actually calls this with no
	// argument, so this module loads fine in a non-browser test environment
	// as long as a factory is always supplied there.
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
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readonly');
			// BOTH requests are issued before the first await: a transaction
			// auto-commits once the task queue drains with none outstanding, so
			// awaiting between two reads of the same tx is what breaks it.
			const payloadReq = tx.objectStore(PAYLOAD_STORE).get(key);
			const recencyReq = tx.objectStore(RECENCY_STORE).get(key);
			const [row, openedAt] = await Promise.all([
				reqToPromise(payloadReq) as Promise<PayloadRow | undefined>,
				reqToPromise(recencyReq) as Promise<number | undefined>
			]);
			if (!row) return undefined;
			return { ...row.record, openedAt: openedAt ?? 0 };
		},

		async put(db, personId, fileId, record: StoredFileRecord) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const { openedAt, ...payload } = record;
			const row: PayloadRow = { db, personId, fileId, record: payload };
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readwrite');
			const payloadReq = tx.objectStore(PAYLOAD_STORE).put(row, key);
			const recencyReq = tx.objectStore(RECENCY_STORE).put(openedAt, key);
			await Promise.all([reqToPromise(payloadReq), reqToPromise(recencyReq)]);
		},

		async touch(db, personId, fileId, openedAt) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			// Recency without a payload is not a row, so the existence check and
			// the write share ONE transaction — the check is a keyed count, which
			// reads no bytes. Continuing the same tx across `await` is safe here
			// because the await resolves in the request's own microtask; what
			// breaks a transaction is awaiting something that isn't its request.
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readwrite');
			const held = await reqToPromise(tx.objectStore(PAYLOAD_STORE).count(key));
			if (held === 0) return;
			await reqToPromise(tx.objectStore(RECENCY_STORE).put(openedAt, key));
		},

		async delete(db, personId, fileId) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readwrite');
			const payloadReq = tx.objectStore(PAYLOAD_STORE).delete(key);
			const recencyReq = tx.objectStore(RECENCY_STORE).delete(key);
			await Promise.all([reqToPromise(payloadReq), reqToPromise(recencyReq)]);
		},

		async list() {
			const database = await getDb();
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readonly');
			const payloadReq = tx.objectStore(PAYLOAD_STORE).getAll();
			const recencyKeysReq = tx.objectStore(RECENCY_STORE).getAllKeys();
			const recencyReq = tx.objectStore(RECENCY_STORE).getAll();
			const [rows, recencyKeys, stamps] = await Promise.all([
				reqToPromise(payloadReq) as Promise<PayloadRow[]>,
				reqToPromise(recencyKeysReq),
				reqToPromise(recencyReq) as Promise<number[]>
			]);
			const openedAtByKey = new Map<string, number>();
			recencyKeys.forEach((key, i) => openedAtByKey.set(String(key), stamps[i]));
			return rows.map(
				(row): ByteStoreRow => ({
					db: row.db,
					personId: row.personId,
					fileId: row.fileId,
					record: {
						...row.record,
						openedAt: openedAtByKey.get(compositeKey(row.db, row.personId, row.fileId)) ?? 0
					}
				})
			);
		}
	};
}

// (*MVOX:Josquin*)
