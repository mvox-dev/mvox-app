// #353 — the label index: "a label written at download time".
//
// StoredFileRecord (byteStore.ts) is bytes/filetype/sha256/size/openedAt
// keyed by fileId — offline, with the Entu API unreachable, the byte store
// can truthfully say "fourteen files, 180 MB" and cannot say WHICH pieces
// they are. This module is the sibling that answers that: a small, separate
// index of (work, composer, edition, filename) per (db, personId, fileId),
// written at the moment the app already has that metadata in hand — the file
// PUT.
//
// A SIBLING STORE, NEVER A FIELD ON StoredFileRecord. byteStore.ts stays
// policy-only about what it holds — bytes, never names — so this module
// carries its own tiny persistence seam (labelIdbAdapter.ts, a DIFFERENT
// IndexedDB database, 'mvox-label-index'). Bolting a title onto
// StoredFileRecord would ride the byte store's own DB_VERSION bump path,
// whose `onupgradeneeded` is a full cache FLUSH (idbAdapter.ts) — shipping a
// label column that way would wipe every singer's downloaded parts on the
// very upgrade meant to add their names.
//
// LIFECYCLE: written at put-time (`recordPartLabel`, called from every page
// that reaches `openFileBytes`'s store), eagerly removed when the
// corresponding byte row goes away — see `onRowRemoved` on
// `createByteStore` (byteStore.ts) and its wiring in appByteStore.ts. An
// orphan label (row gone, name left behind) is structurally harmless — the
// downloads view reads `heldFileIds` first and only NAMES what is held — but
// unbounded, since the LRU cap evicts byte rows silently; eager removal is
// the backstop against that leak.
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { FileBytesDeliveryReason } from './openFileBytes';

/**
 * Minimal, on purpose: enough to name the part a singer is reaching for, not
 * a mirror of the edition record. `filename` is load-bearing — it is what
 * distinguishes SOPRAN from ALT (see workRows.ts's `fileName`).
 */
export interface PartLabel {
	work: string;
	composer: string;
	edition: string;
	filename: string;
}

/** The thin persistence seam the IndexedDB adapter implements. */
export interface LabelStoreAdapter {
	get(db: string, personId: string, fileId: string): Promise<PartLabel | undefined>;
	put(db: string, personId: string, fileId: string, label: PartLabel): Promise<void>;
	delete(db: string, personId: string, fileId: string): Promise<void>;
	listFor(db: string, personId: string): Promise<Array<{ fileId: string; label: PartLabel }>>;
}

export interface LabelStore {
	putLabel(identity: CollectiveIdentity | null, fileId: string, label: PartLabel): Promise<void>;
	/** Every label held for a (db, personId) partition, keyed by fileId. Reads
	 *  nothing but the label index itself — the network owes this call
	 *  nothing (see labelStore.spec.ts's fetch-throws pin). */
	labelsFor(db: string, personId: string): Promise<Map<string, PartLabel>>;
	/** The `onRowRemoved` sink's target — removes exactly one (db, personId,
	 *  fileId) label. A no-op for a key that never had one. */
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

/**
 * The label is written exactly when the device GAINED (or already held) an
 * offline copy: `openFileBytes`'s `'network-stored'` (just downloaded) and
 * `'cache'` (already held — the backfill that names bytes downloaded before
 * #353 shipped). `'network-uncached'` and `'fallback-navigation'` leave
 * NOTHING in the byte store, so a label for either would be an orphan minted
 * on purpose.
 *
 * FIRE-AND-FORGET, deliberately: a label write failing must not gate the
 * open it names (#343's "the cache is never a gate" law, applied to this
 * sibling store too) — the byte is already delivered by the time this runs.
 */
export function recordPartLabel(
	store: LabelStore,
	identity: CollectiveIdentity | null,
	fileId: string,
	label: PartLabel,
	reason: FileBytesDeliveryReason
): void {
	if (reason !== 'network-stored' && reason !== 'cache') return;
	store.putLabel(identity, fileId, label).catch(() => {
		// Swallowed on purpose — see the module doc above.
	});
}

// (*MVOX:Josquin* — #353 GREEN)
