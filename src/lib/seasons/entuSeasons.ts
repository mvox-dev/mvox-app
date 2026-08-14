import { entuFetch } from '$lib/entu/request';
import type { AgendaItem } from '$lib/agenda/types';
import type { RehearsalRaw, RightsRefs, Season, SeasonRaw, SeriesRaw } from './types';

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
 * List the collective's seasons, scoped to the PERSON'S OWN org.
 *
 * #144 review — re-fans the de-fan: single-collective made "the selected db IS
 * the collective" true for polyphony today, but it stops being true the moment
 * a db holds more than one organization's seasons, and nothing here enforced
 * that assumption — it just read every `season` row in the db. Scoped the same
 * way `resolveAdmin`/`resolveMyLibraryId` scope their reads: resolve the org
 * from the person's own active membership (`resolveMyOrgId`), then filter by
 * `_parent.reference`. No visible membership -> no org to scope to -> `[]`
 * (not an error: same "nothing visible" shape `resolveMyOrgId` documents).
 */
export async function listSeasons(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<Season[]> {
	const { resolveMyOrgId } = await import('$lib/org/myOrg');
	const orgId = await resolveMyOrgId(cfg, personId, fetchImpl);
	if (!orgId) return [];

	const res = await entuFetch(
		cfg.db,
		// `_owner,_editor` ride along (#91 F1): the repertoire management controls
		// need `_editor` on the season, and asking for it HERE replaces a separate
		// per-entity rights GET with zero extra round-trips.
		`entity?_type.string=season&_parent.reference=${encodeURIComponent(orgId)}&props=name,start_date,end_date,conductor,_owner,_editor&limit=200`,
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
 * List a season's rehearsal events as AgendaItems, applying the read-time
 * series-inheritance merge. Season-scoped (events under the season).
 *
 * Series identification is DE-FANNED: single-collective drops the org arg, so we
 * find the event's `event_series` parent via the denormalized `_parent[].entity_type`
 * (the old code found it as "the ref that is neither org nor season"). The MERGE
 * itself is kept VERBATIM from the harvest: fetch each parent series once (cache →
 * no N+1), fill `duration_minutes`/`location` that are absent on the event; never a
 * formula (rights-leak); the explicit event value always wins.
 */
export async function listRehearsals(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<AgendaItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&event_type.string=rehearsal&_parent.reference=${seasonId}&props=name,start_datetime,duration_minutes,location,_parent,conductor,_owner,_editor&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listRehearsals failed: ${res.status}`);

	const body = (await res.json()) as { entities?: RehearsalRaw[] };
	const raws = body.entities ?? [];
	if (raws.length === 0) return [];

	const seriesIdFor = (raw: RehearsalRaw): string =>
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
