// src/lib/entity/entityCreate.ts
//
// #132/T1 — the shared entity CREATE write layer for event management:
// `createSeason`, `createEventSeries`, `createEvent`.
//
// CONTRACT (pinned by entityCreate.spec.ts):
//
//   - Each function issues EXACTLY TWO fetches: the resolveTypeId GET (cached
//     per db:typeName — see $lib/seasons/entuSeasons) and ONE `POST entity`
//     (the COLLECTION endpoint, never entity/{id} — that would append props
//     onto an EXISTING entity).
//   - `_type` sent as a resolved REFERENCE via resolveTypeId(cfg, <typeName>)
//     (#10 pinned wire-shape — never `{ string: '<typeName>' }`).
//   - `_parent` = `[dbEntityId, ...extraParentIds]`, ONE `{ type: '_parent',
//     reference }` prop PER id, zero lookup fetches — the caller (agenda /
//     season management, #132 T2/T4/T6) already holds the collective's
//     database entity id (`resolveDatabaseEntityId`, #161) and the season /
//     series ids. The data layer must not guess.
//
//     THE COLLECTIVE PARENT IS STRUCTURAL, NOT ONE ENTRY IN A LIST (#132 review
//     F4): v4E marks that `parentCard: '1'` parent `required: true` on season AND
//     event_series AND event (v4E still spells the parent entity `organization`;
//     since #161 the app materialises it as the collective's DATABASE entity —
//     #159 deleted every organization instance). A flat `parentIds: string[]`
//     made it forgettable — every call site had to REMEMBER to prepend it, and a
//     season-or-series-only list still type-checked and still POSTed. So it is
//     its own REQUIRED field (`dbEntityId`) and the create builds `_parent` from
//     it; the remaining (optional, 0..N) v4E parents — season, section, series —
//     ride in `extraParentIds`, verbatim and in order, deduped against it.
//
//     MULTI-PARENT IS STILL THE POINT (#132 review F3): v4E parents an event
//     under its collective AND (optionally) its season AND (optionally) its
//     series — and `listRehearsals` selects by `_parent.reference=<seasonId>`,
//     which matches an entity's OWN `_parent` values with NO ancestor
//     expansion. A series-parented event that carries only the series id is
//     therefore invisible on the agenda; one that carries only the season id
//     inherits nothing from its series. So a series occurrence sends BOTH.
//
//     …AND THE SERIES PARENT IS NAMED TOO (#132 review F2): `createEvent` takes
//     `seriesId` as its own field for the same reason the collective parent got
//     promoted — it is the ONE parent whose presence changes validation (it is
//     what makes a blank `name` legal, see below), and a series id riding in
//     `extraParentIds` anonymously is invisible to that check. The module must
//     never sniff a parent's kind — that costs the lookup fetch this contract
//     forbids. The season / section ids stay in `extraParentIds`; `_parent` is
//     built as `[dbEntityId, seriesId?, ...extraParentIds]`, deduped, one prop
//     per id.
//
//   - CRITICAL DESIGN DECISION (#132, settled with Mihkel 2026-08-13): the
//     create body carries NO `_sharing` and NO inherit-rights flag — ONLY
//     `_type` + `_parent` + domain props. Rights and visibility are TRUSTED to
//     Entu's rights-inheritance chain from the collective's DATABASE entity
//     (#161) — the inherit flag defaults true and propagates collective →
//     season → event_series → event. This is a DELIBERATE DEVIATION from every
//     existing create in the app (createSection sends `_sharing: 'public'`
//     explicitly — that one is a v4E-pinned per-type policy, not the pattern
//     here). Subsumes #122.
//     NOTE (implementers): the inherit-rights literal itself must NEVER
//     appear in this module, not even in a comment — the T4.4 sole-create-path
//     guard (soleCreatePath.spec.ts) scans every non-spec src/ file for it as
//     the proxy for "this file sets it in a create payload", and this module
//     is the one create site that BY DESIGN never does.
//
//   - Field-typed wire values (same table as eventFieldEdit.ts):
//     start_date / end_date → `{ date }`, start_datetime → `{ datetime }`,
//     duration_minutes / capacity / interval_days → `{ number }`, conductor →
//     `{ reference }` (one prop entry PER ref), everything else → `{ string }`.
//
//   - REQUIRED MEANS REQUIRED — validated BEFORE any fetch, so a malformed
//     entity is never created and the caller gets a message naming the field
//     (createSection's pattern). Entu's `mandatory` is a soft UI hint that
//     rejects nothing server-side, so this module is the ONLY enforcement
//     point. The required set is v4E's, verbatim (#132 review F1/F2/F3):
//       season       — name, start_date, end_date (+ the collective parent)
//       event_series — name, event_type, interval_days, start_time,
//                      duration_minutes, start_date, end_date (+ collective parent)
//       event        — start_datetime, event_type (+ collective parent), plus `name`
//                      whenever there is NO `seriesId` to inherit it from
//     `end_date` before `start_date` is rejected too (an empty or inverted
//     range makes the T2 occurrence generator produce nothing), and
//     `interval_days` must be >= 1 (0 or negative never terminates).
//
//     v4E DEVIATIONS, both DELIBERATE and both STRICTER than the schema:
//       * `event.event_type` is v4E-optional ('inherited from
//         series.event_type if not set') but REQUIRED here: `listRehearsals`
//         filters on the event's OWN `event_type.string`, and Entu's query
//         layer does no series lookup, so an inherited-only event_type is
//         invisible to the agenda read.
//       * `event.name` is v4E-optional-and-inheritable, but only WITH a series
//         to inherit from — see below.
//
//   - Optional STRING params absent OR blank/whitespace-only → the prop is
//     OMITTED from the body entirely (#132 review F2). `!== undefined` is not
//     enough: the T4/T5 inline forms bind their text inputs to `$state('')`, so
//     an untouched optional field arrives as `''`, and the read-side merges
//     (entuSeasons.listRehearsals, eventDetail.loadEventDetail) use `??`, under
//     which an own `''` is a PRESENT value that SHADOWS the series default.
//     Normalizing here means no call site has to remember. That leaves exactly
//     three inheritable optionals — `event.name`, `event.location`,
//     `event.description` (from series `name` / `default_location` /
//     `default_description`) — plus the two series defaults themselves and the
//     non-inherited `conductor` / `capacity`.
//     Optional NUMBER params are normalized the same way: only a FINITE number
//     is sent, so `0` survives while `undefined` / `null` / `NaN` drop the prop
//     (#132 review F1 — a blank `<input type="number">` hands the form `null` or
//     `NaN`, both of which type-check as `number`, and `JSON.stringify` turns
//     `NaN` into `{"number":null}`: junk stored, or a create rejected on a form
//     the viewer filled in completely).
//   - `event.name` blank/absent → OMITTED rather than rejected ONLY WHEN
//     `seriesId` is set: v4E says 'inherited from series.name if not set' and
//     BOTH readers implement that inheritance, so a generated occurrence tracks
//     its series' name instead of freezing a copy of it. A STANDALONE event
//     (T4's 'No series' option) has nothing to inherit from — `listRehearsals`
//     would map it to `''` and render a blank agenda row whose detail link has
//     no accessible name — so there `name` is REQUIRED (#132 review F2).
//     `start_datetime` gets NO such treatment either — it has
//     no read-side inheritance anywhere (listRehearsals reads
//     `raw.start_datetime?.[0]?.datetime ?? ''`, eventDetail the same), so a
//     dropped blank would create a dateless event that renders as a blank-time
//     agenda row and sorts to the TOP of the season, silently (#132 review F1).
//   - Resolves to the NEW entity's `_id` from the create response.
//   - Non-2xx create POST throws with the status surfaced; a 2xx WITHOUT
//     `_id` throws (the apparent-success trap); a resolveTypeId failure
//     propagates and NO create POST is issued.

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

export type { EntuCfg };

export interface CreateSeasonInput {
	/** Season name (v4E required, non-blank). */
	name: string;
	/**
	 * #161 (collective = database) — the collective's DATABASE entity id, the
	 * v4E `parentCard: '1'` REQUIRED parent, sent as the first `_parent`
	 * `{ reference }`. Non-blank. The caller already holds it
	 * (`resolveDatabaseEntityId`) — this module never looks it up or guesses it.
	 */
	dbEntityId: string;
	/**
	 * Further parent ids beyond the collective (v4E season has none besides it
	 * today — present for symmetry and forward compatibility). One `_parent`
	 * prop per entry, verbatim, in order, deduped against `dbEntityId`.
	 */
	extraParentIds?: string[];
	/** ISO date (YYYY-MM-DD) — `start_date` `{ date }`. v4E required, non-blank. */
	startDate: string;
	/** ISO date (YYYY-MM-DD) — `end_date` `{ date }`. v4E required, non-blank, >= startDate. */
	endDate: string;
	/** Person entity ids — one `conductor` `{ reference }` prop per entry. */
	conductorRefs?: string[];
}

export interface CreateEventSeriesInput {
	/** Series name (v4E required, non-blank) — the defaults-template name events inherit. */
	name: string;
	/**
	 * #161 (collective = database) — the collective's DATABASE entity id, the
	 * v4E `parentCard: '1'` REQUIRED parent, sent as the first `_parent`
	 * `{ reference }`. Non-blank. The caller already holds it
	 * (`resolveDatabaseEntityId`) — this module never looks it up or guesses it.
	 */
	dbEntityId: string;
	/**
	 * The optional v4E parents — normally `[seasonId]`, optionally a section.
	 * One `_parent` prop per entry, verbatim, in order, deduped against `dbEntityId`.
	 */
	extraParentIds?: string[];
	/** Discriminator events inherit — `event_type` `{ string }`. v4E required, non-blank. */
	eventType: string;
	/** Recurrence step in days (7 = weekly) — `interval_days` `{ number }`. v4E required, >= 1. */
	intervalDays: number;
	/** 'HH:MM' occurrence start — `start_time` `{ string }`. v4E required, non-blank. */
	startTime: string;
	/** Default event duration — `duration_minutes` `{ number }`. v4E required, finite. */
	durationMinutes: number;
	/** ISO date of the FIRST occurrence — `start_date` `{ date }`. v4E required, non-blank. */
	startDate: string;
	/** ISO date of the LAST occurrence — `end_date` `{ date }`. v4E required, non-blank, >= startDate. */
	endDate: string;
	/** Default location — `default_location` `{ string }`; blank/omit → not sent (v4E optional). */
	defaultLocation?: string;
	/**
	 * Default description — `default_description` `{ string }`; blank/omit → not
	 * sent (v4E optional). NOT `description`: v4E gives event_series
	 * `default_location` + `default_description` only, and eventDetail reads
	 * exactly those two names.
	 */
	defaultDescription?: string;
}

export interface CreateEventInput {
	/**
	 * Event name — OPTIONAL ONLY WITH A SERIES PARENT ('inherited from
	 * series.name if not set', v4E). With `seriesId` set, blank/omit → the prop
	 * is not sent and the event tracks its series' name, so renaming the series
	 * propagates (a frozen per-occurrence copy would defeat exactly the
	 * inheritance the generator relies on). WITHOUT a series there is nothing to
	 * inherit from, so a blank name is REJECTED instead of creating a permanently
	 * nameless event (#132 review F2).
	 */
	name?: string;
	/**
	 * #161 (collective = database) — the collective's DATABASE entity id, the
	 * v4E `parentCard: '1'` REQUIRED parent, sent as the first `_parent`
	 * `{ reference }`. Non-blank. The caller already holds it
	 * (`resolveDatabaseEntityId`) — this module never looks it up or guesses it.
	 */
	dbEntityId: string;
	/**
	 * The `event_series` parent, when this event is a series occurrence — sent as
	 * a `_parent` `{ reference }` right after the collective. ITS OWN FIELD, not one
	 * anonymous entry in `extraParentIds` (#132 review F2), because it is the
	 * ONE parent whose presence changes validation: the read-side inheritance
	 * merge follows it, so it is what makes a blank `name` legal. A series id
	 * buried in a flat list would be invisible to that check — and this module
	 * must never sniff a parent's kind (that would cost a lookup fetch the
	 * contract forbids). Blank/omit → a STANDALONE event (T4's 'No series'
	 * option), which must carry its own name.
	 */
	seriesId?: string;
	/**
	 * The remaining optional v4E parents, verbatim (the caller picked) —
	 * normally `[seasonId]`, optionally a section. The season parent is what
	 * `listRehearsals` selects on (`_parent.reference=<seasonId>`, no ancestor
	 * expansion), so a series occurrence sends its season HERE and its series in
	 * `seriesId`; both end up as `_parent` props. One `_parent` prop per entry,
	 * in order, deduped against `dbEntityId` and `seriesId`.
	 */
	extraParentIds?: string[];
	/**
	 * Discriminator (rehearsal, concert, …) — `event_type` `{ string }`, required
	 * and non-blank HERE though v4E calls it inheritable: `listRehearsals`
	 * filters on the event's OWN `event_type.string`, so this one genuinely
	 * cannot be inherited.
	 */
	eventType: string;
	/**
	 * ISO datetime — `start_datetime` `{ datetime }`. v4E required, non-blank,
	 * and NOT inheritable by any reader — a dateless event is a blank-time
	 * agenda row that sorts to the top of the season (#132 review F1).
	 */
	startDatetime: string;
	/** `duration_minutes` `{ number }`; omit → not sent (inherited from series). */
	durationMinutes?: number;
	/** `location` `{ string }`; blank/omit → not sent (inherited from series). */
	location?: string;
	/** `description` `{ string }`; blank/omit → not sent (inherited from series). */
	description?: string;
	/** Person entity ids — one `conductor` `{ reference }` prop per entry. */
	conductorRefs?: string[];
	/** `capacity` `{ number }`; omit → not sent. */
	capacity?: number;
}

/** One wire-shaped entity CREATE property. Same shapes as eventFieldEdit.ts. */
type WireProp = {
	type: string;
	reference?: string;
	string?: string;
	number?: number;
	date?: string;
	datetime?: string;
};

/** One `{ type, reference }` prop per id — `_parent`/`_type`/`conductor`. */
function ref(type: string, value: string): WireProp {
	return { type, reference: value };
}

/**
 * An optional STRING-ish prop, normalized: trimmed, and DROPPED when blank.
 * See the "Optional STRING params" clause of the module contract — an own `''`
 * shadows the series default in the read-side `??` merge, and the T4/T5 forms
 * hand us `''` for every untouched field.
 */
function optional(type: string, value: string | undefined): WireProp[] {
	const trimmed = value?.trim();
	return trimmed ? [{ type, string: trimmed }] : [];
}

/**
 * An optional NUMBER prop, normalized the same way `optional()` normalizes
 * strings: sent only when it is a FINITE number, so `0` (a real value) survives
 * while `undefined`, `null` and `NaN` all drop the prop.
 *
 * Non-finite is not a theoretical case: a `<input type="number">` yields `null`
 * when the viewer leaves it blank and `Number('')` is `NaN`, both of which
 * type-check as `number` at the call site — and `JSON.stringify({ number: NaN })`
 * serialises to `{"number":null}`, so an un-guarded pass-through POSTs a
 * null-valued numeric property (stored as junk, or the create is rejected and a
 * fully-filled form reports a save failure). A null `duration_minutes` would
 * additionally enter the read-side `??` inheritance merge as a present own value.
 * Normalizing HERE means no call site has to remember (#132 review F1).
 */
function optionalNumber(type: string, value: number | undefined): WireProp[] {
	return typeof value === 'number' && Number.isFinite(value) ? [{ type, number: value }] : [];
}

/** One `conductor` `{ reference }` prop PER ref, in the given order. */
function conductorProps(refs: string[] | undefined): WireProp[] {
	return (refs ?? []).map((r) => ref('conductor', r));
}

/**
 * Required-field hygiene for STRING-ish values, run BEFORE any fetch so a
 * malformed entity is never created and the caller gets a message naming what's
 * wrong (createSection's pattern). Entu's `mandatory` is a soft UI hint that
 * rejects nothing, so this is the only enforcement point.
 */
function requireText(fn: string, field: string, value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		throw new Error(`${fn}: ${field} must not be empty`);
	}
	return trimmed;
}

/** Required-field hygiene for NUMBERs — a `<input type="number">` bound to `$state('')` arrives NaN. */
function requireNumber(fn: string, field: string, value: number | undefined, min?: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${fn}: ${field} must be a number`);
	}
	if (min !== undefined && value < min) {
		throw new Error(`${fn}: ${field} must be at least ${min}`);
	}
	return value;
}

/** ISO calendar date, the shape v4E `date` props carry and the read side sorts on. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Both dates required and non-blank, and the range not inverted — an end before
 * the start yields a season nothing falls inside and a series the T2 occurrence
 * generator emits zero events for. Ordering is only checked when BOTH are ISO
 * calendar dates (lexicographic compare is exact there); a non-ISO value is
 * passed through rather than rejected on a format this module never pinned.
 */
function requireDateRange(
	fn: string,
	startField: string,
	startValue: string,
	endField: string,
	endValue: string
): { start: string; end: string } {
	const start = requireText(fn, startField, startValue);
	const end = requireText(fn, endField, endValue);
	if (ISO_DATE.test(start) && ISO_DATE.test(end) && end < start) {
		throw new Error(`${fn}: ${endField} must not be before ${startField}`);
	}
	return { start, end };
}

/**
 * The `_parent` id list: the REQUIRED collective (database entity) first (v4E
 * parentCard '1'), then the remaining parents verbatim in the order given,
 * blanks dropped and no id repeated (the collective included — a caller may
 * pass it through again, and createEvent feeds its named `seriesId` in ahead of
 * the free-form extras).
 */
function parentIdsFor(
	fn: string,
	dbEntityId: string,
	extraParentIds: Array<string | undefined> | undefined
): string[] {
	const primary = requireText(fn, 'dbEntityId', dbEntityId);
	const seen = new Set<string>([primary]);
	const ids = [primary];
	for (const raw of extraParentIds ?? []) {
		const id = raw?.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

/**
 * Resolve the type, POST the create body to the COLLECTION `entity` endpoint,
 * and guard the response for `_id` (the apparent-success trap). Shared by all
 * three creates — see module contract above.
 */
async function postCreate(
	cfg: EntuCfg,
	typeName: string,
	parentIds: string[],
	domainProps: WireProp[],
	fetchImpl: typeof fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, typeName, fetchImpl);

	const props: WireProp[] = [
		ref('_type', typeId),
		...parentIds.map((id) => ref('_parent', id)),
		...domainProps
	];

	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(props)
		},
		fetchImpl
	);
	if (!res.ok) {
		throw new Error(`entityCreate: create '${typeName}' failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as { _id?: string };
	if (!body._id) {
		throw new Error(
			`entityCreate: create '${typeName}' returned 2xx without _id (apparent-success trap)`
		);
	}
	return body._id;
}

/**
 * Create a `season` entity under the given collective (database entity, #161).
 * Resolves to the new season's entity id. See module contract above.
 */
export async function createSeason(
	cfg: EntuCfg,
	input: CreateSeasonInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createSeason';
	const name = requireText(fn, 'name', input.name);
	const { start, end } = requireDateRange(fn, 'startDate', input.startDate, 'endDate', input.endDate);
	const parentIds = parentIdsFor(fn, input.dbEntityId, input.extraParentIds);

	const props: WireProp[] = [
		{ type: 'name', string: name },
		{ type: 'start_date', date: start },
		{ type: 'end_date', date: end },
		...conductorProps(input.conductorRefs)
	];
	return postCreate(cfg, 'season', parentIds, props, fetchImpl);
}

/**
 * Create an `event_series` entity (defaults template) under its collective
 * (database entity, #161) and season. Resolves to the new series' entity id.
 * See module contract above.
 */
export async function createEventSeries(
	cfg: EntuCfg,
	input: CreateEventSeriesInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createEventSeries';
	const name = requireText(fn, 'name', input.name);
	const eventType = requireText(fn, 'eventType', input.eventType);
	const startTime = requireText(fn, 'startTime', input.startTime);
	const intervalDays = requireNumber(fn, 'intervalDays', input.intervalDays, 1);
	const durationMinutes = requireNumber(fn, 'durationMinutes', input.durationMinutes, 1);
	const { start, end } = requireDateRange(fn, 'startDate', input.startDate, 'endDate', input.endDate);
	const parentIds = parentIdsFor(fn, input.dbEntityId, input.extraParentIds);

	const props: WireProp[] = [
		{ type: 'name', string: name },
		{ type: 'event_type', string: eventType },
		{ type: 'interval_days', number: intervalDays },
		{ type: 'start_time', string: startTime },
		{ type: 'start_date', date: start },
		{ type: 'end_date', date: end },
		{ type: 'duration_minutes', number: durationMinutes },
		...optional('default_location', input.defaultLocation),
		...optional('default_description', input.defaultDescription)
	];
	return postCreate(cfg, 'event_series', parentIds, props, fetchImpl);
}

/**
 * Create an `event` entity under its collective (database entity, #161) and
 * (optionally) its season and series. Resolves to the new event's entity id.
 * See module contract above.
 */
export async function createEvent(
	cfg: EntuCfg,
	input: CreateEventInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createEvent';
	const eventType = requireText(fn, 'eventType', input.eventType);
	const startDatetime = requireText(fn, 'startDatetime', input.startDatetime);
	const seriesId = input.seriesId?.trim();
	// name is inheritable ONLY from a series — with no series parent there is
	// nothing to inherit from, so a blank name is rejected rather than creating a
	// permanently nameless event (#132 review F2).
	const name = seriesId ? input.name : requireText(fn, 'name', input.name);
	const parentIds = parentIdsFor(fn, input.dbEntityId, [seriesId, ...(input.extraParentIds ?? [])]);

	const props: WireProp[] = [
		// With a series parent, blank/absent means "track the series", not "".
		...optional('name', name),
		{ type: 'event_type', string: eventType },
		{ type: 'start_datetime', datetime: startDatetime },
		...optionalNumber('duration_minutes', input.durationMinutes),
		...optional('location', input.location),
		...optional('description', input.description),
		...conductorProps(input.conductorRefs),
		...optionalNumber('capacity', input.capacity)
	];
	return postCreate(cfg, 'event', parentIds, props, fetchImpl);
}

// (*MVOX:Tallis* — #132/T1 RED stubs + contract)
// (*MVOX:Palestrina* — GREEN implementation + review-fix pass, #132/T1)
