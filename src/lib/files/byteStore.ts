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
// NO ARITHMETIC READS BYTES (#352 review). Every number this module answers —
// the global usage sum, the cap/eviction pass, the profile page's
// partition-vs-others split — comes from `adapter.listMeta()`: keys, sizes and
// recency stamps, no payload deserialised. `adapter.list()` (full rows, bytes
// and all) is called from NOWHERE in here. A store at the cap holds 200MB, and
// on a phone that is not a heap allocation any render, or any download, may
// make just to add up a column of byte lengths.
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
	/**
	 * FULL ROWS, BYTES AND ALL — the one method here that deserialises
	 * payloads. NOTHING in the policy core calls it any more (#352 review):
	 * every question the core asks is about keys, sizes or recency stamps,
	 * and `listKeys` / `listMeta` answer those without touching a payload. It
	 * stays on the seam as the adapter's complete read, driven by the adapter
	 * spec; a caller that genuinely wants every byte on the device has a name
	 * for what it is asking for.
	 */
	list(): Promise<ByteStoreRow[]>;
	/**
	 * KEYS ONLY — every (db, personId, fileId) currently held, reading NOT ONE
	 * byte payload (#351 review). `list()` deserialises every stored
	 * ArrayBuffer it returns, so against a full store it pulls the whole cap
	 * (BYTE_STORE_CAP_BYTES — 200MB) into the JS heap; on a phone, that is not
	 * a price a page load may pay to learn a set of ids. Anything whose answer
	 * IS a set of keys — presence, partition clearing — takes this.
	 */
	listKeys(): Promise<ByteStoreKey[]>;
	/**
	 * KEYS PLUS SIZE AND RECENCY, STILL NO PAYLOAD (#352 review). `listKeys`
	 * answers "which rows"; this answers "which rows, how big, last opened
	 * when" — and that is the entire input to every arithmetic question the
	 * core asks: the global `usage()` sum, the cap/eviction pass, and the
	 * profile page's partition-vs-others split.
	 *
	 * Before this existed those all went through `list()`, dragging up to the
	 * whole 200MB cap into the JS heap to read numbers that are themselves
	 * measured in bytes — and the profile page did it TWICE CONCURRENTLY, on
	 * every load and again after every remove, which is ~400MB of peak heap on
	 * a phone to sum two complementary columns. An adapter must answer this
	 * from metadata it keeps APART from the bytes (idbAdapter parks `size`
	 * alongside the recency stamp, in the store already written and deleted in
	 * lockstep with the payload).
	 */
	listMeta(): Promise<ByteStoreMeta[]>;
}

/** The key triple alone — what `listKeys` answers. */
export interface ByteStoreKey {
	db: string;
	personId: string;
	fileId: string;
}

/** The key triple plus the two numbers — what `listMeta` answers. NO bytes. */
export interface ByteStoreMeta extends ByteStoreKey {
	/** Byte length of the row's payload — what the usage sums add up. */
	size: number;
	/** Last-opened timestamp (ms) — what eviction orders by. */
	openedAt: number;
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
	/**
	 * #351 — the PRESENCE query: which fileIds does this (db, personId)
	 * partition hold RIGHT NOW, so a list can badge every row with ONE call
	 * instead of one `get()` per row.
	 *
	 * THIS IS NOT AN OPEN: unlike `get()`, it never counts as an open — no
	 * `adapter.touch`, no recency movement, and NO BYTES READ AT ALL (it goes
	 * through `adapter.listKeys`, never `adapter.list` — #351 review finding
	 * 2: this runs on every library and event-detail load, and `list()` would
	 * deserialise the entire cached-PDF store to answer it). `get()` is what
	 * bounds the LRU cap; a per-row presence check built on it would stamp
	 * every listed file as freshly opened on every render and collapse
	 * eviction order to render order. There is no live invalidation either —
	 * the store has no events — so a row the cap evicts simply stops
	 * appearing on the NEXT call to this method.
	 */
	heldFileIds(db: string, personId: string): Promise<string[]>;
	/**
	 * #352 — the profile storage section's scoped answer: {count, size} for
	 * EXACTLY the asked (db, personId) partition.
	 *
	 * READS NO BYTES, same law as `heldFileIds` (#352 review): it needs
	 * `size`, which `listKeys()` does not carry, so it goes through
	 * `adapter.listMeta()` — keys + size + stamp, no payload deserialised.
	 * NOT `adapter.list()`: the profile page fires this and `usageForOthers`
	 * CONCURRENTLY on every load and again after every remove, so a
	 * payload-reading implementation would put two full 200MB cap reads in
	 * flight at once on a phone, to sum two complementary columns of numbers.
	 *
	 * It is also NOT AN OPEN: no `adapter.touch`, no recency movement — a
	 * profile visit must not stamp rows as freshly opened and corrupt LRU
	 * eviction order.
	 */
	usageForPartition(db: string, personId: string): Promise<{ count: number; size: number }>;
	/**
	 * #352 — the complement of `usageForPartition`: every OTHER (db, personId)
	 * partition's rows, aggregated. "Other" includes the SAME human's
	 * partition under a different `db` (partitions are the pair, not the
	 * person) — the profile section's "everything else on this device"
	 * bucket is a statement about the DEVICE, not the human. Same
	 * `adapter.listMeta()` read, same no-bytes/no-open law.
	 */
	usageForOthers(db: string, personId: string): Promise<{ count: number; size: number }>;
	/**
	 * #352 — the device-wide wipe behind "Remove everything downloaded on
	 * this device": empties EVERY partition, including ones belonging to
	 * identities not signed in right now. Like `clearPartition`, this works
	 * from KEYS alone — deleting bytes never needs to read them.
	 */
	clearAllPartitions(): Promise<void>;
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
	opts?: {
		capBytes?: number;
		/**
		 * #353 — fired for EVERY key this store stops holding, however that
		 * happens: an explicit `evict`, a `clearPartition`/`clearAllPartitions`
		 * sweep, or a silent LRU eviction inside a `put`'s cap pass. This store
		 * stays policy-only about WHAT it holds (bytes, never names) — the
		 * label index (labelStore.ts) is a sibling store keyed the same way,
		 * and its eager-removal lifecycle rides this hook rather than this
		 * module learning anything about labels. Never awaited here: a label
		 * write failing must not slow or gate a byte-store operation.
		 */
		onRowRemoved?: (key: ByteStoreKey) => void;
	}
): ByteStore {
	const capBytes = opts?.capBytes ?? BYTE_STORE_CAP_BYTES;
	const onRowRemoved = opts?.onRowRemoved;

	// The cap pass needs sizes and recency stamps for every held row and
	// NOTHING else — so it reads `listMeta`, not `list` (#352 review). A put is
	// already carrying one score's bytes in memory; deserialising every OTHER
	// cached score on top of it, purely to add up their `size` fields, is how a
	// download OOMs a phone that is merely near the cap.
	async function evictUntilFits(neededBytes: number, exceptKey: ByteStoreKey) {
		const isExcepted = (meta: ByteStoreMeta) =>
			meta.db === exceptKey.db && meta.personId === exceptKey.personId && meta.fileId === exceptKey.fileId;

		let metas = await adapter.listMeta();
		let usage = metas.reduce((sum, meta) => sum + meta.size, 0);
		// The row being overwritten (if any) is about to be replaced — its
		// current size must not count against the incoming write.
		const existing = metas.find(isExcepted);
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

	/** Sum {count, size} over the metadata rows a predicate keeps. */
	function tally(metas: ByteStoreMeta[], keep: (meta: ByteStoreMeta) => boolean) {
		const kept = metas.filter(keep);
		return { count: kept.length, size: kept.reduce((sum, meta) => sum + meta.size, 0) };
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
			onRowRemoved?.({ db: identity.db, personId: identity.personId, fileId });
		},

		async clearPartition(db, personId) {
			// Keys, not rows: deleting a partition never needs to read the bytes
			// it is deleting (#351 review).
			const keys = await adapter.listKeys();
			for (const key of keys) {
				if (key.db === db && key.personId === personId) {
					await adapter.delete(key.db, key.personId, key.fileId);
					onRowRemoved?.(key);
				}
			}
		},

		async usage() {
			// Metadata, not rows: the answer is a sum of `size` fields, and
			// reading the bytes to add up their lengths is the #352 review's
			// finding in its plainest form.
			const metas = await adapter.listMeta();
			return metas.reduce((sum, meta) => sum + meta.size, 0);
		},

		async heldFileIds(db, personId) {
			// KEYS ONLY. This runs on every library/event-detail load, and the
			// answer is a list of id strings — going through `adapter.list()`
			// would deserialise every cached PDF in the store to produce it
			// (#351 review finding 2). See the `listKeys` doc above.
			const keys = await adapter.listKeys();
			return keys.filter((key) => key.db === db && key.personId === personId).map((key) => key.fileId);
		},

		async usageForPartition(db, personId) {
			// METADATA, never rows — see the interface doc: the profile page
			// fires this alongside usageForOthers on every load.
			return tally(await adapter.listMeta(), (meta) => meta.db === db && meta.personId === personId);
		},

		async usageForOthers(db, personId) {
			return tally(await adapter.listMeta(), (meta) => !(meta.db === db && meta.personId === personId));
		},

		async clearAllPartitions() {
			// Keys, not rows — same reasoning as clearPartition above.
			const keys = await adapter.listKeys();
			for (const key of keys) {
				await adapter.delete(key.db, key.personId, key.fileId);
				onRowRemoved?.(key);
			}
		}
	};
}

// (*MVOX:Josquin*)
