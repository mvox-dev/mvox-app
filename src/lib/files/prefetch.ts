// The next event's parts, fetched while the app is open, never in the background (#409).
// One keys-only heldFileIds read decides the skips; missing parts open one at a time, each URL
// released; `isCurrent` false stops the walk. Never throws: a failed part is a result.
import type { EntuCfg } from '$lib/entu/cfg';
import type { CollectiveIdentity } from '$lib/collectives/store';
import type { ByteStore } from './byteStore';
import { reportProblem } from '$lib/problems/reportProblem';
import { openFileBytes, type FileBytesDeliveryReason, type NotStoredCause } from './openFileBytes';

export type PrefetchPartOutcome = FileBytesDeliveryReason | 'held' | 'failed';

export interface PrefetchPartResult {
	fileId: string;
	outcome: PrefetchPartOutcome;
	cause?: NotStoredCause;
	error?: unknown;
}

// A failed save is reported inside openFileBytes already.
const WHY: Record<Exclude<NotStoredCause['kind'], 'save-failed'>, string> = {
	'over-cap': 'too large to store',
	'no-digest': 'this address cannot check files',
	'fetch-threw': 'the download did not start',
	'read-threw': 'the download broke off'
};

// db + fileId + reason: one report per part and reason for the app session.
const reported = new Set<string>();

function reportOnce(db: string, fileId: string, why: string, error: unknown): void {
	const key = JSON.stringify([db, fileId, why]);
	if (reported.has(key)) return;
	reported.add(key);
	reportProblem({ area: 'files', action: 'preloading a part for the next rehearsal', error });
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
	const held = new Set(await store.heldFileIds(identity));
	const results: PrefetchPartResult[] = [];

	for (const fileId of fileIds) {
		if (!isCurrent()) break;

		if (held.has(fileId)) {
			results.push({ fileId, outcome: 'held' });
			continue;
		}

		try {
			const opened = await openFileBytes(cfg, { ...identity, fileId }, store, fetchImpl);
			opened.release();
			const cause = opened.cause;
			results.push({ fileId, outcome: opened.reason, ...(cause && { cause }) });
			if (cause && cause.kind !== 'save-failed' && isCurrent()) {
				const why = WHY[cause.kind];
				reportOnce(identity.db, fileId, why, cause.error ?? new Error(`part ${fileId}: ${why}`));
			}
		} catch (error) {
			results.push({ fileId, outcome: 'failed', error });
			if (isCurrent()) reportOnce(identity.db, fileId, 'not opened', error);
		}
	}

	return results;
}

// (*MVOX:Tallis*)
