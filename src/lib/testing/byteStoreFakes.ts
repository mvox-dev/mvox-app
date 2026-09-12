// #343 test infrastructure — in-memory doubles for the byte-store PLATFORM
// seams, NOT for the subject under test (the Gama rule on #343: a double for
// the platform is the opposite of a double for the subject).
//
//   - createFakeAdapter(): an in-memory ByteStoreAdapter for driving the REAL
//     createByteStore policy core in byteStore.spec.ts.
//   - createFakeByteStore(): a full in-memory ByteStore for PAGE wiring specs
//     (substituted at the $lib/files/appByteStore seam), which records every
//     put() argument verbatim so specs can scan what would have been
//     persisted (the "signed URL appears nowhere" pin).

import type {
	ByteStore,
	ByteStoreAdapter,
	ByteStoreRow,
	StoredFileRecord
} from '$lib/files/byteStore';
import type { CollectiveIdentity } from '$lib/collectives/store';

// Keyed the way the REAL adapter keys (idbAdapter.ts): a JSON-encoded
// fixed-arity triple, not a delimited string. Any separator character risks
// collision with a db name, person id or Entu file-property id — and a double
// that keys differently from the thing it stands in for is a double that can
// disagree with it. Parse it back (`triple`) instead of prefix-matching.
function key(db: string, personId: string, fileId: string): string {
	return JSON.stringify([db, personId, fileId]);
}

function triple(k: string): [db: string, personId: string, fileId: string] {
	return JSON.parse(k) as [string, string, string];
}

export interface FakeAdapter extends ByteStoreAdapter {
	/** Raw view of everything currently persisted. */
	rows(): ByteStoreRow[];
	/** Every record EVER handed to put(), in order — survives deletes. */
	putLog: Array<{ db: string; personId: string; fileId: string; record: StoredFileRecord }>;
	/**
	 * Every touch() call, in order. Separate from `putLog` on purpose: it is
	 * what lets a spec pin that a cached open moves recency WITHOUT rewriting
	 * the byte payload.
	 */
	touchLog: Array<{ db: string; personId: string; fileId: string; openedAt: number }>;
}

export function createFakeAdapter(): FakeAdapter {
	const map = new Map<string, ByteStoreRow>();
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
		},
		async touch(db, personId, fileId, openedAt) {
			const k = key(db, personId, fileId);
			const held = map.get(k);
			// Recency without a payload is not a row (the adapter contract).
			if (!held) return;
			touchLog.push({ db, personId, fileId, openedAt });
			map.set(k, { ...held, record: { ...held.record, openedAt } });
		},
		async delete(db, personId, fileId) {
			map.delete(key(db, personId, fileId));
		},
		async list() {
			return Array.from(map.values());
		},
		rows() {
			return Array.from(map.values());
		}
	};
}

export interface FakeByteStore extends ByteStore {
	/** Every put() call as received — identity, fileId and the raw data. */
	puts: Array<{
		identity: CollectiveIdentity;
		fileId: string;
		data: { bytes: ArrayBuffer; filetype: string; sha256: string };
	}>;
	/** Seed a record directly (test arrange step, no policy involved). */
	seed(identity: CollectiveIdentity, fileId: string, data: { bytes: ArrayBuffer; filetype: string; sha256: string }): void;
	/** All fileIds currently held for a partition. */
	heldFor(db: string, personId: string): string[];
}

/**
 * Mirrors the pinned ByteStore contract: identity-null accessors THROW, keys
 * are (db, personId, fileId). No cap logic — page specs don't exercise it.
 */
export function createFakeByteStore(): FakeByteStore {
	const map = new Map<string, StoredFileRecord>();
	const puts: FakeByteStore['puts'] = [];

	function requireIdentity(identity: CollectiveIdentity | null): CollectiveIdentity {
		if (identity === null) throw new Error('byte store: no identity — anonymous access has no partition key');
		return identity;
	}

	function toRecord(data: { bytes: ArrayBuffer; filetype: string; sha256: string }): StoredFileRecord {
		return { ...data, size: data.bytes.byteLength, openedAt: Date.now() };
	}

	return {
		puts,
		seed(identity, fileId, data) {
			map.set(key(identity.db, identity.personId, fileId), toRecord(data));
		},
		heldFor(db, personId) {
			return Array.from(map.keys())
				.map(triple)
				.filter(([d, p]) => d === db && p === personId)
				.map(([, , fileId]) => fileId);
		},
		async get(identity, fileId) {
			const id = requireIdentity(identity);
			return map.get(key(id.db, id.personId, fileId));
		},
		async put(identity, fileId, data) {
			const id = requireIdentity(identity);
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
		}
	};
}

// (*MVOX:Tallis*)
