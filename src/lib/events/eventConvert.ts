// src/lib/events/eventConvert.ts
//
// #196 GREEN — standalone event → series conversion (the data layer). The
// full pinned contract lives in eventConvert.spec.ts. Short version:
//
//   1. read-event    GET  entity/{eventId}?props=name,event_type — the event's
//                    own name (string + value ids) and event_type feed the
//                    series; an event missing EITHER refuses HERE, before any
//                    write (#196 review F1 — both are v4E `required: true` on
//                    event_series, and Entu's `mandatory` enforces nothing, so
//                    this is the enforcement point).
//   2. create-series `createEventSeries` ($lib/entity/entityCreate) — the app's
//                    ONE event_series create path, called with the EVENT'S name
//                    and event_type plus the caller's recurrence fields, parented
//                    to [dbEntityId, seasonId]. Composed, never re-implemented
//                    (#196 review F1): a local copy of the create is what let a
//                    v4E-invalid `event_series` (no event_type) reach the wire.
//   3. link-event    POST entity/{eventId} — ONE new `_parent` { reference:
//                    <the new series> }. The event's existing db + season
//                    `_parent` values are NEVER touched: `listEvents` selects
//                    on `_parent.reference=<seasonId>` with no ancestor
//                    expansion, so deleting the season parent would vanish the
//                    event from the agenda (the exact opposite of #196).
//   4. delete-name   DELETE property/{id} for each of the event's OLD name
//                    values — strictly AFTER the link lands, so the displayed
//                    name falls back to the series name through the read-side
//                    inheritance merge (entuSeasons.listEvents /
//                    eventDetail.loadEventDetail) and renaming the series
//                    propagates. POST before DELETE, always: a failure part-way
//                    leaves a NAMED event, never a nameless one.
//
//   DURABLE CONSTRAINT (this is app-layer merge, not a data copy): the
//   converted event's own `name` value is DELETED, not overwritten with the
//   series name. What makes the agenda/detail still show a name is the
//   read-side `raw.name?.[0]?.string ?? series?.name?.[0]?.string` merge in
//   entuSeasons.listEvents / eventDetail.loadEventDetail — the SAME merge a
//   generated series occurrence relies on. If a future refactor of either
//   reader drops that fallback, every converted event goes blank instead of
//   inheriting the series name. This step's ordering (POST-then-DELETE) is
//   also what keeps a failed run's event NAMED — never nameless — see step 4.
//
// Any step failing throws EventConvertError naming the failed step — including
// the fetch-free 'validate' stage that runs before step 1 (#196 review F2) — so
// no rejection from this module can name a step that never ran. No silent
// success, no rollback (Entu has no transactions; the error tells the operator
// exactly where the run stopped).
//
// SCOPE: this makes the event the series' FIRST occurrence and nothing more.
// Occurrences in this app are materialized `event` entities, so the FURTHER
// occurrences the operator asked for (interval_days / end_date) are a serial
// `createEvent` loop the CALLER runs — see `submitEventConvert` in
// routes/+page.svelte, which drives it off the same `generateIntervalDates`
// cadence and the `eventType` this function hands back.

import { entuFetch } from '$lib/entu/request';
import { createEventSeries } from '$lib/entity/entityCreate';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

/** The conversion steps, in choreography order — the vocabulary every
 *  EventConvertError names its failure with.
 *
 *  #196 review F2 — 'validate' is the (fetch-free) stage BEFORE the four wire
 *  steps. It used to throw a plain `Error`, which has no `.step`, so a caller
 *  duck-typing the step off the rejection fell back to naming 'read-event' — a
 *  step that had not run — for what was really a blank form field. Every
 *  rejection this module produces now names a step that genuinely failed. */
export type EventConvertStep =
	| 'validate'
	| 'read-event'
	| 'create-series'
	| 'link-event'
	| 'delete-name';

/**
 * WHY a refusal happened, for the refusals whose STEP alone cannot say it
 * (#196 review F1). Both live in 'read-event' and both mean "this event cannot
 * become a series", which is a permanent property of the data — materially
 * different from a transient HTTP failure at the same step, and the operator
 * has to be told which: a retry fixes one and never fixes the other.
 */
export type EventConvertReason = 'missing-name' | 'missing-event-type';

/**
 * A conversion step failed. `step` names WHICH one (and appears verbatim in the
 * message — fail loud, name the step); `seriesId` carries the already-created
 * series' id for every failure AFTER create-series succeeded, so the caller can
 * tell "nothing happened" apart from "the series exists but the event is not
 * (fully) converted"; `reason` is set only for the two pre-write refusals above.
 */
export class EventConvertError extends Error {
	readonly step: EventConvertStep;
	readonly seriesId?: string;
	readonly reason?: EventConvertReason;

	constructor(
		step: EventConvertStep,
		detail: string,
		opts: { seriesId?: string; reason?: EventConvertReason; cause?: unknown } = {}
	) {
		super(`convertEventToSeries: ${step} failed — ${detail}`, { cause: opts.cause });
		this.name = 'EventConvertError';
		this.step = step;
		this.seriesId = opts.seriesId;
		this.reason = opts.reason;
	}
}

export interface ConvertEventToSeriesInput {
	/** The standalone event being converted. */
	eventId: string;
	/** The collective's DATABASE entity id (#161) — the series' required parent.
	 *  The caller already holds it (`resolveDatabaseEntityId`); never guessed. */
	dbEntityId: string;
	/** The season the event (and therefore the new series) belongs to. */
	seasonId: string;
	/** Recurrence step in days (7 = weekly) — v4E required, >= 1. */
	intervalDays: number;
	/** 'HH:MM' Tallinn wall-clock occurrence start — v4E required, non-blank. */
	startTime: string;
	/** ISO date of the FIRST occurrence (the event's own date) — v4E required. */
	startDate: string;
	/** ISO date the series runs until — v4E required, >= startDate. */
	endDate: string;
	/** Default event duration for the series — v4E required, finite, >= 1. */
	durationMinutes: number;
	// DELIBERATELY NO `name` FIELD: the series takes the EVENT'S stored name
	// (read in step 1) — the conversion path is exempt from createEvent's
	// standalone-name validation because it never creates an event at all.
}

export interface ConvertEventToSeriesResult {
	/** The freshly created `event_series` entity id. */
	seriesId: string;
	/**
	 * The converted event's OWN `event_type` (read in step 1, copied onto the
	 * series) — always non-blank: step 1 refuses an event that carries none
	 * (#196 review F1), so no caller has to handle a '' here.
	 *
	 * Handed back because the caller needs it to keep going: the conversion makes
	 * the event the series' FIRST occurrence, and every FURTHER occurrence is a
	 * `createEvent` that must carry its own `event_type` (#194/#202 — no reader
	 * inherits it from the series). Re-reading the event for it would be a second
	 * fetch for a value this function already holds.
	 */
	eventType: string;
}

type WireProp = {
	type: string;
	reference?: string;
	string?: string;
	number?: number;
	date?: string;
	datetime?: string;
};

/** One `{ type, reference }` prop. */
function ref(type: string, value: string): WireProp {
	return { type, reference: value };
}

/** Required-field hygiene for STRING-ish values, run BEFORE any fetch
 *  (entityCreate's pattern). Refusals are EventConvertError('validate', …) —
 *  see `EventConvertStep`. */
function requireText(field: string, value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new EventConvertError('validate', `${field} must not be empty`);
	return trimmed;
}

/** Required-field hygiene for NUMBERs. */
function requireNumber(field: string, value: number | undefined, min?: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new EventConvertError('validate', `${field} must be a number`);
	}
	if (min !== undefined && value < min) {
		throw new EventConvertError('validate', `${field} must be at least ${min}`);
	}
	return value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Both dates required, non-blank, range not inverted — same rule as entityCreate's requireDateRange. */
function requireDateRange(
	startField: string,
	startValue: string,
	endField: string,
	endValue: string
): { start: string; end: string } {
	const start = requireText(startField, startValue);
	const end = requireText(endField, endValue);
	if (ISO_DATE.test(start) && ISO_DATE.test(end) && end < start) {
		throw new EventConvertError('validate', `${endField} must not be before ${startField}`);
	}
	return { start, end };
}

type EventNameValue = { _id: string; string?: string };

/** The shape `GET entity/{eventId}?props=name,event_type` answers. */
interface EventReadRaw {
	entity?: {
		_id: string;
		name?: EventNameValue[];
		event_type?: Array<{ _id: string; string?: string }>;
	};
}

/**
 * Convert a standalone event into the first occurrence of a new event_series —
 * #196. See the module header for the four-step choreography and
 * eventConvert.spec.ts for the pinned wire contract.
 */
export async function convertEventToSeries(
	cfg: EntuCfg,
	input: ConvertEventToSeriesInput,
	fetchImpl: typeof fetch = fetch
): Promise<ConvertEventToSeriesResult> {
	// --- validation, BEFORE any fetch (entityCreate's pattern) ---------------
	const eventId = requireText('eventId', input.eventId);
	const dbEntityId = requireText('dbEntityId', input.dbEntityId);
	const seasonId = requireText('seasonId', input.seasonId);
	const intervalDays = requireNumber('intervalDays', input.intervalDays, 1);
	const startTime = requireText('startTime', input.startTime);
	const durationMinutes = requireNumber('durationMinutes', input.durationMinutes, 1);
	const { start: startDate, end: endDate } = requireDateRange(
		'startDate',
		input.startDate,
		'endDate',
		input.endDate
	);

	// --- step 1: read-event ---------------------------------------------------
	let nameValues: EventNameValue[];
	let eventType: string;
	try {
		const res = await entuFetch(
			cfg.db,
			`entity/${eventId}?props=name,event_type`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const body = (await res.json()) as EventReadRaw;
		nameValues = body.entity?.name ?? [];
		// Trimmed: a whitespace-only stored value is no event_type at all, and
		// `createEventSeries` would trim it to blank and reject anyway — one step
		// later, under a step name that misdescribes the problem.
		eventType = body.entity?.event_type?.[0]?.string?.trim() ?? '';
	} catch (e) {
		throw new EventConvertError('read-event', e instanceof Error ? e.message : String(e), {
			cause: e
		});
	}
	const name = nameValues[0]?.string?.trim();
	if (!name) {
		throw new EventConvertError('read-event', 'event has no name — a series with no name violates v4E', {
			reason: 'missing-name'
		});
	}
	// #196 review F1 — the SAME refusal, for the same reason. `event_series.event_type`
	// is v4E `required: true`, and this used to be waved through: the create simply
	// omitted the prop (a v4E-invalid series), the run then discovered it could not
	// write a single occurrence (`createEvent` requires an event_type) and stopped —
	// AFTER the series existed, the event was reparented and its own name deleted.
	// The event had left the standalone list, so the convert control was gone and
	// nothing in the app could finish or undo it. Refusing here, before ANY write,
	// leaves the event exactly as it was.
	if (!eventType) {
		throw new EventConvertError(
			'read-event',
			'event has no event_type — an event_series with no event_type violates v4E',
			{ reason: 'missing-event-type' }
		);
	}

	// --- step 2: create-series -------------------------------------------------
	// COMPOSED, not re-implemented (#196 review F1): `createEventSeries` is the
	// app's one event_series create path and the one place v4E's required set is
	// enforced (Entu's `mandatory` is a soft UI hint). The local copy that used to
	// live here is what let an event_type-less series onto the wire; it also
	// duplicated the `_type`-as-reference and 2xx-without-_id handling.
	let seriesId: string;
	try {
		seriesId = await createEventSeries(
			cfg,
			{
				name,
				dbEntityId,
				extraParentIds: [seasonId],
				eventType,
				intervalDays,
				startTime,
				startDate,
				endDate,
				durationMinutes
			},
			fetchImpl
		);
	} catch (e) {
		throw new EventConvertError('create-series', e instanceof Error ? e.message : String(e), {
			cause: e
		});
	}

	// --- step 3: link-event -----------------------------------------------------
	try {
		const res = await entuFetch(
			cfg.db,
			`entity/${eventId}`,
			cfg.token,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([ref('_parent', seriesId)])
			},
			fetchImpl
		);
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
	} catch (e) {
		throw new EventConvertError('link-event', e instanceof Error ? e.message : String(e), {
			seriesId,
			cause: e
		});
	}

	// --- step 4: delete-name -----------------------------------------------------
	// See the module-header "DURABLE CONSTRAINT" note: deleting the event's own
	// name value (rather than overwriting it) is what makes the read-side
	// series-name merge in entuSeasons.listEvents / eventDetail.loadEventDetail
	// take over — the SAME merge a generated series occurrence relies on.
	try {
		for (const value of nameValues) {
			const res = await entuFetch(
				cfg.db,
				`property/${value._id}`,
				cfg.token,
				{ method: 'DELETE' },
				fetchImpl
			);
			if (!res.ok) {
				throw new Error(`HTTP ${res.status} deleting property ${value._id}`);
			}
		}
	} catch (e) {
		throw new EventConvertError('delete-name', e instanceof Error ? e.message : String(e), {
			seriesId,
			cause: e
		});
	}

	return { seriesId, eventType };
}

// (*MVOX:Tallis* — #196 RED stub + contract)
// (*MVOX:Byrd* — #196 GREEN implementation)
