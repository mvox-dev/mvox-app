// The offline edition-file byte store keyed (db, personId, fileId); policy is in byteStoreCore.

// The partition is a correctness boundary, NOT A SECURITY BOUNDARY: storage is origin-scoped.
// The cap is a global cap; eviction is least-recently-opened across every partition.
// No ETag check: a CORS fetch cannot read it. Records carry a SHA-256 for #333's hash pin.

import type { CollectiveIdentity } from '$lib/collectives/store';
import type { FileKey } from './idb';

export { createByteStore } from './byteStoreCore';

export interface StoredFileRecord {
	bytes: ArrayBuffer;
	filetype: string;
	sha256: string;
	size: number;
	openedAt: number;
}

export interface ByteStoreRow extends FileKey {
	record: StoredFileRecord;
}

export interface ByteStoreAdapter {
	get(key: FileKey): Promise<StoredFileRecord | undefined>;
	put(key: FileKey, record: StoredFileRecord): Promise<void>;
	// Moves the recency stamp only; reopening a held score must not rewrite its bytes.
	touch(key: FileKey, openedAt: number): Promise<void>;
	delete(key: FileKey): Promise<void>;
	// Full rows, bytes and all: the policy core never calls it; listKeys and listMeta read no payload.
	list(): Promise<ByteStoreRow[]>;
	listKeys(): Promise<FileKey[]>;
	listMeta(): Promise<ByteStoreMeta[]>;
}

export interface ByteStoreMeta extends FileKey {
	size: number;
	openedAt: number;
}

export interface ByteStore {
	get(key: FileKey): Promise<StoredFileRecord | undefined>;
	put(key: FileKey, data: { bytes: ArrayBuffer; filetype: string; sha256: string }): Promise<void>;
	evict(key: FileKey): Promise<void>;
	clearPartition(identity: CollectiveIdentity): Promise<void>;
	usage(): Promise<number>;
	// A presence query, NOT AN OPEN: no touch, so a render never reorders eviction.
	heldFileIds(identity: CollectiveIdentity): Promise<string[]>;
	usageForPartition(identity: CollectiveIdentity): Promise<{ count: number; size: number }>;
	usageForOthers(identity: CollectiveIdentity): Promise<{ count: number; size: number }>;
	clearAllPartitions(): Promise<void>;
	relieve(): Promise<RelieveResult>;
	setProtectedKeys(keys: ReadonlySet<string>): void;
}

export const BYTE_STORE_CAP_BYTES = 200 * 1024 * 1024;

export const PRESSURE_RATIO = 0.8;

export type RelieveResult =
	| { outcome: 'unsupported' }
	| { outcome: 'swept'; before: number; after: number; removed: FileKey[] };
