import { entuFetch } from '$lib/entu/request';
import type { AgendaItem } from '$lib/agenda/types';
import type { EventRaw, RightsRefs, Season, SeasonRaw, SeriesRaw } from './types';

/** The `_owner`/`_editor` refs the caller can actually see, flattened. Private
 *  bucket: a caller with no grant reads neither prop, which flattens to []. */
function rightsRefs(raw: RightsRefs, prop: '_owner' | '_editor'): string[] {
	return (raw[prop] ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
}

export interface EntuCfg {
	/** Runtime db (the selected collective) — threaded as the URL path segment. */
	db: string;
	/** The user's Entu JWT (browser-direct, aud=IP-bound). */
	token: string;
}

const typeIdCache = new Map<string, string>();

/**
 * Resolve an Entu entity-type NAME (e.g. 'rsvp') to its type-definition entity id,
 * so callers can send `{ type: '_type', reference: <id> }` on create — Entu create
 * bodies require refs as `reference`, never `string` (#10 pinned wire-shape). Cached
 * per `db:typeName` — type definitions don't change at runtime.
 */
export async function resolveTypeId(
	cfg: EntuCfg,
	typeName: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const key = `${cfg.db}:${typeName}`;
	const cached = typeIdCache.get(key);
	if (cached) return cached;

	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=entity&name.string=${encodeURIComponent(typeName)}&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`resolveTypeId failed: ${res.status}`);

	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const id = body.entities?.[0]?._id;
	if (!id) throw new Error(`resolveTypeId: type definition not found: '${typeName}' in db '${cfg.db}'`);

	typeIdCache.set(key, id);
	return id;
}

/** Test-only: clear the type-id cache between cases. */
export function resetTypeIdCache(): void {
	typeIdCache.clear();
}

// (*MVOX:Tallis*)

/**
 * List the collective's seasons, scoped to the DATABASE entity.
 *
 * #161 (collective = database, Mihkel ruling 2026-08-16) — seasons are children
 * of the DATABASE entity. Scoped the same way `resolveAdmin`/`resolveMyLibraryId`
 * scope their reads: resolve the database entity (`resolveDatabaseEntityId`),
 * then filter by `_parent.reference`. No visible database entity -> `[]` (not
 * an error: same "nothing visible" shape `resolveDatabaseEntityId` documents).
 *
 * #161 review fix round 2 — the dead `personId` parameter is DELETED from the
 * call contract (not merely renamed/shadowed): `listSeasons(cfg, fetchImpl?)`,
 * `.length === 1`, pinned in entuSeasons.database.spec.ts.
 */
export async function listSeasons(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<Season[]> {
	const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
	const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
	if (!dbEntityId) return [];

	const res = await entuFetch(
		cfg.db,
		// `_owner,_editor` ride along (#91 F1): the repertoire management controls
		// need `_editor` on the season, and asking for it HERE replaces a separate
		// per-entity rights GET with zero extra round-trips.
		`entity?_type.string=season&_parent.reference=${encodeURIComponent(dbEntityId)}&props=name,start_date,end_date,conductor,_owner,_editor&limit=200`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listSeasons failed: ${res.status}`);

	const body = (await res.json()) as { entities?: SeasonRaw[] };
	return (body.entities ?? [])
		.map(
			(raw): Season => ({
				id: raw._id,
				name: raw.name?.[0]?.string ?? '',
				startDate: raw.start_date?.[0]?.date?.slice(0, 10) ?? '',
				endDate: raw.end_date?.[0]?.date?.slice(0, 10) ?? '',
				conductors: (raw.conductor ?? []).flatMap((r) => (r.reference ? [r.reference] : [])),
				owners: rightsRefs(raw, '_owner'),
				editors: rightsRefs(raw, '_editor')
			})
		)
		.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * List a season's events as AgendaItems, applying the read-time
 * series-inheritance merge. Season-scoped (events under the season).
 *
 * Series identification is DE-FANNED: single-collective drops the org arg, so we
 * find the event's `event_series` parent via the denormalized `_parent[].entity_type`
 * (the old code found it as "the ref that is neither org nor season"). The MERGE
 * itself is kept VERBATIM from the harvest: fetch each parent series once (cache →
 * no N+1), fill `duration_minutes`/`location` that are absent on the event; never a
 * formula (rights-leak); the explicit event value always wins.
 *
 * #194/#202 — renamed from `listRehearsals`: the query no longer filters on
 * `event_type` (that hardcoded `event_type.string=rehearsal` hid every event
 * whose free-text type wasn't the literal word 'rehearsal' — e.g. the Crede
 * pilot's 'proov' rehearsals). Every event under the season comes back now,
 * each carrying its OWN `eventType` verbatim ('' when absent) — never
 * inherited from the series, unlike duration/location/name: the agenda labels
 * what the event itself claims to be.
 */
export async function listEvents(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<AgendaItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${seasonId}&props=name,start_datetime,duration_minutes,location,event_type,_parent,conductor,_owner,_editor&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEvents failed: ${res.status}`);

	const body = (await res.json()) as { entities?: EventRaw[] };
	const raws = body.entities ?? [];
	if (raws.length === 0) return [];

	const seriesIdFor = (raw: EventRaw): string =>
		(raw._parent ?? []).find((p) => p.entity_type === 'event_series')?.reference ?? '';

	// Fetch each unique parent series ONCE (cache — avoids N+1).
	const seriesCache = new Map<string, SeriesRaw>();
	const uniqueSeriesIds = [...new Set(raws.map(seriesIdFor).filter(Boolean))];
	await Promise.all(
		uniqueSeriesIds.map(async (sid) => {
			const sRes = await entuFetch(
				cfg.db,
				`entity/${sid}?props=name,default_location,duration_minutes`,
				cfg.token,
				{},
				fetchImpl
			);
			if (!sRes.ok) return;
			const sBody = (await sRes.json()) as { entity?: SeriesRaw };
			if (sBody.entity) seriesCache.set(sid, sBody.entity);
		})
	);

	return raws
		.map((raw): AgendaItem => {
			const series = seriesCache.get(seriesIdFor(raw));
			return {
				id: raw._id,
				// #101 review fix (F2) — name inherits from the series exactly like
				// duration/location do (and exactly like `loadEventDetail` does for
				// the detail page). Before this, an event carrying its name only on
				// its series rendered a BLANK agenda row whose detail link had no
				// accessible name, then opened a page showing a populated name.
				name: raw.name?.[0]?.string ?? series?.name?.[0]?.string ?? '',
				startDatetime: raw.start_datetime?.[0]?.datetime ?? '',
				// event value wins; series fills the gap; else 0/''.
				durationMinutes:
					raw.duration_minutes?.[0]?.number ?? series?.duration_minutes?.[0]?.number ?? 0,
				location: raw.location?.[0]?.string ?? series?.default_location?.[0]?.string ?? '',
				// #194/#202 — the event's OWN value only, never the series': the
				// series-inheritance merge above is deliberately not extended here.
				eventType: raw.event_type?.[0]?.string ?? '',
				conductors: (raw.conductor ?? []).flatMap((r) => (r.reference ? [r.reference] : [])),
				// Rights are NEVER merged from the series the way duration/location
				// are: Entu keeps rights per entity, so a series editor is not
				// thereby an editor of this event.
				owners: rightsRefs(raw, '_owner'),
				editors: rightsRefs(raw, '_editor')
			};
		})
		.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
}

// (*MVOX:Josquin*)
