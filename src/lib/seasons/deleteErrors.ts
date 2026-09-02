// #197 review — the two event/series DELETE failures that are NOT "the write
// blew up, try again", told apart from every other rejection.
//
// Lives in its OWN module, not in `seasonManage.ts`, for exactly the reason
// `sectionErrors.ts` does: the agenda page's integration spec replaces
// `$lib/seasons/seasonManage` wholesale with a `vi.mock` factory, so anything
// the page imported from THERE would be `undefined` under test. Importing the
// discriminators from here keeps ONE source of truth for the code strings with
// no mock-shaped coupling.

/** Discriminator carried on a 403-refused delete. */
export const DELETE_FORBIDDEN = 'entity-delete-forbidden';

/**
 * Thrown when Entu refuses a `DELETE /entity/{id}` with 403. Verified in the
 * API source (entu-api `routes/[db]/entity/[_id]/index.delete.js`): the handler
 * reads the TARGET entity's `private._owner` and throws 403 "User not in _owner
 * property" for everyone else — `_editor` does NOT satisfy it. Delete is thus
 * the one season-manage-panel operation an `_editor` can be refused for while
 * every POST on the same panel succeeds, so it gets its own message instead of
 * the retry-flavoured generic one (#197 review F3).
 *
 * NOTHING has been written when this throws.
 */
export class EntityDeleteForbiddenError extends Error {
	readonly code = DELETE_FORBIDDEN;

	constructor(readonly entityId: string) {
		super(
			`delete refused: HTTP 403 — the caller is not in entity ${entityId}'s _owner; nothing was deleted`
		);
		this.name = 'EntityDeleteForbiddenError';
	}
}

/** Discriminator carried on a series cascade that stopped part-way. */
export const SERIES_CASCADE_PARTIAL = 'series-cascade-partial';

/**
 * Thrown by `deleteEventSeries` when one of the series' OCCURRENCE deletes
 * fails. The series itself is deliberately still standing (the cascade deletes
 * occurrences FIRST and aborts before the series DELETE), so the surviving
 * occurrences keep their `_parent` → series reference and a retry resumes where
 * this stopped — no orphans, at the cost of a partially-emptied series the
 * operator can see and re-try.
 */
export class SeriesCascadePartialError extends Error {
	readonly code = SERIES_CASCADE_PARTIAL;

	constructor(
		readonly seriesId: string,
		readonly deletedCount: number,
		readonly totalCount: number,
		/** The occurrence-delete rejection that stopped the cascade. Named
		 *  `failure` rather than `cause` so it never collides with the built-in
		 *  `Error.cause` slot the runtime may or may not populate. */
		readonly failure: unknown
	) {
		super(
			`deleteEventSeries: cascade stopped after ${deletedCount} of ${totalCount} occurrence(s) of series ${seriesId}; the series was NOT deleted`
		);
		this.name = 'SeriesCascadePartialError';
	}
}

/** Discriminator carried on an event cascade that stopped part-way. */
export const EVENT_CASCADE_PARTIAL = 'event-cascade-partial';

/**
 * Thrown by `deleteEvent` when one of the event's CHILD deletes (attendance /
 * program_item) fails. The event itself is deliberately still standing (the
 * cascade deletes children FIRST and aborts before the event DELETE), so the
 * surviving children keep their `_parent` → event reference and a retry
 * resumes where this stopped — no orphans, at the cost of a partially-emptied
 * event the operator can see and re-try (#197 review 2nd pass F1, the exact
 * shape `SeriesCascadePartialError` keeps one level up).
 */
export class EventCascadePartialError extends Error {
	readonly code = EVENT_CASCADE_PARTIAL;

	constructor(
		readonly eventId: string,
		readonly deletedCount: number,
		readonly totalCount: number,
		/** The child-delete rejection that stopped the cascade (named `failure`
		 *  for the same reason as above). */
		readonly failure: unknown
	) {
		super(
			`deleteEvent: cascade stopped after ${deletedCount} of ${totalCount} child entit(ies) of event ${eventId}; the event was NOT deleted`
		);
		this.name = 'EventCascadePartialError';
	}
}

/** How deep `isDeleteForbidden` follows a `failure` chain. Two cascades nest
 *  (series → occurrence event → the occurrence's own children), so a 403 can
 *  sit three links down. Bounded so a self-referential `failure` cannot spin. */
const FAILURE_CHAIN_DEPTH = 5;

/**
 * True when a rejection reason means the delete was REFUSED for lack of
 * `_owner` on the target (nothing written). Duck-typed on `code` rather than
 * `instanceof` — rejection reasons cross module and mock boundaries as
 * `unknown`, and a spec's mocked write layer rejects with a plain tagged
 * object. Walks the `failure` CHAIN, not just one link: a 403 on a program_item
 * inside an occurrence inside a series cascade is still the same permission
 * story, and the panel must not call it "try again".
 */
export function isDeleteForbidden(reason: unknown): boolean {
	let node = reason as { code?: unknown; failure?: unknown } | null | undefined;
	for (let depth = 0; depth < FAILURE_CHAIN_DEPTH && node; depth += 1) {
		if (node.code === DELETE_FORBIDDEN) return true;
		node = node.failure as { code?: unknown; failure?: unknown } | null | undefined;
	}
	return false;
}

/** True when a rejection reason means a series cascade stopped part-way — some
 *  occurrences are gone, the series and the rest are still there. */
export function isSeriesCascadePartial(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === SERIES_CASCADE_PARTIAL;
}

/** True when a rejection reason means an EVENT cascade stopped part-way — some
 *  of the event's children are gone, the event and the rest are still there. */
export function isEventCascadePartial(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === EVENT_CASCADE_PARTIAL;
}

/** Discriminator carried on a season cascade that stopped part-way (#217). */
export const SEASON_CASCADE_PARTIAL = 'season-cascade-partial';

/**
 * Thrown by `deleteSeason` when one of the season's children (a series, a
 * standalone event, or a repertoire item) fails to delete. The season itself
 * is deliberately still standing (the cascade deletes children FIRST and
 * aborts before the season DELETE), so the surviving children keep their
 * `_parent` → season reference and a retry resumes where this stopped — the
 * same no-orphans shape `SeriesCascadePartialError`/`EventCascadePartialError`
 * keep one and two levels down. `deletedCount`/`totalCount` are counted over
 * the SAME denominator the confirm promised (series + events + repertoire
 * items) — the season entity itself is outside that count and never included.
 */
export class SeasonCascadePartialError extends Error {
	readonly code = SEASON_CASCADE_PARTIAL;

	constructor(
		readonly seasonId: string,
		readonly deletedCount: number,
		readonly totalCount: number,
		/** The child-delete rejection that stopped the cascade (named `failure`
		 *  for the same reason as its siblings above — never collides with the
		 *  built-in `Error.cause` slot). */
		readonly failure: unknown
	) {
		super(
			`deleteSeason: cascade stopped after ${deletedCount} of ${totalCount} entit(ies) of season ${seasonId}; the season was NOT deleted`
		);
		this.name = 'SeasonCascadePartialError';
	}
}

/** True when a rejection reason means a SEASON cascade stopped part-way — some
 *  of the season's series/events/repertoire items are gone, the season and the
 *  rest are still there. */
export function isSeasonCascadePartial(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === SEASON_CASCADE_PARTIAL;
}

// (*MVOX:Palestrina* — #197 review F1/F3: delete refusal + cascade discriminators)
// (*MVOX:Palestrina* — #197 review 2nd pass F1: event-cascade discriminator)
// (*MVOX:Palestrina* — #217 GREEN (folds #216): season-cascade discriminator)
