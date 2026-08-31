// #132/T3 GREEN — the season-management DATA layer, at the `fetchImpl` seam
// (same harness family as entuSeasons.ts). See seasonManage.spec.ts for the
// full pinned wire contract; short version:
//
//   - listEventSeriesForSeason: the season's event_series children with each
//     series' event count, in exactly TWO fetches (no N+1) — one series-list
//     read, one season-wide event read grouped client-side by the events'
//     denormalized `_parent[].entity_type === 'event_series'` ref.
//   - listEventsForSeason: events parented DIRECTLY to the season and NOT to
//     any event_series ("standalone" — a season event is multi-parent when it
//     belongs to a series, so the series ref's absence in `_parent` is what
//     marks a standalone event). No event_type filter — a standalone event is
//     typically a concert.
//   - updateSeasonField: the eventFieldEdit.ts replace choreography, verbatim
//     (GET old value ids -> POST one new value -> DELETE every old id, POST
//     BEFORE DELETE). Seasons carry calendar DATES on start_date/end_date
//     (`{type, date}`), never datetime.
//   - addSeasonConductor: `conductor` is multi-valued by design, so adding is
//     a plain append — one POST, no GET, no DELETE.
//   - removeSeasonConductor: GET the conductor values, DELETE only the one
//     whose `reference` matches — the other conductors survive untouched.
//     Absent ref resolves as a no-op (idempotent double-tap).
//
// Non-2xx anywhere throws (fail loud, no silent success) — the panel is what
// turns that into an inline error.
import { entuFetch } from '$lib/entu/request';
import {
	EntityDeleteForbiddenError,
	EventCascadePartialError,
	SeriesCascadePartialError
} from './deleteErrors';
import type { EntuCfg } from './entuSeasons';

export type { EntuCfg } from './entuSeasons';

export interface SeriesListItem {
	id: string;
	name: string;
	eventCount: number;
}

export interface StandaloneEvent {
	id: string;
	name: string;
	startDatetime: string;
}

export type SeasonEditableField = 'name' | 'start_date' | 'end_date';

interface ParentRef {
	reference: string;
	entity_type?: string;
}

interface SeriesEntity {
	_id: string;
	name?: Array<{ string: string }>;
}

interface EventEntity {
	_id: string;
	name?: Array<{ string: string }>;
	start_datetime?: Array<{ datetime: string }>;
	_parent?: ParentRef[];
}

/** The event's event_series parent, if it has one — absence marks it standalone. */
function seriesRefOf(event: EventEntity): string | undefined {
	return (event._parent ?? []).find((p) => p.entity_type === 'event_series')?.reference;
}

export async function listEventSeriesForSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeriesListItem[]> {
	const seriesRes = await entuFetch(
		cfg.db,
		`entity?_type.string=event_series&_parent.reference=${seasonId}&props=name&limit=200`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!seriesRes.ok) throw new Error(`listEventSeriesForSeason failed: ${seriesRes.status}`);
	const seriesBody = (await seriesRes.json()) as { entities?: SeriesEntity[] };
	const seriesList = seriesBody.entities ?? [];
	if (seriesList.length === 0) return [];

	// ONE season-wide event read carries every event's `_parent`, grouped
	// client-side — never a per-series count query (review checklist #2).
	const eventsRes = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${seasonId}&props=_parent&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!eventsRes.ok) throw new Error(`listEventSeriesForSeason event read failed: ${eventsRes.status}`);
	const eventsBody = (await eventsRes.json()) as { entities?: EventEntity[] };
	const events = eventsBody.entities ?? [];

	const counts = new Map<string, number>();
	for (const event of events) {
		const seriesRef = seriesRefOf(event);
		if (!seriesRef) continue;
		counts.set(seriesRef, (counts.get(seriesRef) ?? 0) + 1);
	}

	return seriesList.map((series) => ({
		id: series._id,
		name: series.name?.[0]?.string ?? '',
		eventCount: counts.get(series._id) ?? 0
	}));
}

export async function listEventsForSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<StandaloneEvent[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${seasonId}&props=name,start_datetime,_parent&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEventsForSeason failed: ${res.status}`);
	const body = (await res.json()) as { entities?: EventEntity[] };
	const events = body.entities ?? [];
	return events
		.filter((event) => seriesRefOf(event) === undefined)
		.map((event) => ({
			id: event._id,
			name: event.name?.[0]?.string ?? '',
			startDatetime: event.start_datetime?.[0]?.datetime ?? ''
		}));
}

/** Which wire value key each editable season field is written under. Seasons
 *  carry calendar DATES, never datetime (unlike events). */
function seasonWireProp(field: SeasonEditableField, value: string): Record<string, unknown> {
	switch (field) {
		case 'start_date':
		case 'end_date':
			return { type: field, date: value };
		default:
			return { type: field, string: value };
	}
}

export async function updateSeasonField(
	cfg: EntuCfg,
	seasonId: string,
	field: SeasonEditableField,
	value: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${seasonId}?props=${field}`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`updateSeasonField lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: Record<string, Array<{ _id: string }>> };
	const existing = body.entity?.[field] ?? [];

	const postRes = await entuFetch(
		cfg.db,
		`entity/${seasonId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([seasonWireProp(field, value)])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`updateSeasonField POST failed: ${postRes.status}`);

	for (const v of existing) {
		const delRes = await entuFetch(cfg.db, `property/${v._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`updateSeasonField delete failed: ${delRes.status}`);
	}
}

export async function addSeasonConductor(
	cfg: EntuCfg,
	seasonId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seasonId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'conductor', reference: personId }])
		},
		fetchImpl
	);
	if (!res.ok) throw new Error(`addSeasonConductor failed: ${res.status}`);
}

export async function removeSeasonConductor(
	cfg: EntuCfg,
	seasonId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${seasonId}?props=conductor`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`removeSeasonConductor lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as {
		entity?: { conductor?: Array<{ _id: string; reference?: string }> };
	};
	const values = body.entity?.conductor ?? [];
	const match = values.find((v) => v.reference === personId);
	if (!match) return; // idempotent — a double-tap or a stale chip is a no-op, not a 404.

	const delRes = await entuFetch(cfg.db, `property/${match._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!delRes.ok) throw new Error(`removeSeasonConductor delete failed: ${delRes.status}`);
}

// ── #132/T4 — series defaults for the event-creation inheritance preview ──────

/** The four event fields a series occurrence inherits when it does not carry
 *  its own value (v4E: name / duration_minutes / location / description ←
 *  series name / duration_minutes / default_location / default_description).
 *  `durationMinutes` is null when the series carries none. */
export interface SeriesDefaults {
	name: string;
	durationMinutes: number | null;
	defaultLocation: string;
	defaultDescription: string;
}

interface SeriesDefaultsEntity {
	name?: Array<{ string: string }>;
	default_location?: Array<{ string: string }>;
	default_description?: Array<{ string: string }>;
	duration_minutes?: Array<{ number: number }>;
}

/**
 * #132/T4 GREEN — the event-creation inheritance PREVIEW's source.
 *
 * ONE fetch, the same read `loadEventDetail`'s merge already performs per series:
 *   entity/{seriesId}?props=name,default_location,duration_minutes,default_description
 * The event-creation form shows these as PLACEHOLDERS (never values) on the
 * name / duration / location / description inputs while that series is selected
 * — the same read-side inheritance the agenda merge applies, previewed at write
 * time. `default_description` joins the set in the #132/T4 review (2nd pass) F4:
 * the read side has always inherited it (eventDetail.ts's
 * `event.description ?? series.default_description`), so leaving it out of the
 * preview meant a viewer could not tell that a blank description would inherit.
 * Non-2xx throws (fail loud).
 */
export async function getSeriesDefaults(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeriesDefaults> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seriesId}?props=name,default_location,duration_minutes,default_description`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`getSeriesDefaults failed: ${res.status}`);
	const body = (await res.json()) as { entity?: SeriesDefaultsEntity };
	const entity = body.entity ?? {};
	return {
		name: entity.name?.[0]?.string ?? '',
		durationMinutes: entity.duration_minutes?.[0]?.number ?? null,
		defaultLocation: entity.default_location?.[0]?.string ?? '',
		defaultDescription: entity.default_description?.[0]?.string ?? ''
	};
}

// #197 GREEN — the event / event-series DELETE write layer.
//
// CONTRACT (pinned by seasonManage.delete.spec.ts):
//
//   - `deleteEvent` CASCADES to the event's OWN children — its `attendance`
//     rows and its `program_item` rows — and only then DELETEs the event
//     entity. Everything goes through the ENTITY endpoint (the pinned Entu
//     endpoint split: an event / attendance / program_item id is an ENTITY id;
//     `/property/{id}` is for property-VALUE ids only).
//
//     #197 review 2nd pass F1 — the first two cuts of this function issued a
//     bare `DELETE entity/{eventId}`. An event IS a parent in v4E: `attendance`
//     is read as `_type.string=attendance&_parent.reference={eventId}`
//     (attendanceData.listAttendance) and `program_item` as
//     `_type.string=program_item&_parent.reference={eventId}`
//     (repertoireData.listProgramItems). The same platform behaviour the series
//     cascade exists for applies one level down: a DELETE soft-deletes every
//     property REFERENCING the target, so each child SURVIVED with its
//     `_parent` → event value stripped — inert rows nothing in the app can
//     reach, one set per deleted event and N sets per cascaded series. The only
//     place they surfaced was `listMyAttendance`, which dropped each one with a
//     `console.warn` blaming prop-def `_sharing` — the wrong diagnosis for a row
//     whose parent was deleted.
//
//     Cascade rather than `deleteSection`'s REFUSAL, for the series' reason
//     exactly: neither an attendance row nor a program_item is deletable from
//     this panel, so "empty the event first" is not an instruction the operator
//     can carry out — refusing would make every event that ever held a
//     programme or a marked rehearsal permanently undeletable in-app.
//
//     NOT cascaded, deliberately: `rsvp`. An rsvp is a child of the PERSON who
//     wrote it and points at the event through its own `event` REFERENCE prop,
//     so Entu soft-deletes that reference value and the row stays where it
//     belongs — under its author, who owns it. Deleting it would need `_owner`
//     on somebody else's entity, which a conductor does not have: the cascade
//     would 403 and make every event with a single RSVP undeletable. The
//     dangling row reads back with an empty `eventId` (`rsvpData.listMyRsvps`)
//     and indexes under a key no event has.
//
//   - `deleteEventSeries` CASCADES: read the series' occurrence events, DELETE
//     each of them (through `deleteEvent`, so each occurrence takes its own
//     children with it), and only then DELETE the series entity. It RESOLVES
//     WITH the number of occurrences it deleted — #197 review 2nd pass F2: the
//     panel used to announce the row's client-derived `eventCount` after a
//     cascade that had counted for itself, so the number the operator was shown
//     and the number actually destroyed were two independent reads.
//
//     #197 review F1 — the first cut of this layer did one DELETE and declared
//     child handling a non-issue, on the claim that "an event's `_parent`
//     reference to the series is left standing". That claim is false, and the
//     resulting behaviour was neither cascade nor refusal: it ORPHANED.
//     Verified in the Entu API source (entu-api
//     `routes/[db]/entity/[_id]/index.delete.js`): a DELETE inserts a
//     `_deleted` property on the TARGET only, then
//     `updateMany({ reference: entityId }, { $set: { deleted } })` soft-deletes
//     EVERY property REFERENCING it — i.e. exactly each occurrence's
//     `_parent` → series value. The occurrences SURVIVE the series, stripped of
//     the only link they had to it. And a series occurrence carries no own
//     name / duration_minutes / location (the page's create path writes none —
//     the READ side inherits them from the series: `listRehearsals`' merge and
//     `eventDetail`'s), so what a "clean" series delete left behind was a set
//     of nameless, 0-duration, location-less agenda rows, reclassified as
//     "standalone" by `listEventsForSeason` (`seriesRefOf` now undefined), with
//     no way to re-link them from the app. That is the exact inverse of #197's
//     user story ("delete the 'Proov' series so I can recreate it").
//
//     Cascade rather than `deleteSection`'s REFUSAL, even though both face the
//     same platform behaviour: a series occurrence is not independently
//     reachable from this UI — the panel lists STANDALONE events only — so
//     "delete the N occurrences first" is not an instruction the operator can
//     carry out, and a refusal would make every non-empty series permanently
//     undeletable in-app.
//
//     Occurrences FIRST, series last, and any occurrence failure aborts before
//     the series DELETE (`SeriesCascadePartialError`, carrying how many went):
//     the series survives, the remaining occurrences keep their `_parent`, and
//     a retry resumes. The reverse order would orphan on precisely the failure
//     the ordering exists to survive.
//
//   - A 403 is told apart from every other failure
//     (`EntityDeleteForbiddenError`, #197 review F3): Entu's DELETE requires
//     the caller in the TARGET entity's `private._owner` (same source), which
//     `_editor` alone does not satisfy — delete is the one panel operation a
//     season EDITOR can be refused for while every POST beside it succeeds. The
//     panel turns that into a permission message, not a "try again".
//
//   - Every other non-2xx throws with the status surfaced (fail loud, no silent
//     success) — the panel turns that into an inline error.

/** How many children one cascade read can carry. A parent with more is refused
 *  loudly rather than half-cascaded (see `listChildIds`). */
const CHILD_READ_LIMIT = 500;

/** The child types an `event` parents in v4E — every one of them read by its
 *  own `_parent.reference={eventId}` query elsewhere in the app
 *  (attendanceData.listAttendance / repertoireData.listProgramItems), and so
 *  every one of them left dangling by a bare event DELETE. */
const EVENT_CHILD_TYPES = ['attendance', 'program_item'] as const;

/**
 * The ids of every `childType` entity parented to `parentId` — a cascade's work
 * list. `op` names the caller so a failure says which delete blew up.
 *
 * Refuses (throws, nothing deleted) when the server's `count` exceeds what the
 * capped read returned: a partial work list would delete SOME children and then
 * delete the parent, orphaning the rest — the very failure the cascade exists
 * to prevent.
 */
async function listChildIds(
	cfg: EntuCfg,
	parentId: string,
	childType: string,
	op: string,
	fetchImpl: typeof fetch = fetch
): Promise<string[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=${childType}&_parent.reference=${encodeURIComponent(parentId)}&props=_id&limit=${CHILD_READ_LIMIT}`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`${op} ${childType} lookup failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: Array<{ _id?: string }> };
	const ids = (body.entities ?? []).flatMap((e) => (e._id ? [e._id] : []));
	const total = body.count ?? ids.length;
	if (total > ids.length) {
		throw new Error(
			`${op}: ${parentId} has ${total} ${childType} children, more than the ${CHILD_READ_LIMIT}-row cascade read can carry — nothing was deleted`
		);
	}
	return ids;
}

/** DELETE one entity, mapping Entu's 403 onto the tagged refusal. */
async function deleteEntity(
	cfg: EntuCfg,
	entityId: string,
	op: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${entityId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (res.status === 403) throw new EntityDeleteForbiddenError(entityId);
	if (!res.ok) throw new Error(`${op} failed: ${res.status}`);
}

/**
 * How many occurrence events the series holds RIGHT NOW — the number the
 * panel's two-step confirm shows before arming an irreversible cascade (#197
 * review 2nd pass F2). Deliberately its own one-row read of the server's
 * `count`, not the panel list's client-side tally: the list derives its counts
 * from ONE season-wide `limit=500` event read, so it under-reports a big season
 * and misses anything created since it last ran, and the confirm must not
 * promise a number the write never checks.
 */
export async function countSeriesOccurrences(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch = fetch
): Promise<number> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${encodeURIComponent(seriesId)}&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`countSeriesOccurrences failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: unknown[] };
	return body.count ?? body.entities?.length ?? 0;
}

/** Delete an `event` entity (standalone or a series occurrence) AND its own
 *  children — #197. See module contract above for which children, and why this
 *  cascades rather than refusing. */
export async function deleteEvent(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	// The whole work list BEFORE the first destructive call: an over-limit
	// refusal on the second child type must not land after the first type's rows
	// are already gone.
	const childIds: string[] = [];
	for (const childType of EVENT_CHILD_TYPES) {
		childIds.push(...(await listChildIds(cfg, eventId, childType, 'deleteEvent', fetchImpl)));
	}

	// Serial, not `Promise.all`: Entu has no bulk delete, and a serial loop is
	// what makes "how many actually went" knowable when one of them fails.
	let deleted = 0;
	for (const childId of childIds) {
		try {
			await deleteEntity(cfg, childId, 'deleteEvent child', fetchImpl);
		} catch (failure) {
			throw new EventCascadePartialError(eventId, deleted, childIds.length, failure);
		}
		deleted += 1;
	}

	// Children first, event last — a failure part-way leaves a still-linked
	// remainder rather than unreachable rows (the series cascade's ordering, one
	// level down).
	await deleteEntity(cfg, eventId, 'deleteEvent', fetchImpl);
}

/**
 * Delete an `event_series` entity AND its occurrence events — #197. See module
 * contract above for why this cascades rather than refusing.
 *
 * Resolves with HOW MANY occurrences were deleted, so the panel announces the
 * number this cascade actually destroyed rather than the one its list happened
 * to be showing (#197 review 2nd pass F2).
 */
export async function deleteEventSeries(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch = fetch
): Promise<number> {
	const occurrenceIds = await listChildIds(cfg, seriesId, 'event', 'deleteEventSeries', fetchImpl);

	let deleted = 0;
	for (const eventId of occurrenceIds) {
		try {
			await deleteEvent(cfg, eventId, fetchImpl);
		} catch (failure) {
			throw new SeriesCascadePartialError(seriesId, deleted, occurrenceIds.length, failure);
		}
		deleted += 1;
	}

	await deleteEntity(cfg, seriesId, 'deleteEventSeries', fetchImpl);
	return deleted;
}

// (*MVOX:Palestrina* — #132/T3 GREEN: season management data layer)
// (*MVOX:Palestrina* — #132/T4 GREEN: getSeriesDefaults)
// (*MVOX:Palestrina* — #197 GREEN: deleteEvent / deleteEventSeries)
// (*MVOX:Palestrina* — #197 review F1/F3: series cascade + 403 discrimination)
// (*MVOX:Palestrina* — #197 review 2nd pass F1/F2: event child cascade,
//  deleted-count return value, live occurrence count for the confirm)
