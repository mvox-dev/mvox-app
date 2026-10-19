// The label index (#353): work, composer, edition and filename per held file, beside the bytes.
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { FileKey } from './idb';
import type { FileBytesDeliveryReason } from './openFileBytes';

export interface PartLabel {
	work: string;
	composer: string;
	edition: string;
	filename: string;
}

export interface LabelStoreAdapter {
	get(key: FileKey): Promise<PartLabel | undefined>;
	put(key: FileKey, label: PartLabel): Promise<void>;
	delete(key: FileKey): Promise<void>;
	listFor(identity: CollectiveIdentity): Promise<Array<{ fileId: string; label: PartLabel }>>;
}

export interface LabelStore {
	putLabel(key: FileKey, label: PartLabel): Promise<void>;
	labelsFor(identity: CollectiveIdentity): Promise<Map<string, PartLabel>>;
	remove(key: FileKey): Promise<void>;
}

export function createLabelStore(adapter: LabelStoreAdapter): LabelStore {
	return {
		async putLabel(key, label) {
			await adapter.put(key, label);
		},
		async labelsFor(identity) {
			const rows = await adapter.listFor(identity);
			return new Map(rows.map((row) => [row.fileId, row.label]));
		},
		async remove(key) {
			await adapter.delete(key);
		}
	};
}

// Written only when the device holds the bytes, or an orphan name would be minted on purpose.
export function recordPartLabel(
	store: LabelStore,
	key: FileKey,
	label: PartLabel,
	reason: FileBytesDeliveryReason
): Promise<void> {
	if (reason !== 'network-stored' && reason !== 'cache') return Promise.resolve();
	// A failed label write must never gate the open it names.
	return store.putLabel(key, label).catch(() => {});
}

export async function storedPartLabel(
	store: LabelStore,
	key: FileKey
): Promise<PartLabel | undefined> {
	try {
		return (await store.labelsFor(key)).get(key.fileId);
	} catch {
		return undefined;
	}
}

