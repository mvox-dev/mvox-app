// The app-wide byte store (#343): pages reach it only here, so specs can swap in a fake.

import { createByteStore, type ByteStore } from './byteStore';
import { createIdbAdapter } from './idbAdapter';
import { getAppLabelStore } from './appLabelStore';
import { reportLabelProblem } from './labelStore';

let instance: ByteStore | null = null;

export function getAppByteStore(): ByteStore {
	if (!instance) {
		instance = createByteStore(createIdbAdapter(), {
			// Any eviction drops the part's name too (#353); never awaited, so it never gates the store.
			onRowRemoved: (key) => {
				void getAppLabelStore()
					.remove(key)
					.catch((error) => reportLabelProblem('removing a part name from this device', error));
			}
		});
	}
	return instance;
}

// (*MVOX:Josquin*)
