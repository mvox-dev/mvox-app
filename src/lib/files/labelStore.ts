// The label index (#353): work, composer, edition and filename per held file, beside the bytes.
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { FileBytesDeliveryReason } from './openFileBytes';

export interface PartLabel {
	work: string;
	composer: string;
	edition: string;
	filename: string;
}

export interface LabelStoreAdapter {
	get(db: string, personId: string, fileId: string): Promise<PartLabel | undefined>;
	put(db: string, personId: string, fileId: string, label: PartLabel): Promise<void>;
	delete(db: string, personId: string, fileId: string): Promise<void>;
	listFor(db: string, personId: string): Promise<Array<{ fileId: string; label: PartLabel }>>;
}

export interface LabelStore {
	putLabel(identity: CollectiveIdentity | null, fileId: string, label: PartLabel): Promise<void>;
	labelsFor(db: string, personId: string): Promise<Map<string, PartLabel>>;
	remove(key: { db: string; personId: string; fileId: string }): Promise<void>;
}

function requireIdentity(identity: CollectiveIdentity | null): CollectiveIdentity {
	if (identity === null) {
		throw new Error('labelStore: no identity — anonymous access has no partition key');
	}
	return identity;
}

export function createLabelStore(adapter: LabelStoreAdapter): LabelStore {
	return {
		async putLabel(identity, fileId, label) {
			const id = requireIdentity(identity);
			await adapter.put(id.db, id.personId, fileId, label);
		},
		async labelsFor(db, personId) {
			const rows = await adapter.listFor(db, personId);
			return new Map(rows.map((row) => [row.fileId, row.label]));
		},
		async remove(key) {
			await adapter.delete(key.db, key.personId, key.fileId);
		}
	};
}

// Written only when the device holds the bytes, or an orphan name would be minted on purpose.
export function recordPartLabel(
	store: LabelStore,
	identity: CollectiveIdentity | null,
	fileId: string,
	label: PartLabel,
	reason: FileBytesDeliveryReason
): void {
	if (reason !== 'network-stored' && reason !== 'cache') return;
	// A failed label write must never gate the open it names.
	store.putLabel(identity, fileId, label).catch(() => {});
}

export async function storedPartLabel(
	store: LabelStore,
	db: string,
	personId: string,
	fileId: string
): Promise<PartLabel | undefined> {
	try {
		return (await store.labelsFor(db, personId)).get(fileId);
	} catch {
		return undefined;
	}
}

