// The label index (#353): work, composer, edition and filename per held file, beside the bytes.
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { FileKey } from './idb';
import { holdsOfflineCopy, type FileBytesDeliveryReason } from './openFileBytes';

export interface PartLabel {
	work: string;
	composer: string;
	edition: string;
	filename: string;
}

export interface LabelStore {
	putLabel(key: FileKey, label: PartLabel): Promise<void>;
	labelOf(key: FileKey): Promise<PartLabel | undefined>;
	labelsFor(identity: CollectiveIdentity): Promise<Map<string, PartLabel>>;
	remove(key: FileKey): Promise<void>;
}

// Written only when the device holds the bytes, or an orphan name would be minted on purpose.
export function recordPartLabel(
	store: LabelStore,
	key: FileKey,
	label: PartLabel,
	reason: FileBytesDeliveryReason
): Promise<void> {
	if (!holdsOfflineCopy(reason)) return Promise.resolve();
	// A failed label write must never gate the open it names.
	return store.putLabel(key, label).catch(() => {});
}

export async function storedPartLabel(
	store: LabelStore,
	key: FileKey
): Promise<PartLabel | undefined> {
	try {
		return await store.labelOf(key);
	} catch {
		return undefined;
	}
}

