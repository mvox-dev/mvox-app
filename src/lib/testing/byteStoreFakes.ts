// In-memory doubles for the byte-store platform seams, never for the subject under test (#343).
// createFakeAdapter drives the real createByteStore; createFakeByteStore serves page specs.

import type {
	ByteStore,
	ByteStoreAdapter,
	ByteStoreKey,
	ByteStoreRow,
	StoredFileRecord
} from '$lib/files/byteStore';
import type { CollectiveIdentity } from '$lib/collectives/store';

// Keyed as the real adapter keys (idbAdapter.ts): a JSON triple, so no separator can collide.
function key(db: string, personId: string, fileId: string): string {
	return JSON.stringify([db, personId, fileId]);
}

function triple(k: string): [db: string, personId: string, fileId: string] {
	return JSON.parse(k) as [string, string, string];
}

export interface FakeAdapter extends ByteStoreAdapter {
	rows(): ByteStoreRow[];
	/** Every record EVER handed to put(), in order — survives deletes. */
	putLog: Array<{ db: string; personId: string; fileId: string; record: StoredFileRecord }>;
	/** Every touch() call, in order: pins that a cached open moves recency without a rewrite. */
	touchLog: Array<{ db: string; personId: string; fileId: string; openedAt: number }>;
}

export function createFakeAdapter(): FakeAdapter {
	const map = new Map<string, ByteStoreRow>();
	// Separate from `map`, as in the real adapter: listMeta must not touch the payloads (#352).
	const meta = new Map<string, { size: number; openedAt: number }>();
	const putLog: FakeAdapter['putLog'] = [];
	const touchLog: FakeAdapter['touchLog'] = [];
	return {
		putLog,
		touchLog,
		async get(db, personId, fileId) {
			return map.get(key(db, personId, fileId))?.record;
		},
		async put(db, personId, fileId, record) {
			putLog.push({ db, personId, fileId, record });
			map.set(key(db, personId, fileId), { db, personId, fileId, record });
			meta.set(key(db, personId, fileId), { size: record.size, openedAt: record.openedAt });
		},
		async touch(db, personId, fileId, openedAt) {
			const k = key(db, personId, fileId);
			const held = map.get(k);
			// Recency without a payload is not a row (the adapter contract).
			if (!held) return;
			touchLog.push({ db, personId, fileId, openedAt });
			map.set(k, { ...held, record: { ...held.record, openedAt } });
			// The stamp moves in both halves, so the metadata never drifts from the row.
			meta.set(k, { size: held.record.size, openedAt });
		},
		async delete(db, personId, fileId) {
			map.delete(key(db, personId, fileId));
			meta.delete(key(db, personId, fileId));
		},
		async list() {
			return Array.from(map.values());
		},
		// Keys come from the map's own keys, never the rows, so a payload-reading caller shows.
		async listKeys() {
			return Array.from(map.keys()).map((k) => {
				const [db, personId, fileId] = triple(k);
				return { db, personId, fileId };
			});
		},
		async listMeta() {
			// From the metadata map, never `map`: payload reads would hide a heavy caller (#352).
			return Array.from(meta.entries()).map(([k, m]) => {
				const [db, personId, fileId] = triple(k);
				return { db, personId, fileId, size: m.size, openedAt: m.openedAt };
			});
		},
		rows() {
			return Array.from(map.values());
		}
	};
}

export interface FakeByteStore extends ByteStore {
	puts: Array<{
		identity: CollectiveIdentity;
		fileId: string;
		data: { bytes: ArrayBuffer; filetype: string; sha256: string };
	}>;
	seed(identity: CollectiveIdentity, fileId: string, data: { bytes: ArrayBuffer; filetype: string; sha256: string }): void;
	heldFor(db: string, personId: string): string[];
	/** #410: every setProtectedKeys() set, in order. */
	protectedLog: Array<ReadonlySet<string>>;
	/** #410: records only; the fake runs no eviction. */
	setProtectedKeys(keys: ReadonlySet<string>): void;
	/** #410: lets page specs spy call order (setProtectedKeys, relieve, prefetch). */
	relieve(): Promise<
		| { outcome: 'unsupported' }
		| { outcome: 'swept'; before: number; after: number; removed: ByteStoreKey[] }
	>;
}

// Mirrors the ByteStore contract, keyed by (db, personId, fileId). No cap logic.
export function createFakeByteStore(): FakeByteStore {
	const map = new Map<string, StoredFileRecord>();
	const puts: FakeByteStore['puts'] = [];
	const protectedLog: FakeByteStore['protectedLog'] = [];

	function toRecord(data: { bytes: ArrayBuffer; filetype: string; sha256: string }): StoredFileRecord {
		return { ...data, size: data.bytes.byteLength, openedAt: Date.now() };
	}

	return {
		puts,
		protectedLog,
		setProtectedKeys(keys) {
			protectedLog.push(keys);
		},
		async relieve() {
			// No estimate() seam, so 'unsupported'; callers must not gate on its outcome.
			return { outcome: 'unsupported' as const };
		},
		seed(identity, fileId, data) {
			map.set(key(identity.db, identity.personId, fileId), toRecord(data));
		},
		heldFor(db, personId) {
			return Array.from(map.keys())
				.map(triple)
				.filter(([d, p]) => d === db && p === personId)
				.map(([, , fileId]) => fileId);
		},
		async get(id, fileId) {
			return map.get(key(id.db, id.personId, fileId));
		},
		async put(id, fileId, data) {
			puts.push({ identity: id, fileId, data });
			map.set(key(id.db, id.personId, fileId), toRecord(data));
		},
		async evict(identity, fileId) {
			map.delete(key(identity.db, identity.personId, fileId));
		},
		async clearPartition(db, personId) {
			for (const k of Array.from(map.keys())) {
				const [d, p] = triple(k);
				if (d === db && p === personId) map.delete(k);
			}
		},
		async usage() {
			let total = 0;
			for (const r of map.values()) total += r.size;
			return total;
		},
		async heldFileIds(db, personId) {
			// Delegates to heldFor: one implementation, not a divergent double (#351).
			return this.heldFor(db, personId);
		},

		async usageForPartition(db, personId) {
			const mine = Array.from(map.entries())
				.map(([k, record]) => ({ triple: triple(k), record }))
				.filter(({ triple: [d, p] }) => d === db && p === personId);
			return { count: mine.length, size: mine.reduce((sum, { record }) => sum + record.size, 0) };
		},

		async usageForOthers(db, personId) {
			const others = Array.from(map.entries())
				.map(([k, record]) => ({ triple: triple(k), record }))
				.filter(({ triple: [d, p] }) => !(d === db && p === personId));
			return { count: others.length, size: others.reduce((sum, { record }) => sum + record.size, 0) };
		},

		async clearAllPartitions() {
			map.clear();
		}
	};
}

// (*MVOX:Tallis*)
