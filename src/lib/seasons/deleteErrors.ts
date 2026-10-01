// Delete failures that are not "the write blew up, try again", told apart by their `code`.

// Separate from seasonManage.ts: the agenda spec mocks that module wholesale.
const DELETE_FORBIDDEN = 'entity-delete-forbidden';

// Entu's DELETE needs `_owner` on the target; `_editor` is refused with 403. Nothing was written.
export class EntityDeleteForbiddenError extends Error {
	readonly code = DELETE_FORBIDDEN;

	constructor(readonly entityId: string) {
		super(
			`delete refused: HTTP 403 — the caller is not in entity ${entityId}'s _owner; nothing was deleted`
		);
		this.name = 'EntityDeleteForbiddenError';
	}
}

const SERIES_CASCADE_PARTIAL = 'series-cascade-partial';

// Each cascade deletes children first and stops before the parent, so a retry resumes.
// `failure` is the child rejection; not `cause`, which the runtime may fill.
export class SeriesCascadePartialError extends Error {
	readonly code = SERIES_CASCADE_PARTIAL;

	constructor(
		readonly seriesId: string,
		readonly deletedCount: number,
		readonly totalCount: number,
		readonly failure: unknown
	) {
		super(
			`deleteEventSeries: cascade stopped after ${deletedCount} of ${totalCount} occurrence(s) of series ${seriesId}; the series was NOT deleted`
		);
		this.name = 'SeriesCascadePartialError';
	}
}

const EVENT_CASCADE_PARTIAL = 'event-cascade-partial';

export class EventCascadePartialError extends Error {
	readonly code = EVENT_CASCADE_PARTIAL;

	constructor(
		readonly eventId: string,
		readonly deletedCount: number,
		readonly totalCount: number,
		readonly failure: unknown
	) {
		super(
			`deleteEvent: cascade stopped after ${deletedCount} of ${totalCount} child entit(ies) of event ${eventId}; the event was NOT deleted`
		);
		this.name = 'EventCascadePartialError';
	}
}

// series → occurrence → its children nest three deep; bounded so a self-referential chain stops.
const FAILURE_CHAIN_DEPTH = 5;

// Duck-typed on `code`: reasons cross mock boundaries as plain tagged objects.
export function isDeleteForbidden(reason: unknown): boolean {
	let node = reason as { code?: unknown; failure?: unknown } | null | undefined;
	for (let depth = 0; depth < FAILURE_CHAIN_DEPTH && node; depth += 1) {
		if (node.code === DELETE_FORBIDDEN) return true;
		node = node.failure as { code?: unknown; failure?: unknown } | null | undefined;
	}
	return false;
}

export function isSeriesCascadePartial(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === SERIES_CASCADE_PARTIAL;
}

export function isEventCascadePartial(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === EVENT_CASCADE_PARTIAL;
}

const SEASON_CASCADE_PARTIAL = 'season-cascade-partial';

// The counts cover series + events + repertoire items, never the season itself.
export class SeasonCascadePartialError extends Error {
	readonly code = SEASON_CASCADE_PARTIAL;

	constructor(
		readonly seasonId: string,
		readonly deletedCount: number,
		readonly totalCount: number,
		readonly failure: unknown
	) {
		super(
			`deleteSeason: cascade stopped after ${deletedCount} of ${totalCount} entit(ies) of season ${seasonId}; the season was NOT deleted`
		);
		this.name = 'SeasonCascadePartialError';
	}
}

export function isSeasonCascadePartial(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === SEASON_CASCADE_PARTIAL;
}

export interface DeleteFailure {
	reason: 'write' | 'forbidden' | 'partial' | 'partial-season';
	deleted?: number;
	total?: number;
}

// A season's own cascade gets 'partial-season'; a series cascade inside it stays 'partial'.
export function classifyDeleteFailure(
	target: 'event' | 'series' | 'season',
	reason: unknown
): DeleteFailure {
	if (isDeleteForbidden(reason)) return { reason: 'forbidden' };
	const counts = reason as { deletedCount?: number; totalCount?: number } | null | undefined;
	const deleted = counts?.deletedCount ?? 0;
	const total = counts?.totalCount ?? 0;
	if (target === 'season' && isSeasonCascadePartial(reason)) {
		return { reason: 'partial-season', deleted, total };
	}
	const partial = target === 'event' ? isEventCascadePartial : isSeriesCascadePartial;
	if (partial(reason)) return { reason: 'partial', deleted, total };
	return { reason: 'write' };
}
