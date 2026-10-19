// The byte store's policy: partition keys, the global cap, eviction and the pressure sweep.
import {
	BYTE_STORE_CAP_BYTES,
	PRESSURE_RATIO,
	type ByteStore,
	type ByteStoreAdapter,
	type ByteStoreMeta,
	type RelieveResult,
	type StoredFileRecord
} from './byteStore';
import type { FileKey } from './idb';

// Strictly below this after a sweep, so the next put does not trigger another at once.
const PRESSURE_RELIEF_TARGET = 0.7;

export function createByteStore(
	adapter: ByteStoreAdapter,
	opts?: {
		capBytes?: number;
		// Fired for every key the store stops holding; the label store rides it, never awaited.
		onRowRemoved?: (key: FileKey) => void;
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

	// Just the key's own fields: a stats row handed in would otherwise leak size and openedAt.
	function plainKey(key: FileKey): FileKey {
		return { db: key.db, personId: key.personId, fileId: key.fileId };
	}

	function keyStr(key: FileKey): string {
		return JSON.stringify([key.db, key.personId, key.fileId]);
	}

	function isProtected(key: FileKey): boolean {
		return protectedKeys.has(keyStr(key));
	}

	function sameKey(a: FileKey, b: FileKey): boolean {
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
		exceptKey?: FileKey
	): Promise<{ removed: FileKey[]; freed: number }> {
		let metas = await adapter.listMeta();
		const removed: FileKey[] = [];
		let freed = 0;
		while (!enough(freed)) {
			const candidates = metas.filter(
				(meta) => !isProtected(meta) && !(exceptKey && sameKey(meta, exceptKey))
			);
			if (candidates.length === 0) break;
			const oldest = candidates.reduce((a, b) => (a.openedAt <= b.openedAt ? a : b));
			const key = plainKey(oldest);
			await adapter.delete(key);
			onRowRemoved?.(key);
			removed.push(key);
			freed += oldest.size;
			metas = metas.filter((meta) => meta !== oldest);
		}
		return { removed, freed };
	}

	async function sweepPressure(exceptKey?: FileKey): Promise<RelieveResult> {
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

	async function evictUntilFits(neededBytes: number, exceptKey: FileKey) {
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
			const key = plainKey(oldest);
			await adapter.delete(key);
			onRowRemoved?.(key);
			usage -= oldest.size;
			metas = metas.filter((meta) => meta !== oldest);
		}
	}

	function tally(metas: ByteStoreMeta[], keep: (meta: ByteStoreMeta) => boolean) {
		const kept = metas.filter(keep);
		return { count: kept.length, size: kept.reduce((sum, meta) => sum + meta.size, 0) };
	}

	return {
		async get(key) {
			const record = await adapter.get(key);
			if (!record) return undefined;
			const openedAt = Date.now();
			await adapter.touch(key, openedAt);
			return { ...record, openedAt };
		},

		async put(fileKey, data) {
			if (data.bytes.byteLength > capBytes) {
				throw new Error(
					`byteStore: record for ${fileKey.fileId} (${data.bytes.byteLength}B) exceeds the cap (${capBytes}B)`
				);
			}
			const record: StoredFileRecord = {
				bytes: data.bytes,
				filetype: data.filetype,
				sha256: data.sha256,
				size: data.bytes.byteLength,
				openedAt: Date.now()
			};
			const key = plainKey(fileKey);
			await evictUntilFits(record.size, key);
			try {
				await adapter.put(key, record);
			} catch (err) {
				// The quota error is proof the device is full, whatever estimate() says, so this
				// frees the record's size without the ratio gate, then retries once.
				if (!isQuotaError(err)) throw err;
				await evictOldestUntil((freedBytes) => freedBytes >= record.size, key);
				await adapter.put(key, record);
			}
			await sweepPressure(key);
		},

		async evict(fileKey) {
			const key = plainKey(fileKey);
			await adapter.delete(key);
			onRowRemoved?.(key);
		},

		async clearPartition(identity) {
			const keys = await adapter.listKeys();
			for (const key of keys) {
				if (key.db === identity.db && key.personId === identity.personId) {
					await adapter.delete(key);
					onRowRemoved?.(key);
				}
			}
		},

		async usage() {
			const metas = await adapter.listMeta();
			return metas.reduce((sum, meta) => sum + meta.size, 0);
		},

		async heldFileIds(identity) {
			const keys = await adapter.listKeys();
			return keys
				.filter((key) => key.db === identity.db && key.personId === identity.personId)
				.map((key) => key.fileId);
		},

		async usageForPartition(identity) {
			return tally(
				await adapter.listMeta(),
				(meta) => meta.db === identity.db && meta.personId === identity.personId
			);
		},

		async usageForOthers(identity) {
			return tally(
				await adapter.listMeta(),
				(meta) => !(meta.db === identity.db && meta.personId === identity.personId)
			);
		},

		async clearAllPartitions() {
			const keys = await adapter.listKeys();
			for (const key of keys) {
				await adapter.delete(key);
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
