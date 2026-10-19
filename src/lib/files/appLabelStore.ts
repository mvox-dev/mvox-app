// #353 — the app-wide label store: pages reach the label index only here, so specs can swap it.

import type { LabelStore } from './labelStore';
import { createIdbLabelStore } from './labelIdbAdapter';

let instance: LabelStore | null = null;

export function getAppLabelStore(): LabelStore {
	if (!instance) instance = createIdbLabelStore();
	return instance;
}

// (*MVOX:Josquin* — #353 GREEN)
