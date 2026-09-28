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
//
// #434 slice 5 puts the SAME pair over this screen's other read, the works
// section (`loadWorksByEventId`, shared with the agenda and this page's own
// post-write refresh): `loadEventPageWorkRows` (store and serve, the mounted
// screen) and `refreshEventPageWorkRows` (store only — the agenda's next-event
// warm-up and the post-write re-read).
import { CACHED_READ, CACHED_READ_STORE_ONLY } from '$lib/entu/fetchOptions';
import { loadEventDetail, type EventDetail } from './eventDetail';
import { loadWorksByEventId } from '$lib/repertoire/workRows';
import type { RepertoireReadOptions } from '$lib/repertoire/repertoireData';
import type { WorkRow } from '$lib/repertoire/types';
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

/**
 * #434 slice 5 — the event page's OTHER cache-backed load: the works section
 * (`loadWorksByEventId`: works, editions, copies, program items — a join over
 * FOUR collections, workRows.ts). `loadComposeSurfaces`
 * (`src/routes/event/[id]/+page.svelte`) is its only caller, alongside
 * `loadEventPageDetail` above — both feed the SAME mounted screen, so both
 * store AND serve: offline, the works list (and therefore the part link a
 * held file's row carries) survives exactly like the header does.
 *
 * `loadWorksByEventId`/`resolveEventWorksBatch`/`listWorks`/`listAllEditions`/
 * `listAllCopies` are SHARED readers (the agenda's own works read, and this
 * page's post-write `refreshWorks`, call them too) — they thread `options`
 * down and hard-wire nothing themselves; this is the one call site, on the
 * allowlist (readCache.optin-fence.spec.ts), that actually names CACHED_READ.
 */
export async function loadEventPageWorkRows(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: Omit<RepertoireReadOptions, 'cache'> = {}
): Promise<Record<string, WorkRow[]>> {
	return loadWorksByEventId(cfg, eventIds, seasonId, fetchImpl, { ...options, ...CACHED_READ });
}

/**
 * The works read STORED but never SERVED — `refreshEventPageDetail`'s twin, one
 * layer down, and for the same two callers (#434 slice 5 review round, findings
 * 1 and 2):
 *   - the agenda's next-event WARM-UP (`prefetchNextEventPartsAfterSettle`,
 *     `src/routes/+page.svelte`). Slice 3 warmed only that event's HEADER;
 *     #409 downloads that event's part BYTES. Without this the works read had
 *     no warm-up at all, so offline the event page restored its header, its
 *     works read rejected, and `loadEventPageWorkRows`'s `.catch` left an
 *     EMPTY repertoire section — no part row, no part link, and the file on the
 *     device reachable only from /downloads. That is the slice's own Done-when
 *     failing in exactly the case #409 creates.
 *   - the event page's post-write re-read (`refreshWorks`). Plain
 *     `loadWorksByEventId` neither serves NOR stores, so every programme write
 *     left the stored copy behind the write that just landed: offline she then
 *     saw the pre-write repertoire under an "as of" from before it, and a piece
 *     added tonight carried no part link. Store-only IS the live answer — the
 *     serve half is what a post-write read must not have — plus the stored copy
 *     kept level with the write.
 *
 * Store-only, never `loadEventPageWorkRows`, for both: `servedFromCache` is ONE
 * store, read by whichever screen is mounted. On the agenda it is the AGENDA's
 * own as-of claim, so a serving warm-up would paint an older time over rows that
 * came back live; on the event page a serving post-write read could hand back a
 * stored pre-write row set as if it were the write's result.
 *
 * The keys line up with `loadEventPageWorkRows`'s exactly, which is what makes
 * the warm-up useful: the work/edition/copy reads carry no per-event params, and
 * `program_item` is `_parent.reference=<eventId>` — the same URL the event page
 * requests. `includeInactive` filters client-side (repertoireData.ts) and
 * changes no URL, so an editor's and a member's reads share keys. The ONE key
 * that can differ is the season-repertoire fallback: the agenda knows only its
 * CURRENT season id, and `agendaItems[0]` may belong to a later one — then the
 * fallback read is warmed under the agenda's own season, the same one the
 * agenda row itself was built from.
 */
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

// (*MVOX:Josquin* — #434 slice 3/6 GREEN)
// (*MVOX:Josquin* — #434 slice 3 review round, findings 1 and 2)
// (*MVOX:Josquin* — #434 slice 5/6 GREEN: the works read + the part link)
// (*MVOX:Josquin* — #434 slice 5 review round, findings 1-3)
