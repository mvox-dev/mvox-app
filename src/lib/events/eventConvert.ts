// Turns a standalone event into the first occurrence of a new event_series.

import { entuFetch } from '$lib/entu/request';
import { createEventSeries } from '$lib/entity/entityCreate';
import { type EntuCfg } from '$lib/entu/cfg';

// 'validate' runs before any fetch, so every rejection names a step that actually ran.
type EventConvertStep =
	| 'validate'
	| 'read-event'
	| 'create-series'
	| 'link-event'
	| 'delete-name';

// Pre-write refusals a retry can never fix, unlike an HTTP failure at the same step.
type EventConvertReason = 'missing-name' | 'missing-event-type';

// seriesId is set for failures after create-series, so the caller can tell "nothing happened"
// from "the series exists but the event is not fully converted".
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
	eventId: string;
	dbEntityId: string;
	seasonId: string;
	intervalDays: number;
	startTime: string;
	startDate: string;
	endDate: string;
	durationMinutes: number;
	// No name field: the series takes the event's stored name.
}

interface ConvertEventToSeriesResult {
	seriesId: string;
	// Returned because the caller creates the further occurrences, and each one needs its own
	// event_type; no reader inherits it from the series.
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

function ref(type: string, value: string): WireProp {
	return { type, reference: value };
}

function requireText(field: string, value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new EventConvertError('validate', `${field} must not be empty`);
	return trimmed;
}

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

interface EventReadRaw {
	entity?: {
		_id: string;
		event_name?: EventNameValue[];
		event_type?: Array<{ _id: string; string?: string }>;
	};
}

// Reads the event, creates the series, adds it as a new _parent (old parents stay: listEvents
// selects on the season parent), then deletes the event's name so it inherits the series'.
// No name or event_type refuses before any write; POST before DELETE never leaves it nameless.
export async function convertEventToSeries(
	cfg: EntuCfg,
	input: ConvertEventToSeriesInput,
	fetchImpl: typeof fetch = fetch
): Promise<ConvertEventToSeriesResult> {
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

	let nameValues: EventNameValue[];
	let eventType: string;
	try {
		const res = await entuFetch(
			cfg.db,
			`entity/${eventId}?props=event_name,event_type`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const body = (await res.json()) as EventReadRaw;
		nameValues = body.entity?.event_name ?? [];
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
	if (!eventType) {
		throw new EventConvertError(
			'read-event',
			'event has no event_type — an event_series with no event_type violates v4E',
			{ reason: 'missing-event-type' }
		);
	}

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
