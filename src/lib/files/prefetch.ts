// #409 — the opportunistic-while-open prefetch for the next event's parts.
// Epic #334's standing constraint: every byte fetch runs on HER OWN key,
// while the app is open — never in the background while away.
//
// Contract (pinned in prefetch.spec.ts and page.works-wiring.spec.ts):
//   - ONE keys-only store.heldFileIds(db, personId) read decides the skips —
//     a prefetch never counts as an open (no get(), no touch, no recency).
//   - Missing parts run through openFileBytes SEQUENTIALLY (no parallel S3
//     storms); every minted blob URL is release()d — nothing consumes it.
//   - `isCurrent` is consulted at each settle; false stops the walk — no
//     further part is signed.
//   - NEVER throws: a failed part is a result ({ fileId, outcome: 'failed' }),
//     a null identity resolves [].
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { ByteStore } from './byteStore';
import { openFileBytes, type FileBytesDeliveryReason } from './openFileBytes';

/** Per-part answer: openFileBytes' own delivery reason for a fetched part,
 *  'held' for a part already on the device, 'failed' for a signing failure. */
export type PrefetchPartOutcome = FileBytesDeliveryReason | 'held' | 'failed';

export interface PrefetchPartResult {
	fileId: string;
	outcome: PrefetchPartOutcome;
}

export async function prefetchNextEventParts(
	cfg: EntuCfg,
	identity: CollectiveIdentity | null,
	fileIds: string[],
	store: ByteStore,
	fetchImpl: typeof fetch,
	isCurrent: () => boolean
): Promise<PrefetchPartResult[]> {
	if (identity === null || fileIds.length === 0) return [];

	// ONE keys-only read decides every skip — never a per-row get() (a get
	// counts as an open and would move recency; see byteStore.presence.spec.ts).
	const held = new Set(await store.heldFileIds(identity.db, identity.personId));
	const results: PrefetchPartResult[] = [];

	for (const fileId of fileIds) {
		if (!isCurrent()) break;

		if (held.has(fileId)) {
			results.push({ fileId, outcome: 'held' });
			continue;
		}

		try {
			const opened = await openFileBytes(cfg, identity, fileId, store, fetchImpl);
			// Nothing consumes a prefetched URL — there is no tab to hand it to.
			opened.release();
			results.push({ fileId, outcome: opened.reason });
		} catch {
			// A signing failure is a result, not a raise — the walk continues.
			results.push({ fileId, outcome: 'failed' });
		}
	}

	return results;
}

// (*MVOX:Tallis*)
