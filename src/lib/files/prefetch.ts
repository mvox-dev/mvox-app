// The next event's parts, fetched while the app is open, never in the background (#409).
// One keys-only heldFileIds read decides the skips; missing parts open one at a time, each URL
// released; `isCurrent` false stops the walk. Never throws: a failed part is a result.
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { ByteStore } from './byteStore';
import { openFileBytes, type FileBytesDeliveryReason } from './openFileBytes';

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

	// A get() counts as an open and would move recency.
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
			opened.release();
			results.push({ fileId, outcome: opened.reason });
		} catch {
			results.push({ fileId, outcome: 'failed' });
		}
	}

	return results;
}

// (*MVOX:Tallis*)
