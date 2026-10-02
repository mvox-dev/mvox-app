// The offline edition-file byte store keyed (db, personId, fileId); policy is in byteStoreCore.

// The partition is a correctness boundary, NOT A SECURITY BOUNDARY: storage is origin-scoped.
// The cap is a global cap; eviction is least-recently-opened across every partition.
// No ETag check: a CORS fetch cannot read it. Records carry a SHA-256 for #333's hash pin.

import type { CollectiveIdentity } from '$lib/collectives/store';

export { createByteStore } from './byteStoreCore';

export interface StoredFileRecord {
	bytes: ArrayBuffer;
	filetype: string;
	sha256: string;
	size: number;
	openedAt: number;
}

export interface ByteStoreRow {
	db: string;
	personId: string;
	fileId: string;
	record: StoredFileRecord;
}

export interface ByteStoreAdapter {
	get(db: string, personId: string, fileId: string): Promise<StoredFileRecord | undefined>;
	put(db: string, personId: string, fileId: string, record: StoredFileRecord): Promise<void>;
	// Moves the recency stamp only; reopening a held score must not rewrite its bytes.
	touch(db: string, personId: string, fileId: string, openedAt: number): Promise<void>;
	delete(db: string, personId: string, fileId: string): Promise<void>;
	// Full rows, bytes and all: the policy core never calls it; listKeys and listMeta read no payload.
	list(): Promise<ByteStoreRow[]>;
	listKeys(): Promise<ByteStoreKey[]>;
	listMeta(): Promise<ByteStoreMeta[]>;
}

export interface ByteStoreKey {
	db: string;
	personId: string;
	fileId: string;
}

export interface ByteStoreMeta extends ByteStoreKey {
	size: number;
	openedAt: number;
}

export interface ByteStore {
	get(identity: CollectiveIdentity | null, fileId: string): Promise<StoredFileRecord | undefined>;
	put(
		identity: CollectiveIdentity | null,
		fileId: string,
		data: { bytes: ArrayBuffer; filetype: string; sha256: string }
	): Promise<void>;
	evict(identity: CollectiveIdentity, fileId: string): Promise<void>;
	clearPartition(db: string, personId: string): Promise<void>;
	usage(): Promise<number>;
	// A presence query, NOT AN OPEN: no touch, so a render never reorders eviction.
	heldFileIds(db: string, personId: string): Promise<string[]>;
	usageForPartition(db: string, personId: string): Promise<{ count: number; size: number }>;
	usageForOthers(db: string, personId: string): Promise<{ count: number; size: number }>;
	clearAllPartitions(): Promise<void>;
	relieve(): Promise<RelieveResult>;
	setProtectedKeys(keys: ReadonlySet<string>): void;
}

export const BYTE_STORE_CAP_BYTES = 200 * 1024 * 1024;

export const PRESSURE_RATIO = 0.8;

export type RelieveResult =
	| { outcome: 'unsupported' }
	| { outcome: 'swept'; before: number; after: number; removed: ByteStoreKey[] };
