// The byte store's policy: partition keys, the global cap, eviction and the pressure sweep.
import type { CollectiveIdentity } from '$lib/collectives/store';
import {
	BYTE_STORE_CAP_BYTES,
	PRESSURE_RATIO,
	type ByteStore,
	type ByteStoreAdapter,
	type ByteStoreKey,
	type ByteStoreMeta,
	type RelieveResult,
	type StoredFileRecord
} from './byteStore';

// Strictly below this after a sweep, so the next put does not trigger another at once.
const PRESSURE_RELIEF_TARGET = 0.7;

function requireIdentity(identity: CollectiveIdentity | null): CollectiveIdentity {
	if (identity === null) {
		throw new Error('byteStore: no identity — anonymous access has no partition key');
	}
	return identity;
}

export function createByteStore(
	adapter: ByteStoreAdapter,
	opts?: {
		capBytes?: number;
		// Fired for every key the store stops holding; the label store rides it, never awaited.
		onRowRemoved?: (key: ByteStoreKey) => void;
		estimate?: () => Promise<{ usage?: number; quota?: number }>;
	}
): ByteStore {
	const capBytes = opts?.capBytes ?? BYTE_STORE_CAP_BYTES;
	const onRowRemoved = opts?.onRowRemoved;
	// Absent outside a browser, where relieve() answers 'unsupported' rather than guessing.
	const estimate =
		opts?.estimate ??
		(typeof navigator !== 'undefined' && navigator.storage
			? () => navigator.storage.estimate()
			: undefined);

	let protectedKeys: ReadonlySet<string> = new Set();

	function keyStr(key: ByteStoreKey): string {
		return JSON.stringify([key.db, key.personId, key.fileId]);
	}

	function isProtected(key: ByteStoreKey): boolean {
		return protectedKeys.has(keyStr(key));
	}

	function sameKey(a: ByteStoreKey, b: ByteStoreKey): boolean {
		return a.db === b.db && a.personId === b.personId && a.fileId === b.fileId;
	}

	function isQuotaError(err: unknown): boolean {
		return (
			typeof err === 'object' &&
			err !== null &&
			(err as { name?: unknown }).name === 'QuotaExceededError'
		);
	}

	// One listMeta() read feeds the run, and no get or touch: eviction must not move a stamp.
	async function evictOldestUntil(
		enough: (freedBytes: number) => boolean,
		exceptKey?: ByteStoreKey
	): Promise<{ removed: ByteStoreKey[]; freed: number }> {
		let metas = await adapter.listMeta();
		const removed: ByteStoreKey[] = [];
		let freed = 0;
		while (!enough(freed)) {
			const candidates = metas.filter(
				(meta) => !isProtected(meta) && !(exceptKey && sameKey(meta, exceptKey))
			);
			if (candidates.length === 0) break;
			const oldest = candidates.reduce((a, b) => (a.openedAt <= b.openedAt ? a : b));
			await adapter.delete(oldest.db, oldest.personId, oldest.fileId);
			const key: ByteStoreKey = {
				db: oldest.db,
				personId: oldest.personId,
				fileId: oldest.fileId
			};
			onRowRemoved?.(key);
			removed.push(key);
			freed += oldest.size;
			metas = metas.filter((meta) => meta !== oldest);
		}
		return { removed, freed };
	}

	async function sweepPressure(exceptKey?: ByteStoreKey): Promise<RelieveResult> {
		if (!estimate) return { outcome: 'unsupported' };
		const est = await estimate();
		if (est.usage === undefined || est.quota === undefined || est.quota <= 0) {
			return { outcome: 'unsupported' };
		}
		const quota = est.quota;
		const usage = est.usage;
		const before = usage / quota;

		// This runs after every put, so below the line it reads no metadata at all.
		if (before < PRESSURE_RATIO) {
			return { outcome: 'swept', before, after: before, removed: [] };
		}

		const { removed, freed } = await evictOldestUntil(
			(freedBytes) => (usage - freedBytes) / quota < PRESSURE_RELIEF_TARGET,
			exceptKey
		);
		return { outcome: 'swept', before, after: (usage - freed) / quota, removed };
	}

	async function evictUntilFits(neededBytes: number, exceptKey: ByteStoreKey) {
		const isIncoming = (meta: ByteStoreMeta) => sameKey(meta, exceptKey);
		// A protected row is never a candidate, but only the overwritten row leaves the usage sum.
		const isExcepted = (meta: ByteStoreMeta) => isIncoming(meta) || isProtected(meta);

		let metas = await adapter.listMeta();
		let usage = metas.reduce((sum, meta) => sum + meta.size, 0);
		const existing = metas.find(isIncoming);
		if (existing) usage -= existing.size;

		while (usage + neededBytes > capBytes) {
			const candidates = metas.filter((meta) => !isExcepted(meta));
			if (candidates.length === 0) break;
			const oldest = candidates.reduce((a, b) => (a.openedAt <= b.openedAt ? a : b));
			await adapter.delete(oldest.db, oldest.personId, oldest.fileId);
			onRowRemoved?.({ db: oldest.db, personId: oldest.personId, fileId: oldest.fileId });
			usage -= oldest.size;
			metas = metas.filter((meta) => meta !== oldest);
		}
	}

	function tally(metas: ByteStoreMeta[], keep: (meta: ByteStoreMeta) => boolean) {
		const kept = metas.filter(keep);
		return { count: kept.length, size: kept.reduce((sum, meta) => sum + meta.size, 0) };
	}

	return {
		async get(identity, fileId) {
			const id = requireIdentity(identity);
			const record = await adapter.get(id.db, id.personId, fileId);
			if (!record) return undefined;
			const openedAt = Date.now();
			await adapter.touch(id.db, id.personId, fileId, openedAt);
			return { ...record, openedAt };
		},

		async put(identity, fileId, data) {
			const id = requireIdentity(identity);
			if (data.bytes.byteLength > capBytes) {
				throw new Error(
					`byteStore: record for ${fileId} (${data.bytes.byteLength}B) exceeds the cap (${capBytes}B)`
				);
			}
			const record: StoredFileRecord = {
				bytes: data.bytes,
				filetype: data.filetype,
				sha256: data.sha256,
				size: data.bytes.byteLength,
				openedAt: Date.now()
			};
			const key: ByteStoreKey = { db: id.db, personId: id.personId, fileId };
			await evictUntilFits(record.size, key);
			try {
				await adapter.put(id.db, id.personId, fileId, record);
			} catch (err) {
				// The quota error is proof the device is full, whatever estimate() says, so this
				// frees the record's size without the ratio gate, then retries once.
				if (!isQuotaError(err)) throw err;
				await evictOldestUntil((freedBytes) => freedBytes >= record.size, key);
				await adapter.put(id.db, id.personId, fileId, record);
			}
			await sweepPressure(key);
		},

		async evict(identity, fileId) {
			await adapter.delete(identity.db, identity.personId, fileId);
			onRowRemoved?.({ db: identity.db, personId: identity.personId, fileId });
		},

		async clearPartition(db, personId) {
			const keys = await adapter.listKeys();
			for (const key of keys) {
				if (key.db === db && key.personId === personId) {
					await adapter.delete(key.db, key.personId, key.fileId);
					onRowRemoved?.(key);
				}
			}
		},

		async usage() {
			const metas = await adapter.listMeta();
			return metas.reduce((sum, meta) => sum + meta.size, 0);
		},

		async heldFileIds(db, personId) {
			const keys = await adapter.listKeys();
			return keys
				.filter((key) => key.db === db && key.personId === personId)
				.map((key) => key.fileId);
		},

		async usageForPartition(db, personId) {
			return tally(
				await adapter.listMeta(),
				(meta) => meta.db === db && meta.personId === personId
			);
		},

		async usageForOthers(db, personId) {
			return tally(
				await adapter.listMeta(),
				(meta) => !(meta.db === db && meta.personId === personId)
			);
		},

		async clearAllPartitions() {
			const keys = await adapter.listKeys();
			for (const key of keys) {
				await adapter.delete(key.db, key.personId, key.fileId);
				onRowRemoved?.(key);
			}
		},

		async relieve() {
			return sweepPressure();
		},

		setProtectedKeys(keys) {
			protectedKeys = keys;
		}
	};
}

// (*MVOX:Josquin*)
