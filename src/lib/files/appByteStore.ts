// #343 — the app-wide byte store singleton (IndexedDB-backed).
//
// Page handlers reach the store ONLY through this seam, so page specs can
// substitute an in-memory store (see $lib/testing/byteStoreFakes) without
// touching IndexedDB.

import { createByteStore, type ByteStore } from './byteStore';
import { createIdbAdapter } from './idbAdapter';

let instance: ByteStore | null = null;

export function getAppByteStore(): ByteStore {
	if (!instance) instance = createByteStore(createIdbAdapter());
	return instance;
}

// (*MVOX:Josquin*)
