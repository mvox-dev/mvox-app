// #343 — the app-wide byte store singleton (IndexedDB-backed).
//
// Page handlers reach the store ONLY through this seam, so page specs can
// substitute an in-memory store (see $lib/testing/byteStoreFakes) without
// touching IndexedDB.

import { createByteStore, type ByteStore } from './byteStore';
import { createIdbAdapter } from './idbAdapter';
import { getAppLabelStore } from './appLabelStore';

let instance: ByteStore | null = null;

export function getAppByteStore(): ByteStore {
	if (!instance) {
		instance = createByteStore(createIdbAdapter(), {
			// #353 — eviction anywhere (an explicit remove, a partition clear, a
			// silent LRU cap eviction) removes the part's NAME too, via the
			// label index's own store (appLabelStore.ts). Never awaited: a label
			// removal failing must not slow or gate a byte-store operation.
			onRowRemoved: (key) => {
				void getAppLabelStore()
					.remove(key)
					.catch(() => {});
			}
		});
	}
	return instance;
}

// (*MVOX:Josquin*)
