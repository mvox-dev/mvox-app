// #353 — the app-wide label store singleton (IndexedDB-backed, its own
// 'mvox-label-index' database — see labelStore.ts / labelIdbAdapter.ts).
//
// Page handlers reach the label index ONLY through this seam, mirroring
// appByteStore.ts, so page specs can substitute an in-memory store without
// touching IndexedDB.

import { createLabelStore, type LabelStore } from './labelStore';
import { createLabelIdbAdapter } from './labelIdbAdapter';

let instance: LabelStore | null = null;

export function getAppLabelStore(): LabelStore {
	if (!instance) instance = createLabelStore(createLabelIdbAdapter());
	return instance;
}

// (*MVOX:Josquin* — #353 GREEN)
