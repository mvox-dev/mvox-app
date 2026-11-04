// What waits on the device for Entu (#1069), keyed (db, personId, ...) like #343's parts: a page
// whose ink is to be sent, and the page she was on. A changed item gets a new rev, so a send
// that read the old one does not delete it.
import type { CollectiveIdentity } from '$lib/collectives/store';
import { compositeKey, lazyDb, reqToPromise, type FileKey } from '$lib/files/idb';
import type { InkPage } from './inkLog';

export type InkSyncItem = InkPage & { kind: 'ink' | 'place'; rev: string };

export interface InkSyncQueue {
	markInk(at: InkPage): Promise<void>;
	/** Her page on this device, waiting to be sent. */
	setPlace(part: FileKey, page: number): Promise<void>;
	/** Her page from Entu, kept unless a page of this device's own still waits to be sent. */
	adoptPlace(part: FileKey, page: number): Promise<boolean>;
	placeOf(part: FileKey): Promise<number | null>;
	list(identity: CollectiveIdentity): Promise<InkSyncItem[]>;
	done(item: InkSyncItem): Promise<void>;
}

const DB_NAME = 'mvox-ink-sync';
const DB_VERSION = 1;
const WAITING = 'waiting';
const PLACES = 'places';

function itemKey(item: Pick<InkSyncItem, 'db' | 'personId' | 'fileId' | 'kind' | 'page'>): string {
	const third = item.kind === 'place' ? `${item.fileId}#place` : `${item.fileId}#${item.page}`;
	return compositeKey(item.db, item.personId, third);
}

const placeKey = (part: FileKey) => compositeKey(part.db, part.personId, part.fileId);

export function createInkSyncQueue(factory?: IDBFactory): InkSyncQueue {
	const getDb = lazyDb(factory ?? indexedDB, DB_NAME, DB_VERSION, (database) => {
		database.createObjectStore(WAITING);
		database.createObjectStore(PLACES);
	});

	async function put(item: Omit<InkSyncItem, 'rev'>, place?: number): Promise<void> {
		const database = await getDb();
		const tx = database.transaction([WAITING, PLACES], 'readwrite');
		const row: InkSyncItem = { ...item, rev: crypto.randomUUID() };
		const writes = [reqToPromise(tx.objectStore(WAITING).put(row, itemKey(row)))];
		if (place !== undefined) writes.push(reqToPromise(tx.objectStore(PLACES).put(place, placeKey(item))));
		await Promise.all(writes);
	}

	return {
		markInk(at) {
			return put({ ...at, kind: 'ink' });
		},

		setPlace(part, page) {
			return put({ ...part, page, kind: 'place' }, page);
		},

		async adoptPlace(part, page) {
			const database = await getDb();
			const tx = database.transaction([WAITING, PLACES], 'readwrite');
			const waiting = await reqToPromise(
				tx.objectStore(WAITING).get(itemKey({ ...part, kind: 'place', page }))
			);
			if (waiting !== undefined) return false;
			await reqToPromise(tx.objectStore(PLACES).put(page, placeKey(part)));
			return true;
		},

		async placeOf(part) {
			const database = await getDb();
			const req = database.transaction(PLACES, 'readonly').objectStore(PLACES).get(placeKey(part));
			const page = await reqToPromise(req);
			return typeof page === 'number' ? page : null;
		},

		async list({ db, personId }) {
			const database = await getDb();
			const rows = (await reqToPromise(
				database.transaction(WAITING, 'readonly').objectStore(WAITING).getAll()
			)) as InkSyncItem[];
			return rows.filter((row) => row.db === db && row.personId === personId);
		},

		async done(item) {
			const database = await getDb();
			const store = database.transaction(WAITING, 'readwrite').objectStore(WAITING);
			const key = itemKey(item);
			const now = (await reqToPromise(store.get(key))) as InkSyncItem | undefined;
			if (now?.rev === item.rev) await reqToPromise(store.delete(key));
		}
	};
}

// (*MVOX:Josquin*)
