import { entuFetch } from '$lib/entu/request';
import type { AgendaItem } from '$lib/agenda/types';
import type { RehearsalRaw, Season, SeasonRaw, SeriesRaw } from './types';

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
 * per `db:typeName` — type definitions don't change at runtime. Stub for #10 RED:
 * needed by rsvpData.ts's createRsvp; not yet implemented.
 */
export async function resolveTypeId(
	cfg: EntuCfg,
	typeName: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	throw new Error('not implemented');
}

/** Test-only: clear the type-id cache between cases. */
export function resetTypeIdCache(): void {
	typeIdCache.clear();
}

// (*MVOX:Tallis*)

/**
 * List the collective's seasons. DE-FANNED for single-collective: the selected db
 * IS the collective, so we drop the old org-`_parent` scoping and read every
 * `season` in the db (in polyphony all seasons are EFK's). Sorted by start date.
 */
export async function listSeasons(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Season[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=season&props=name,start_date,end_date&limit=200',
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
				endDate: raw.end_date?.[0]?.date?.slice(0, 10) ?? ''
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
		`entity?_type.string=event&event_type.string=rehearsal&_parent.reference=${seasonId}&props=name,start_datetime,duration_minutes,location,_parent&limit=500`,
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
				`entity/${sid}?props=default_location,duration_minutes`,
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
				name: raw.name?.[0]?.string ?? '',
				startDatetime: raw.start_datetime?.[0]?.datetime ?? '',
				// event value wins; series fills the gap; else 0/''.
				durationMinutes:
					raw.duration_minutes?.[0]?.number ?? series?.duration_minutes?.[0]?.number ?? 0,
				location: raw.location?.[0]?.string ?? series?.default_location?.[0]?.string ?? ''
			};
		})
		.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
}

// (*MVOX:Josquin*)
