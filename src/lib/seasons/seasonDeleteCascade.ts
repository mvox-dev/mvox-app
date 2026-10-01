// Series and season delete cascades, with the one progress counter they share.
import { entuFetch } from '$lib/entu/request';
import { SeasonCascadePartialError, SeriesCascadePartialError } from './deleteErrors';
import type { EntuCfg } from './entuSeasons';
import { CHILD_READ_LIMIT, deleteEntity, deleteEvent, listChildIds } from './seasonDeleteEvent';
import { seriesRefOf, type EventEntity } from './seasonShared';

/** The ruled denominator: series, events and repertoire items, never a child or the season. */
type CascadeProgressKind = 'series' | 'event' | 'repertoire';

type CascadeOnProgress = (
	current: number,
	total: number,
	kind: CascadeProgressKind
) => void;

interface CascadeOptions {
	onProgress?: CascadeOnProgress;
}

/** `events` counts every event the season holds, occurrences and standalone alike. */
interface SeasonScope {
	series: number;
	events: number;
	repertoireItems: number;
}

/** Occurrences first, series last: a failure aborts before the series delete, so a retry resumes.
 *  Resolves with how many occurrences went; the series itself is the final progress tick. */
export async function deleteEventSeries(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch = fetch,
	options: CascadeOptions = {}
): Promise<number> {
	const { onProgress } = options;
	const occurrenceIds = await listChildIds(cfg, seriesId, 'event', 'deleteEventSeries', fetchImpl);
	const total = occurrenceIds.length + 1;

	let deleted = 0;
	for (const eventId of occurrenceIds) {
		try {
			await deleteEvent(cfg, eventId, fetchImpl);
		} catch (failure) {
			throw new SeriesCascadePartialError(seriesId, deleted, occurrenceIds.length, failure);
		}
		deleted += 1;
		onProgress?.(deleted, total, 'event');
	}

	await deleteEntity(cfg, seriesId, 'deleteEventSeries', fetchImpl);
	onProgress?.(total, total, 'series');
	return deleted;
}

/** A read for the confirm, under the same refusal as the cascade it previews. */
export async function countSeasonScope(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeasonScope> {
	const scope = await readSeasonScope(cfg, seasonId, 'countSeasonScope', fetchImpl);
	return {
		series: scope.seriesIds.length,
		events: scope.eventEntities.length,
		repertoireItems: scope.repertoireIds.length
	};
}

interface SeasonScopeIds {
	seriesIds: string[];
	eventEntities: EventEntity[];
	repertoireIds: string[];
}

async function readSeasonScope(
	cfg: EntuCfg,
	seasonId: string,
	op: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeasonScopeIds> {
	const seriesIds = await listChildIds(cfg, seasonId, 'event_series', op, fetchImpl);
	const eventEntities = await listSeasonEvents(cfg, seasonId, op, fetchImpl);
	const repertoireIds = await listChildIds(cfg, seasonId, 'repertoire_item', op, fetchImpl);
	return { seriesIds, eventEntities, repertoireIds };
}

/** Like `listChildIds`, but keeps `_parent` to tell occurrences from standalone events. */
async function listSeasonEvents(
	cfg: EntuCfg,
	seasonId: string,
	op: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventEntity[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${encodeURIComponent(seasonId)}&props=_id,_parent&limit=${CHILD_READ_LIMIT}`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`${op} event lookup failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: EventEntity[] };
	const rows = body.entities ?? [];
	const total = body.count ?? rows.length;
	if (total > rows.length) {
		throw new Error(
			`${op}: ${seasonId} has ${total} event children, more than the ${CHILD_READ_LIMIT}-row cascade read can carry — nothing was deleted`
		);
	}
	return rows;
}

/** Series, standalone events, repertoire items, then the season, serially. A failure
 *  part-way credits the ticks already emitted; the season's own final delete is not wrapped. */
export async function deleteSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch,
	options: CascadeOptions = {}
): Promise<SeasonScope> {
	const { onProgress } = options;
	const { seriesIds, eventEntities, repertoireIds } = await readSeasonScope(
		cfg,
		seasonId,
		'deleteSeason',
		fetchImpl
	);
	const standaloneEventIds = eventEntities
		.filter((event) => seriesRefOf(event) === undefined)
		.map((event) => event._id);
	const total = seriesIds.length + eventEntities.length + repertoireIds.length;

	let done = 0;
	let deletedSeries = 0;
	let deletedEvents = 0;
	let deletedRepertoire = 0;

	for (const seriesId of seriesIds) {
		const baseDone = done;
		let lastTicked = baseDone;
		let occurrencesDeleted: number;
		try {
			occurrencesDeleted = await deleteEventSeries(cfg, seriesId, fetchImpl, {
				onProgress: (current, _seriesTotal, kind) => {
					lastTicked = baseDone + current;
					onProgress?.(baseDone + current, total, kind);
				}
			});
		} catch (failure) {
			throw new SeasonCascadePartialError(seasonId, lastTicked, total, failure);
		}
		done = baseDone + occurrencesDeleted + 1;
		deletedEvents += occurrencesDeleted;
		deletedSeries += 1;
	}

	for (const eventId of standaloneEventIds) {
		try {
			await deleteEvent(cfg, eventId, fetchImpl);
		} catch (failure) {
			throw new SeasonCascadePartialError(seasonId, done, total, failure);
		}
		done += 1;
		deletedEvents += 1;
		onProgress?.(done, total, 'event');
	}

	for (const repertoireId of repertoireIds) {
		try {
			await deleteEntity(cfg, repertoireId, 'deleteSeason', fetchImpl);
		} catch (failure) {
			throw new SeasonCascadePartialError(seasonId, done, total, failure);
		}
		done += 1;
		deletedRepertoire += 1;
		onProgress?.(done, total, 'repertoire');
	}

	await deleteEntity(cfg, seasonId, 'deleteSeason', fetchImpl);

	return { series: deletedSeries, events: deletedEvents, repertoireItems: deletedRepertoire };
}
