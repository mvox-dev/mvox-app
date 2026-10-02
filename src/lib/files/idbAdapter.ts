// IndexedDB persistence for the offline byte store; all policy lives in the byteStore core.

// Payload and metadata live in two stores under one key: touch rewrites a few bytes, and every
// size sum reads the metadata store alone. put and delete write both halves in one transaction.

import type {
	ByteStoreAdapter,
	ByteStoreKey,
	ByteStoreMeta,
	ByteStoreRow,
	StoredFileRecord
} from './byteStore';
import { compositeKey, lazyDb, reqToPromise } from './idb';

const DB_NAME = 'mvox-byte-store';
// Each bump is a cache flush, not a migration: everything here is re-downloadable.
const DB_VERSION = 3;
const PAYLOAD_STORE = 'files';
const RECENCY_STORE = 'recency';

/** The payload half: a full row MINUS the metadata the recency row carries. */
interface PayloadRow {
	db: string;
	personId: string;
	fileId: string;
	record: Omit<StoredFileRecord, 'openedAt'>;
}

/** The metadata half: `listMeta` reads only this store. */
interface RecencyRow {
	openedAt: number;
	size: number;
}

/** `factory` is injectable so a spec can pass an isolated `new IDBFactory()`. */
export function createIdbAdapter(factory?: IDBFactory): ByteStoreAdapter {
	const idb = factory ?? indexedDB;
	const getDb = lazyDb(idb, DB_NAME, DB_VERSION, (database) => {
		for (const name of Array.from(database.objectStoreNames)) {
			database.deleteObjectStore(name);
		}
		database.createObjectStore(PAYLOAD_STORE);
		database.createObjectStore(RECENCY_STORE);
	});

	return {
		async get(db, personId, fileId) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readonly');
			// Both requests go out before the first await: a transaction with none outstanding commits.
			const payloadReq = tx.objectStore(PAYLOAD_STORE).get(key);
			const recencyReq = tx.objectStore(RECENCY_STORE).get(key);
			const [row, meta] = await Promise.all([
				reqToPromise(payloadReq) as Promise<PayloadRow | undefined>,
				reqToPromise(recencyReq) as Promise<RecencyRow | undefined>
			]);
			if (!row) return undefined;
			// A payload with no metadata row reads as oldest, so eviction claims it first.
			return { ...row.record, size: meta?.size ?? row.record.size, openedAt: meta?.openedAt ?? 0 };
		},

		async put(db, personId, fileId, record: StoredFileRecord) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const { openedAt, ...payload } = record;
			const row: PayloadRow = { db, personId, fileId, record: payload };
			const meta: RecencyRow = { openedAt, size: record.size };
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readwrite');
			const payloadReq = tx.objectStore(PAYLOAD_STORE).put(row, key);
			const recencyReq = tx.objectStore(RECENCY_STORE).put(meta, key);
			await Promise.all([reqToPromise(payloadReq), reqToPromise(recencyReq)]);
		},

		async touch(db, personId, fileId, openedAt) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			// The metadata row is the existence check and carries `size` forward; no bytes are read.
			const tx = database.transaction(RECENCY_STORE, 'readwrite');
			const store = tx.objectStore(RECENCY_STORE);
			const held = (await reqToPromise(store.get(key))) as RecencyRow | undefined;
			if (!held) return;
			await reqToPromise(store.put({ openedAt, size: held.size }, key));
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
			// The expensive read: getAll on the payload store deserialises every stored buffer.
			const database = await getDb();
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readonly');
			const payloadReq = tx.objectStore(PAYLOAD_STORE).getAll();
			const recencyKeysReq = tx.objectStore(RECENCY_STORE).getAllKeys();
			const recencyReq = tx.objectStore(RECENCY_STORE).getAll();
			const [rows, recencyKeys, metas] = await Promise.all([
				reqToPromise(payloadReq) as Promise<PayloadRow[]>,
				reqToPromise(recencyKeysReq),
				reqToPromise(recencyReq) as Promise<RecencyRow[]>
			]);
			const metaByKey = new Map<string, RecencyRow>();
			recencyKeys.forEach((key, i) => metaByKey.set(String(key), metas[i]));
			return rows.map((row): ByteStoreRow => {
				const meta = metaByKey.get(compositeKey(row.db, row.personId, row.fileId));
				return {
					db: row.db,
					personId: row.personId,
					fileId: row.fileId,
					record: {
						...row.record,
						size: meta?.size ?? row.record.size,
						openedAt: meta?.openedAt ?? 0
					}
				};
			});
		},

		async listKeys() {
			const database = await getDb();
			// The payload keys are the triple, so no row is read; a recency row alone is no held file.
			const tx = database.transaction(PAYLOAD_STORE, 'readonly');
			const keys = await reqToPromise(tx.objectStore(PAYLOAD_STORE).getAllKeys());
			return keys.map((key): ByteStoreKey => {
				const [db, personId, fileId] = JSON.parse(String(key)) as [string, string, string];
				return { db, personId, fileId };
			});
		},

		async listMeta() {
			const database = await getDb();
			// Metadata store only; getAllKeys and getAll return the same key order, which pairs them.
			const tx = database.transaction(RECENCY_STORE, 'readonly');
			const store = tx.objectStore(RECENCY_STORE);
			const keysReq = store.getAllKeys();
			const valuesReq = store.getAll();
			const [keys, metas] = await Promise.all([
				reqToPromise(keysReq),
				reqToPromise(valuesReq) as Promise<RecencyRow[]>
			]);
			return keys.map((key, i): ByteStoreMeta => {
				const [db, personId, fileId] = JSON.parse(String(key)) as [string, string, string];
				return { db, personId, fileId, size: metas[i].size, openedAt: metas[i].openedAt };
			});
		}
	};
}

// (*MVOX:Josquin*)
