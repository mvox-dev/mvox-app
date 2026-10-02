// IndexedDB helpers shared by the byte store, the label index and the read cache.

// A JSON triple, not a delimited string: no part controls its shape enough to avoid a separator.
export function compositeKey(db: string, personId: string, third: string): string {
	return JSON.stringify([db, personId, third]);
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function openDb(
	factory: IDBFactory,
	name: string,
	version: number,
	upgrade: (database: IDBDatabase) => void
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = factory.open(name, version);
		req.onupgradeneeded = () => upgrade(req.result);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** Returns a getDb that opens the database on its first call and shares that open after. */
export function lazyDb(
	factory: IDBFactory,
	name: string,
	version: number,
	upgrade: (database: IDBDatabase) => void
): () => Promise<IDBDatabase> {
	let dbPromise: Promise<IDBDatabase> | null = null;
	return function getDb() {
		if (!dbPromise) dbPromise = openDb(factory, name, version, upgrade);
		return dbPromise;
	};
}
