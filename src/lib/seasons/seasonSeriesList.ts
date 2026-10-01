// The season's event series: the manage panel's list and the event page's picker options.
import { entuFetch } from '$lib/entu/request';
import { isTruncated } from '$lib/entu/listRead';
import { referenceIds } from '$lib/entu/references';
import type { EntuCfg } from './entuSeasons';
import { seriesRefOf, type EventEntity, type SeriesEntity } from './seasonShared';

export interface SeriesListItem {
	id: string;
	name: string;
	eventCount: number;
	/** The series' own `_owner` ids: Entu's DELETE checks the target, not the season. */
	ownerIds: string[];
}

/** No `total`: two collections ride one call, so a summed count would be made up. */
export interface SeriesListRead {
	items: SeriesListItem[];
	truncated: boolean;
}

async function readSeriesEntities(
	cfg: EntuCfg,
	seasonId: string,
	props: string,
	op: string,
	fetchImpl: typeof fetch
): Promise<{ entities: SeriesEntity[]; count?: number }> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event_series&_parent.reference=${seasonId}&props=${props}&limit=200`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`${op} failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: SeriesEntity[] };
	return { entities: body.entities ?? [], count: body.count };
}

export async function listEventSeriesForSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeriesListRead> {
	const { entities: seriesList, count } = await readSeriesEntities(
		cfg,
		seasonId,
		'name,_owner',
		'listEventSeriesForSeason',
		fetchImpl
	);
	const seriesTruncated = isTruncated(seriesList.length, count);
	if (seriesList.length === 0) return { items: [], truncated: seriesTruncated };

	// One season-wide event read grouped client-side, never a per-series count query.
	const eventsRes = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${seasonId}&props=_parent&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!eventsRes.ok) throw new Error(`listEventSeriesForSeason event read failed: ${eventsRes.status}`);
	const eventsBody = (await eventsRes.json()) as { count?: number; entities?: EventEntity[] };
	const events = eventsBody.entities ?? [];
	const eventsTruncated = isTruncated(events.length, eventsBody.count);

	const counts = new Map<string, number>();
	for (const event of events) {
		const seriesRef = seriesRefOf(event);
		if (!seriesRef) continue;
		counts.set(seriesRef, (counts.get(seriesRef) ?? 0) + 1);
	}

	return {
		items: seriesList.map((series) => ({
			id: series._id,
			name: series.name?.[0]?.string ?? '',
			eventCount: counts.get(series._id) ?? 0,
			ownerIds: referenceIds(series._owner)
		})),
		truncated: seriesTruncated || eventsTruncated
	};
}

export interface SeriesOption {
	id: string;
	name: string;
}

/** The picker shows no counts, so it skips the event read the list above needs.
 *  A season holds a handful of series; limit=200 leaves nothing to report as truncated. */
export async function listSeriesOptionsForSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeriesOption[]> {
	const { entities } = await readSeriesEntities(
		cfg,
		seasonId,
		'name',
		'listSeriesOptionsForSeason',
		fetchImpl
	);
	return entities.map((series) => ({
		id: series._id,
		name: series.name?.[0]?.string ?? ''
	}));
}
