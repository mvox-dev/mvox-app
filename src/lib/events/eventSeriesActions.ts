// Event-to-series reassign and unassign: writes touch only the series `_parent` value.

// An event's `_parent` holds its season and its series; every write filters to the event_series
// value, since "the first value" may be the season's.
import { entuFetch } from '$lib/entu/request';
import { readParentValues } from '$lib/entu/readParents';
import { overwriteEntityValues } from '$lib/entu/replaceProperty';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

interface EventParentValue {
	_id: string;
	reference: string;
	entity_type?: string;
}

export class EventSeriesMissingError extends Error {
	constructor(readonly eventId: string) {
		super(`unassignEventSeries: event ${eventId} has no event_series _parent value to remove`);
		this.name = 'EventSeriesMissingError';
	}
}

function seriesParentValueOf(values: EventParentValue[]): EventParentValue | undefined {
	return values.find((p) => p.entity_type === 'event_series');
}

export async function reassignEventSeries(
	cfg: EntuCfg,
	eventId: string,
	newSeriesId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const parents = await readParentValues<EventParentValue>(
		cfg,
		eventId,
		'reassignEventSeries',
		fetchImpl
	);
	const existingSeries = seriesParentValueOf(parents);
	await overwriteEntityValues(
		cfg,
		eventId,
		[
			{
				value: { type: '_parent', reference: newSeriesId },
				existing: existingSeries ? [existingSeries] : []
			}
		],
		fetchImpl,
		'reassignEventSeries'
	);
}

// Owner-gated on the wire for an editor; a 403 throws like any non-2xx, Entu is the authority.
export async function unassignEventSeries(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const parents = await readParentValues<EventParentValue>(
		cfg,
		eventId,
		'unassignEventSeries',
		fetchImpl
	);
	const existingSeries = seriesParentValueOf(parents);
	if (!existingSeries) throw new EventSeriesMissingError(eventId);

	const delRes = await entuFetch(
		cfg.db,
		`property/${existingSeries._id}`,
		cfg.token,
		{ method: 'DELETE' },
		fetchImpl
	);
	if (!delRes.ok) throw new Error(`unassignEventSeries delete failed: ${delRes.status}`);
}

// (*MVOX:Palestrina* — #304 GREEN: event↔series write layer)
