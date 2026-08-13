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

// (*MVOX:Palestrina* — #132/T3 GREEN: season management data layer)
// (*MVOX:Palestrina* — #132/T4 GREEN: getSeriesDefaults)
