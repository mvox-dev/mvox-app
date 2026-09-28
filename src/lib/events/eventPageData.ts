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
// screen) and `refreshEventPageWorkRows` (store only — the agenda's own works
// reads, and the post-write re-reads on both pages).
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
 * layer down. Callers:
 *   - the agenda's OWN works reads (`loadWorksAndManagement`,
 *     `upgradeRepertoireManagement`, `src/routes/+page.svelte` — #434 slice 5
 *     review round 3, F1). The agenda already reads the works fan-out for every
 *     event on it, tonight's included; storing THAT read is what lets the event
 *     page's works section, and the part link a held file's row carries, restore
 *     offline — without a second warm-up read of the same URLs beside it. The
 *     work/edition/copy lists carry no per-event params and `program_item` is
 *     `_parent.reference=<eventId>`, so the keys are the event page's own;
 *     `includeInactive` filters client-side and changes no URL. The one key that
 *     can differ is the season-repertoire fallback, read under the agenda's
 *     CURRENT season.
 *   - the post-write re-reads on both pages (the agenda's
 *     `refreshWorksAfterWrite`, the event page's `refreshWorks`). Plain
 *     `loadWorksByEventId` neither serves NOR stores, so every programme write
 *     would leave the stored copy behind the write that just landed. Store-only
 *     IS the live answer, plus the stored copy kept level with the write.
 *
 * Store-only, never `loadEventPageWorkRows`, for all of them: `servedFromCache`
 * is ONE store, read by whichever screen is mounted. On the agenda it is the
 * AGENDA's own as-of claim, and offline these reads reject exactly as the
 * uncached ones did; on the event page a serving post-write read could hand back
 * a stored pre-write row set as if it were the write's result.
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
