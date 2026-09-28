// src/lib/events/eventPageData.ts
//
// #434 slice 3/6 — the event page's OWN entry points, the same role
// `agendaData.loadFullAgenda` plays for the agenda (slice 2): the ONE file
// allowed to switch the read-through cache on for this screen's reads, pinned
// in `readCache.optin-fence.spec.ts`'s allowlist.
//
// `loadEventDetail` (eventDetail.ts) is a SHARED reader — it hard-wires no
// flag, and this file is where the two cache decisions over it are taken:
//   - `loadEventPageDetail` — the mounted screen's load: store AND serve, so
//     every read it makes (the event, its parent season, its parent series,
//     each conductor's profile) gives back the SAME `EventDetail` shape online
//     or offline, and the served copy's age lands on `servedFromCache` for the
//     page's "as of <time>" line.
//   - `refreshEventPageDetail` — store only, never serve: for a read that is
//     NOT what the screen is currently rendering.
import { CACHED_READ, CACHED_READ_STORE_ONLY } from '$lib/entu/fetchOptions';
import { loadEventDetail, type EventDetail } from './eventDetail';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

/**
 * The event page's cache-backed load — `loadForSelected`
 * (`src/routes/event/[id]/+page.svelte`) is its only caller: the ONE read whose
 * result this screen renders, and so the ONE that may claim the screen is stale
 * (`servedFromCache` -> `data-testid="event-detail-as-of"`).
 */
export async function loadEventPageDetail(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventDetail> {
	return loadEventDetail(cfg, eventId, fetchImpl, CACHED_READ);
}

/**
 * The same reads, STORED but never SERVED (#434 slice 3 review round, findings
 * 1 and 2). Live answer or nothing: online every read stores its body exactly
 * as `loadEventPageDetail` would, so this event's stored header stays level
 * with what was last read live; offline the network rejection propagates, and
 * `servedFromCache` is left exactly as the mounted screen's own reads left it.
 *
 * Its two callers both need precisely that, and neither may use
 * `loadEventPageDetail` — `servedFromCache` is ONE store, read by whichever
 * screen is mounted:
 *   - the agenda's next-event prefetch (`+page.svelte`'s
 *     `prefetchNextEventPartsAfterSettle`, #409/#410) — a fire-and-forget
 *     warm-up of a page the member has not opened. Cache-backed, on a flapping
 *     connection its reads reject, serve stored copies, and stamp their age
 *     onto the AGENDA's own "as of" line (and open its offline /downloads door)
 *     over rows that all came back live. Store-only, offline it has nothing to
 *     do anyway: it would only re-read what is already stored.
 *   - the event page's post-series-write refresh (`refreshEventDetail`) — it
 *     must show the header the write produced, never a stored copy of the
 *     pre-write one; but an UNCACHED refresh never updates that stored copy
 *     either, so a member who reassigns a series and then goes offline is shown
 *     her own superseded merged name/duration/location/description until the
 *     next full load of that event.
 */
export async function refreshEventPageDetail(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventDetail> {
	return loadEventDetail(cfg, eventId, fetchImpl, CACHED_READ_STORE_ONLY);
}

// (*MVOX:Josquin* — #434 slice 3/6 GREEN)
// (*MVOX:Josquin* — #434 slice 3 review round, findings 1 and 2)
