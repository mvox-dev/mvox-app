// The season's standalone events: those parented to the season and to no series.
import { entuFetch } from '$lib/entu/request';
import { deriveListRead, type ListRead } from '$lib/entu/listRead';
import type { EntuCfg } from './entuSeasons';
import { seriesRefOf, type EventEntity } from './seasonShared';

export interface StandaloneEvent {
	id: string;
	name: string;
	startDatetime: string;
}

/** `truncated` compares against the raw read, before the standalone filter:
 *  a filtered-out occurrence is not a missing row. */
export async function listEventsForSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<StandaloneEvent>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${seasonId}&props=event_name,start_datetime,_parent&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEventsForSeason failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: EventEntity[] };
	const events = body.entities ?? [];
	const items = events
		.filter((event) => seriesRefOf(event) === undefined)
		.map((event) => ({
			id: event._id,
			name: event.event_name?.[0]?.string ?? '',
			startDatetime: event.start_datetime?.[0]?.datetime ?? ''
		}));
	return deriveListRead(items, events.length, body.count);
}
