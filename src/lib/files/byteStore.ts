// #343 — the offline edition-file byte store (policy core).
//
// KEY = (db, personId, fileId). One human holds a different person-id per
// collective, and cached bytes are bytes that person was entitled to read
// (Mihkel's standing law: every read goes through the person's own user). The
// partition stops the app serving one identity's bytes to another.
//
// THAT IS A CORRECTNESS BOUNDARY, NOT A SECURITY BOUNDARY (Gama's ruling,
// #343): browser storage is origin-scoped, not identity-scoped — anything
// running on this origin can read all of it, and devtools shows it plainly.
// Nothing here, or anywhere this store is surfaced, may imply the bytes are
// protected from another person holding the device. A NULL identity throws —
// fail loudly, never silently construct a key for "anonymous" — and there is
// no accessor that can read or write without one.
//
// RETENTION: logout and token expiry do NOT clear this store (see
// storage.spec.ts's #343 RETAIN suite) — re-login as the same (db, personId)
// finds its bytes again without redownloading. `clearPartition` is the bare
// mechanism for the member-facing "remove downloaded parts from this device"
// control (#334) — it is deliberately NOT wired to any auth teardown path.
//
// THE CAP IS A GLOBAL CAP, ACROSS ALL PARTITIONS, and eviction is
// least-recently-opened, also across all partitions: device storage is a
// device-level resource, so a per-partition cap would multiply by every
// identity that ever signed in, while global recency lets a dormant
// identity's bytes age out on their own. A get() counts as an open, same as a
// put(); an over-cap put evicts the globally-oldest-opened rows, regardless
// of whose partition they sit in, until the newcomer fits. A single record
// bigger than the cap is rejected outright — nothing already held is
// destroyed to make room for it.
//
// RECENCY IS ITS OWN WRITE (`adapter.touch`), never a rewrite of the record
// (#343 review). The whole point of this store is the repeated cached open,
// and a put() to bump one timestamp re-persists the entire ArrayBuffer along
// with it — a multi-megabyte disk write per open of an already-held score,
// landing squarely on the hot path. `touch` carries the stamp alone; how the
// persistence layer keeps it apart from the bytes is the adapter's business
// (idbAdapter keeps a separate recency row under the same key).
//
// STALENESS IS STRUCTURAL, not a validator field: Entu mints a NEW
// file-property `_id` when a file is replaced (probe ledger
// scripts/migrations/seed-results/probe-343-file-replace-identity-live-
// 2026-09-12T07-56-06-582Z.json), so a replaced file simply arrives under a
// different fileId — a fresh fetch under the new key, the old row untouched.
// There is deliberately no ETag check: the signed-URL bucket response does
// not expose it to a CORS fetch (Access-Control-Expose-Headers is absent —
// probe ledger probe-343-signed-url-headers-live-2026-09-12T08-03-54-345Z.json),
// so a client-side ETag read would always be null. That is recorded here as a
// fact, not implemented as dead code.
//
// #333's hash-pin hook: every stored record carries an app-computed SHA-256
// (hex) of the fetched bytes. This module only computes and records that
// digest — comparison/pinning logic belongs to #333, not here.

import type { CollectiveIdentity } from '$lib/collectives/store';

/** What the store holds per (db, personId, fileId). NO URL of any kind. */
export interface StoredFileRecord {
	bytes: ArrayBuffer;
	/** MIME type the bytes were served with (CORS-safelisted, readable). */
	filetype: string;
	/** App-computed SHA-256 (hex) of `bytes` — stored metadata only. */
	sha256: string;
	/** Byte length of `bytes` — what `usage()` sums. */
	size: number;
	/** Last-opened timestamp (ms) — eviction recency. A put counts as an open. */
	openedAt: number;
}

/** A full row as the persistence layer sees it. */
export interface ByteStoreRow {
	db: string;
	personId: string;
	fileId: string;
	record: StoredFileRecord;
}

/** The thin persistence seam the IndexedDB adapter implements. */
export interface ByteStoreAdapter {
	get(db: string, personId: string, fileId: string): Promise<StoredFileRecord | undefined>;
	put(db: string, personId: string, fileId: string, record: StoredFileRecord): Promise<void>;
	/**
	 * Move a held row's recency stamp and NOTHING else — no byte payload may
	 * be rewritten (see RECENCY IS ITS OWN WRITE in the module head). A no-op
	 * for a key that holds nothing: recency without a payload is not a row.
	 */
	touch(db: string, personId: string, fileId: string, openedAt: number): Promise<void>;
	delete(db: string, personId: string, fileId: string): Promise<void>;
	list(): Promise<ByteStoreRow[]>;
}

/** The store interface the app consumes. */
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
}

export const BYTE_STORE_CAP_BYTES = 200 * 1024 * 1024;

function requireIdentity(identity: CollectiveIdentity | null): CollectiveIdentity {
	if (identity === null) {
		throw new Error('byteStore: no identity — anonymous access has no partition key');
	}
	return identity;
}

export function createByteStore(
	adapter: ByteStoreAdapter,
	opts?: { capBytes?: number }
): ByteStore {
	const capBytes = opts?.capBytes ?? BYTE_STORE_CAP_BYTES;

	async function evictUntilFits(neededBytes: number, exceptKey: { db: string; personId: string; fileId: string }) {
		let rows = await adapter.list();
		let usage = rows.reduce((sum, row) => sum + row.record.size, 0);
		// The row being overwritten (if any) is about to be replaced — its
		// current size must not count against the incoming write.
		const existing = rows.find(
			(row) => row.db === exceptKey.db && row.personId === exceptKey.personId && row.fileId === exceptKey.fileId
		);
		if (existing) usage -= existing.record.size;

		while (usage + neededBytes > capBytes) {
			const candidates = rows.filter(
				(row) =>
					!(row.db === exceptKey.db && row.personId === exceptKey.personId && row.fileId === exceptKey.fileId)
			);
			if (candidates.length === 0) break;
			const oldest = candidates.reduce((a, b) => (a.record.openedAt <= b.record.openedAt ? a : b));
			await adapter.delete(oldest.db, oldest.personId, oldest.fileId);
			usage -= oldest.record.size;
			rows = rows.filter((row) => row !== oldest);
		}
	}

	return {
		async get(identity, fileId) {
			const id = requireIdentity(identity);
			const record = await adapter.get(id.db, id.personId, fileId);
			if (!record) return undefined;
			// A get() IS an open — refresh recency so it survives the next
			// eviction. Through `touch`, not a put: the bytes are unchanged and
			// must not be rewritten to move a timestamp.
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
			await evictUntilFits(record.size, { db: id.db, personId: id.personId, fileId });
			await adapter.put(id.db, id.personId, fileId, record);
		},

		async evict(identity, fileId) {
			await adapter.delete(identity.db, identity.personId, fileId);
		},

		async clearPartition(db, personId) {
			const rows = await adapter.list();
			for (const row of rows) {
				if (row.db === db && row.personId === personId) {
					await adapter.delete(row.db, row.personId, row.fileId);
				}
			}
		},

		async usage() {
			const rows = await adapter.list();
			return rows.reduce((sum, row) => sum + row.record.size, 0);
		}
	};
}

// (*MVOX:Josquin*)
