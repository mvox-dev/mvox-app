import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { AgendaItem } from '$lib/agenda/types';
import { referenceIds } from '$lib/entu/references';
import type { EventRaw, Season, SeasonRaw, SeriesRaw } from './types';
import { reportProblem } from '$lib/problems/reportProblem';

export interface EntuCfg {
	/** Runtime db (the selected collective) — threaded as the URL path segment. */
	db: string;
	/** The user's Entu JWT (browser-direct, aud=IP-bound). */
	token: string;
}

const typeIdCache = new Map<string, string>();

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

export async function listSeasons(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<Season[]> {
	const { resolveDatabaseEntityId } = await import('$lib/collective/databaseEntity');
	const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl, opts);
	if (!dbEntityId) return [];

	const res = await entuFetch(
		cfg.db,
		// `_owner,_editor` ride along (#91 F1): the repertoire management controls
		// need `_editor` on the season, and asking for it HERE replaces a separate
		// per-entity rights GET with zero extra round-trips.
		`entity?_type.string=season&_parent.reference=${encodeURIComponent(dbEntityId)}&props=name,start_date,end_date,conductor,_owner,_editor&limit=200`,
		cfg.token,
		{},
		fetchImpl,
		opts
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
				conductors: referenceIds(raw.conductor),
				owners: referenceIds(raw._owner),
				editors: referenceIds(raw._editor)
			})
		)
		.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function listEvents(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<AgendaItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${seasonId}&props=event_name,start_datetime,duration_minutes,location,event_type,_parent,conductor,_owner,_editor&limit=500`,
		cfg.token,
		{},
		fetchImpl,
		opts
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
				fetchImpl,
				opts
			);
			if (!sRes.ok) {
				const error = new Error(`HTTP ${sRes.status}`);
				reportProblem({ area: 'agenda', action: 'reading an event series', error });
				return;
			}
			const sBody = (await sRes.json()) as { entity?: SeriesRaw };
			if (sBody.entity) seriesCache.set(sid, sBody.entity);
		})
	);

	return raws
		.map((raw): AgendaItem => {
			const series = seriesCache.get(seriesIdFor(raw));
			return {
				id: raw._id,
				name: raw.event_name?.[0]?.string ?? series?.name?.[0]?.string ?? '',
				startDatetime: raw.start_datetime?.[0]?.datetime ?? '',
				// event value wins; series fills the gap; else 0/''.
				durationMinutes:
					raw.duration_minutes?.[0]?.number ?? series?.duration_minutes?.[0]?.number ?? 0,
				location: raw.location?.[0]?.string ?? series?.default_location?.[0]?.string ?? '',
				// #194/#202 — the event's OWN value only, never the series': the
				// series-inheritance merge above is deliberately not extended here.
				eventType: raw.event_type?.[0]?.string ?? '',
				conductors: referenceIds(raw.conductor),
				// Rights are NEVER merged from the series the way duration/location
				// are: Entu keeps rights per entity, so a series editor is not
				// thereby an editor of this event.
				owners: referenceIds(raw._owner),
				editors: referenceIds(raw._editor)
			};
		})
		.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
}

// (*MVOX:Josquin*)
