// src/lib/events/eventPageData.ts
//
// #434 slice 3/6 — the event page's OWN entry point, the same role
// `agendaData.loadFullAgenda` plays for the agenda (slice 2): the ONE call
// site allowed to switch the read-through cache on for this screen's reads,
// pinned in `readCache.optin-fence.spec.ts`'s allowlist.
//
// `loadEventDetail` (eventDetail.ts) is a SHARED reader — the page's own
// post-write refresh calls it too, uncached, so a header just written never
// paints a stale stored copy as the result of that write. This function is
// the offline-screen half of that same reader: `CACHED_READ` on, so every
// read `loadEventDetail` makes (the event, its parent season, its parent
// series, each conductor's profile) is stored online and served offline,
// giving back the SAME `EventDetail` shape either way.
import { CACHED_READ } from '$lib/entu/fetchOptions';
import { loadEventDetail, type EventDetail } from './eventDetail';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

/**
 * The event page's cache-backed load — `loadForSelected`
 * (`src/routes/event/[id]/+page.svelte`) and the agenda's next-event
 * prefetch (`+page.svelte`'s `prefetchNextEventPartsAfterSettle`, #409/#410)
 * are its only callers.
 */
export async function loadEventPageDetail(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventDetail> {
	return loadEventDetail(cfg, eventId, fetchImpl, CACHED_READ);
}

// (*MVOX:Josquin* — #434 slice 3/6 GREEN)
