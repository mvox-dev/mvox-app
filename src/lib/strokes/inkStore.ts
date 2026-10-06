// Her ink on a part, kept on the device per (db, personId, file, page) like #343's part files.
// Strokes only add: an erase stores the stroke's id as a tombstone, so a later sync can union
// two devices' logs (#333). Nothing clears it at sign-out or expiry (#434).
import { compositeKey, lazyDb, reqToPromise } from '$lib/files/idb';
import type { Stroke, StrokeData } from './strokes';

export interface InkPage {
	db: string;
	personId: string;
	fileId: string;
	page: number;
}

export interface InkLog {
	v: 1;
	strokes: Array<{ id: string; stroke: Stroke }>;
	erased: string[];
}

export interface InkStore {
	load(at: InkPage): Promise<InkLog>;
	save(at: InkPage, ink: StrokeData): Promise<void>;
}

const DB_NAME = 'mvox-ink';
const DB_VERSION = 1;
const STORE = 'pages';

function emptyLog(): InkLog {
	return { v: 1, strokes: [], erased: [] };
}

function pageKey(at: InkPage): string {
	return compositeKey(at.db, at.personId, `${at.fileId}#${at.page}`);
}

export function liveInk(log: InkLog): StrokeData {
	const erased = new Set(log.erased);
	return { v: 1, strokes: log.strokes.filter((s) => !erased.has(s.id)).map((s) => s.stroke) };
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

export function createInkStore(factory?: IDBFactory): InkStore {
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
		}
	};
}

let instance: InkStore | null = null;

/** Null on a device with no IndexedDB: ink then lasts the session only. */
export function getInkStore(): InkStore | null {
	if (typeof indexedDB === 'undefined') return null;
	instance ??= createInkStore();
	return instance;
}

// (*MVOX:Josquin*)
