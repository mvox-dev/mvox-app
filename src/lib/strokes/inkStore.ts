// Her ink on a part, kept on the device per (db, personId, file, page) like #343's part files,
// and synced through Entu (#1069): the device answers first, so a part opens offline. An erase
// is a tombstone, so two devices' logs union. Nothing clears it at sign-out or expiry (#434).
import { compositeKey, lazyDb, type FileKey, reqToPromise } from '$lib/files/idb';
import { emptyLog, joinLogs, liveInk, type InkLog, type InkPage } from './inkLog';
import type { StrokeData } from './strokes';

export { liveInk, type InkLog, type InkPage };

export interface InkStore {
	load(at: InkPage): Promise<InkLog>;
	save(at: InkPage, ink: StrokeData): Promise<void>;
}

/** The device store: a log from elsewhere is joined in, in one transaction. */
export interface DeviceInkStore extends InkStore {
	merge(at: InkPage, log: InkLog): Promise<InkLog>;
}

/** Her ink and page as Entu holds them; null when Entu cannot be asked now. */
export interface RemoteInk {
	pages: Record<number, InkLog>;
	page: number | null;
}

/** A device store that also syncs: her logs from Entu, and the page she was on. */
export interface SyncedInkStore extends DeviceInkStore {
	pull(part: FileKey): Promise<RemoteInk | null>;
	placeOf(part: FileKey): Promise<number | null>;
	turn(part: FileKey, page: number): Promise<void>;
}

export function isSynced(store: InkStore | null): store is SyncedInkStore {
	return store !== null && 'pull' in store;
}

const DB_NAME = 'mvox-ink';
const DB_VERSION = 1;
const STORE = 'pages';

function pageKey(at: InkPage): string {
	return compositeKey(at.db, at.personId, `${at.fileId}#${at.page}`);
}

/** The log after the page came to show `ink`: unmatched marks are added, missing ones erased. */
function nextLog(log: InkLog, ink: StrokeData): InkLog {
	const erased = new Set(log.erased);
	const unmatched = new Map<string, string[]>();
	for (const { id, stroke } of log.strokes) {
		if (erased.has(id)) continue;
		const text = JSON.stringify(stroke);
		unmatched.set(text, [...(unmatched.get(text) ?? []), id]);
	}
	const added: InkLog['strokes'] = [];
	for (const stroke of ink.strokes) {
		const ids = unmatched.get(JSON.stringify(stroke));
		if (ids?.length) ids.shift();
		else added.push({ id: crypto.randomUUID(), stroke });
	}
	const gone = [...unmatched.values()].flat();
	return { v: 1, strokes: [...log.strokes, ...added], erased: [...log.erased, ...gone] };
}

export function createInkStore(factory?: IDBFactory): DeviceInkStore {
	const getDb = lazyDb(factory ?? indexedDB, DB_NAME, DB_VERSION, (database) => {
		database.createObjectStore(STORE);
	});

	return {
		async load(at) {
			const database = await getDb();
			const req = database.transaction(STORE, 'readonly').objectStore(STORE).get(pageKey(at));
			return ((await reqToPromise(req)) as InkLog | undefined) ?? emptyLog();
		},

		// Read and write in one transaction, so saves in quick succession apply in order.
		async save(at, ink) {
			const database = await getDb();
			const store = database.transaction(STORE, 'readwrite').objectStore(STORE);
			const key = pageKey(at);
			const log = ((await reqToPromise(store.get(key))) as InkLog | undefined) ?? emptyLog();
			await reqToPromise(store.put(nextLog(log, ink), key));
		},

		async merge(at, remote) {
			const database = await getDb();
			const store = database.transaction(STORE, 'readwrite').objectStore(STORE);
			const key = pageKey(at);
			const log = ((await reqToPromise(store.get(key))) as InkLog | undefined) ?? emptyLog();
			const joined = joinLogs(log, remote);
			await reqToPromise(store.put(joined, key));
			return joined;
		}
	};
}

// (*MVOX:Josquin*)
