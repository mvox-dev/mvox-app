// The event page's reads: the one place this screen opts into the read cache (readCache fence).
import { CACHED_READ, CACHED_READ_STORE_ONLY } from '$lib/entu/fetchOptions';
import { loadEventDetail, type EventDetail } from './eventDetail';
import { loadWorksByEventId } from '$lib/repertoire/workRows';
import type { RepertoireReadOptions } from '$lib/repertoire/repertoireData';
import type { WorkRow } from '$lib/repertoire/types';
import type { EntuCfg } from '$lib/entu/cfg';

export async function loadEventPageDetail(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventDetail> {
	return loadEventDetail(cfg, eventId, fetchImpl, CACHED_READ);
}

// Store, never serve: servedFromCache is one store shared by whichever screen is mounted,
// so the agenda prefetch and post-write refreshes must not claim it.
export async function refreshEventPageDetail(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventDetail> {
	return loadEventDetail(cfg, eventId, fetchImpl, CACHED_READ_STORE_ONLY);
}

export async function loadEventPageWorkRows(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: Omit<RepertoireReadOptions, 'cache'> = {}
): Promise<Record<string, WorkRow[]>> {
	return loadWorksByEventId(cfg, eventIds, seasonId, fetchImpl, { ...options, ...CACHED_READ });
}

// Store-only twin of loadEventPageWorkRows, for the agenda's works reads and post-write
// re-reads: keeps the stored copy level with live reads without claiming servedFromCache.
export async function refreshEventPageWorkRows(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: Omit<RepertoireReadOptions, 'cache'> = {}
): Promise<Record<string, WorkRow[]>> {
	return loadWorksByEventId(cfg, eventIds, seasonId, fetchImpl, {
		...options,
		...CACHED_READ_STORE_ONLY
	});
}

// (*MVOX:Josquin*)
