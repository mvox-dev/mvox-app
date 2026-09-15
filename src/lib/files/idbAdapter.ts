// #343 — IndexedDB persistence for the offline byte store.
//
// Deliberately thin: get/put/touch/delete/list/listKeys/listMeta on rows keyed
// (db, personId, fileId). ALL policy (cap, eviction, null-identity, partition
// semantics) lives in the byteStore core and is specced there — nothing here
// duplicates it.
//
// TWO OBJECT STORES, ONE KEY (#343 review). IndexedDB has no partial update:
// writing a record writes the whole value, bytes included. The payload
// (bytes + filetype + sha256) and the METADATA (recency stamp + size)
// therefore live in separate stores under the same composite key, so `touch` —
// which the core calls on EVERY cached open — costs one tiny write instead of
// re-persisting a multi-megabyte score. get/list rejoin the two halves, so the
// seam above this module still sees one `StoredFileRecord`.
//
// SIZE LIVES WITH THE STAMP, NOT WITH THE BYTES (#352 review). It is a
// duplicate of `bytes.byteLength`, and that is the point: every arithmetic
// question the core asks (global usage, the cap/eviction pass, the profile
// page's partition-vs-others split) is a sum of sizes, and reaching it through
// the payload store means `getAll()` structured-clone-deserialising up to the
// whole 200MB cap into the JS heap to read numbers. With `size` in the
// metadata store, `listMeta` answers all of them from rows a few dozen bytes
// wide. The duplicate cannot drift: put writes both halves in ONE transaction
// from ONE record, delete removes both, and touch rewrites the stamp while
// carrying the existing size forward.
//
// The metadata row's EXISTENCE is what `touch` checks (payload and metadata
// are written and deleted together, in one transaction each way, so neither
// half exists without the other). Should a payload ever be read with no
// metadata row anyway, `get` reports `openedAt` 0 and `size` from the payload
// — oldest possible, so eviction claims it first rather than letting an
// unstamped row sit uncollectable, and `listMeta` simply does not see it.

import type {
	ByteStoreAdapter,
	ByteStoreKey,
	ByteStoreMeta,
	ByteStoreRow,
	StoredFileRecord
} from './byteStore';

const DB_NAME = 'mvox-byte-store';
// v3 = `size` moved into the recency row (#352 review), on top of v2's
// payload/recency split. Each bump is a CACHE FLUSH, not a migration:
// `onupgradeneeded` drops whatever is there and creates both stores empty.
// Everything in here is re-downloadable by definition, so carrying old rows
// across a layout change would be migration code written for no gain.
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

/**
 * The metadata half: the two numbers, no bytes. `listMeta` reads ONLY this
 * store, which is why it costs nothing against a full cache.
 */
interface RecencyRow {
	openedAt: number;
	size: number;
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
			const [row, meta] = await Promise.all([
				reqToPromise(payloadReq) as Promise<PayloadRow | undefined>,
				reqToPromise(recencyReq) as Promise<RecencyRow | undefined>
			]);
			if (!row) return undefined;
			// `size` comes from the metadata row when there is one (it is the
			// copy every sum is computed from, so a get must agree with it) and
			// falls back to the payload's own copy otherwise — see the module
			// head on the half-written row this module never produces.
			return { ...row.record, size: meta?.size ?? row.record.size, openedAt: meta?.openedAt ?? 0 };
		},

		async put(db, personId, fileId, record: StoredFileRecord) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			const { openedAt, ...payload } = record;
			const row: PayloadRow = { db, personId, fileId, record: payload };
			// BOTH halves from ONE record in ONE transaction — that is what keeps
			// the metadata copy of `size` from ever disagreeing with the bytes.
			const meta: RecencyRow = { openedAt, size: record.size };
			const tx = database.transaction([PAYLOAD_STORE, RECENCY_STORE], 'readwrite');
			const payloadReq = tx.objectStore(PAYLOAD_STORE).put(row, key);
			const recencyReq = tx.objectStore(RECENCY_STORE).put(meta, key);
			await Promise.all([reqToPromise(payloadReq), reqToPromise(recencyReq)]);
		},

		async touch(db, personId, fileId, openedAt) {
			const database = await getDb();
			const key = compositeKey(db, personId, fileId);
			// ONE store, ONE transaction: the existing metadata row is both the
			// existence check (put/delete write and remove both halves together,
			// so a metadata row means a held row) and the source of the `size`
			// that must survive the stamp move. It reads no bytes — a metadata
			// row is two numbers. Continuing the same tx across `await` is safe
			// because the await resolves in the request's own microtask; what
			// breaks a transaction is awaiting something that isn't its request.
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
			// THE EXPENSIVE READ, by definition: `getAll()` on the payload store
			// structured-clone-deserialises every stored ArrayBuffer, so this
			// costs the whole cache in JS heap. Nothing in the byteStore core
			// calls it (#352 review) — whoever does is asking for the bytes.
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
			// `getAllKeys` on the PAYLOAD store — the keys ARE the triple
			// (compositeKey above), so nothing needs to be read to recover
			// them, and no ArrayBuffer is structured-clone-deserialised. The
			// RECENCY store is not consulted: it carries no key the payload
			// store lacks (put/delete write and remove both halves together),
			// and a recency row with no payload is not a held file.
			const tx = database.transaction(PAYLOAD_STORE, 'readonly');
			const keys = await reqToPromise(tx.objectStore(PAYLOAD_STORE).getAllKeys());
			return keys.map((key): ByteStoreKey => {
				const [db, personId, fileId] = JSON.parse(String(key)) as [string, string, string];
				return { db, personId, fileId };
			});
		},

		async listMeta() {
			const database = await getDb();
			// THE METADATA STORE ONLY — the payload store is not in the
			// transaction at all, so there is no way for this to deserialise an
			// ArrayBuffer even by accident (#352 review). Keys come from
			// `getAllKeys` on the same store, values from `getAll`; IndexedDB
			// returns both in the same key order, which is what pairs them.
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
