// Download all for the next event's parts (#945): one prefetch run, then presence is read again.
import { get } from 'svelte/store';
import { cfgFor } from '$lib/entu/cfg';
import { sameCollectiveIdentity, selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { getAppByteStore } from '$lib/files/appByteStore';
import { prefetchNextEventParts, type PrefetchPartResult } from '$lib/files/prefetch';
import type { PresenceRefresh } from '$lib/files/presenceRefresh';
import { online } from '$lib/net/online';
import { reportProblem } from '$lib/problems/reportProblem';

export type NextEventPartsFailure = 'storage-full' | 'too-large' | 'no-connection' | 'not-downloaded';

export interface NextEventPartsView {
	eventId: string;
	fileIds: string[];
	heldFileIds: ReadonlySet<string> | null;
	download: (fileIds: string[]) => ReturnType<typeof downloadNextEventParts>;
}

const ON_DEVICE: ReadonlySet<PrefetchPartResult['outcome']> = new Set([
	'held',
	'cache',
	'network-stored'
]);

function isQuotaError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'QuotaExceededError';
}

export function failureOf(results: PrefetchPartResult[], offline: boolean): NextEventPartsFailure | null {
	const first = results.find((r) => !ON_DEVICE.has(r.outcome));
	if (!first) return null;
	const kind = first.cause?.kind;
	if (kind === 'save-failed' && isQuotaError(first.cause?.error)) return 'storage-full';
	if (kind === 'over-cap') return 'too-large';
	if (kind === 'fetch-threw' || kind === 'read-threw') return 'no-connection';
	if (first.outcome === 'failed' && offline) return 'no-connection';
	return 'not-downloaded';
}

/** Resolves null when a collective switch dropped the run. */
export async function downloadNextEventParts(
	fileIds: string[],
	refreshPresence: PresenceRefresh
): Promise<{ failure: NextEventPartsFailure | null } | null> {
	const identity = get(selectedCollectiveIdentityStore);
	if (identity === null) return null;
	const isCurrent = () => sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity);
	const store = getAppByteStore();
	const results = await prefetchNextEventParts(
		cfgFor(identity.db), identity, fileIds, store, fetch, isCurrent
	).catch((error: unknown) => {
		if (isCurrent()) reportProblem({ area: 'files', action: 'downloading the next rehearsal parts', error });
		return null;
	});
	if (!isCurrent()) return null;
	refreshPresence(identity.db, identity.personId, isCurrent);
	return { failure: results === null ? 'not-downloaded' : failureOf(results, !get(online)) };
}

// (*MVOX:Josquin*)
