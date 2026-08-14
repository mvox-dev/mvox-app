// src/lib/events/recurrence.ts
//
// #132/T5 — the recurrence date calculator behind the event-series bulk
// generator. PURE: no fetches, no Date.now(), no timezone CONVERSION — the
// occurrence list is fully determined by the params. CALENDAR stepping (which
// day is an occurrence) uses `Date` objects pinned at midnight, but the
// EMITTED occurrence is a formatted local datetime STRING
// (`YYYY-MM-DDTHH:MM`), built directly from the calendar day + the requested
// `timeOfDay` — never round-tripped through a `Date` constructed at that
// hour. Contract pinned by recurrence.spec.ts:
//
//   - 'daily' emits every calendar day in [from, until]; `dayOfWeek` is
//     ignored for it.
//   - 'weekly' / 'biweekly' emit the days in [from, until] whose LOCAL
//     `getDay()` is `dayOfWeek`, stepping 7 / 14 CALENDAR days from the FIRST
//     matching day >= `from` (the anchor). Calendar stepping, not
//     milliseconds: a fixed-ms step drifts the wall-clock hour across a DST
//     boundary (Europe/Tallinn falls back 2026-10-25) — the spec pins 19:00
//     staying 19:00 on both sides.
//   - Both bounds are INCLUSIVE. `from` > `until` → [].
//   - `timeOfDay` ('HH:MM') is attached to every emitted string verbatim —
//     it is never re-derived from a `Date`'s `getHours()`/`getMinutes()`.
//   - `skipDates` excludes matching calendar dates from the OUTPUT without
//     re-anchoring the cadence: skipping one biweekly occurrence leaves the
//     others on their original fortnight. A skip date that is not an
//     occurrence is a no-op.
//   - Result is sorted ascending.
//
// DST SPRING-FORWARD (#141, fixes #132/T5 review F6's known gap). The
// calendar cursor used to find occurrence DAYS is pinned at midnight, which
// Europe/Tallinn's spring-forward (03:00 -> 04:00, e.g. 2026-03-29) never
// touches, so the day-finding walk is unaffected. The bug was in how the
// FINAL value was built: `new Date(y, m, d, hours, minutes)` asks the JS
// engine to name an instant for a wall clock that does not exist on that day
// (03:00), and the engine silently normalizes it forward to 04:00 — so a
// caller reading `getHours()` back off that Date saw the wrong hour. Emitting
// `${y}-${mo}-${d}T${timeOfDay}` as a STRING instead sidesteps the local-time
// constructor entirely: there is no instant being named, so there is nothing
// for the engine to normalize. The opposite direction — the FALL-BACK, which a
// fixed-ms step would have broken across the whole tail of the series — is
// handled by the calendar stepping above and pinned by recurrence.spec.ts.

/** How the series repeats — maps to v4E `interval_days` 1 / 7 / 14. */
export type RepeatPattern = 'daily' | 'weekly' | 'biweekly';

export interface RecurrenceParams {
	repeat: RepeatPattern;
	/** JS `Date#getDay` convention: 0 = Sunday … 6 = Saturday. Ignored for 'daily'. */
	dayOfWeek: number;
	/** 'HH:MM' — attached to every generated date as LOCAL wall-clock time. */
	timeOfDay: string;
	/** ISO calendar date (YYYY-MM-DD), inclusive lower bound. */
	from: string;
	/** ISO calendar date (YYYY-MM-DD), inclusive upper bound. */
	until: string;
	/** ISO calendar dates excluded from the output (cadence unaffected). */
	skipDates: string[];
}

/** Parse an ISO calendar date (YYYY-MM-DD) into a LOCAL midnight `Date`. */
function parseIsoDate(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** `date`'s calendar day (local) as an ISO YYYY-MM-DD string — for skipDates
 *  membership and for stepping by CALENDAR days (never milliseconds, see the
 *  module doc's DST note). */
function isoOf(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** `date` stepped by `days` CALENDAR days (local), same wall-clock hour/minute
 *  reconstructed explicitly rather than left to a fixed-ms add — the DST
 *  fall-back case the spec pins. */
function addCalendarDays(date: Date, days: number): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate() + days,
		date.getHours(),
		date.getMinutes(),
		0,
		0
	);
}

/** `date`'s calendar day (local) + `timeOfDay` ('HH:MM'), formatted directly
 *  as a 'YYYY-MM-DDTHH:MM' STRING — never via a `Date` constructed at that
 *  hour. The DST spring-forward fix (#141): a wall clock that does not exist
 *  locally (03:00 on Europe/Tallinn's 2026-03-29) has no instant for the JS
 *  engine to normalize if it is never asked to construct one. */
function formatOccurrence(date: Date, timeOfDay: string): string {
	return `${isoOf(date)}T${timeOfDay}`;
}

/** The occurrence datetimes for the given recurrence, ascending, local wall
 *  clock — each a 'YYYY-MM-DDTHH:MM' string (see `formatOccurrence`). */
export function generateEventDates(params: RecurrenceParams): string[] {
	const { repeat, dayOfWeek, timeOfDay, from, until, skipDates } = params;
	const fromDate = parseIsoDate(from);
	const untilDate = parseIsoDate(until);
	if (fromDate.getTime() > untilDate.getTime()) return [];

	const skip = new Set(skipDates);
	const results: string[] = [];

	if (repeat === 'daily') {
		let cursor = fromDate;
		while (cursor.getTime() <= untilDate.getTime()) {
			const iso = isoOf(cursor);
			if (!skip.has(iso)) {
				results.push(formatOccurrence(cursor, timeOfDay));
			}
			cursor = addCalendarDays(cursor, 1);
		}
		return results;
	}

	// weekly / biweekly — find the anchor: the first day >= from matching
	// dayOfWeek, then step 7 / 14 CALENDAR days from there.
	const stepDays = repeat === 'biweekly' ? 14 : 7;
	let anchor = fromDate;
	while (anchor.getDay() !== dayOfWeek && anchor.getTime() <= untilDate.getTime()) {
		anchor = addCalendarDays(anchor, 1);
	}
	if (anchor.getDay() !== dayOfWeek || anchor.getTime() > untilDate.getTime()) return [];

	let cursor = anchor;
	while (cursor.getTime() <= untilDate.getTime()) {
		const iso = isoOf(cursor);
		if (!skip.has(iso)) {
			results.push(formatOccurrence(cursor, timeOfDay));
		}
		cursor = addCalendarDays(cursor, stepDays);
	}
	return results;
}

// (*MVOX:Tallis* — #132/T5 RED stub + contract)
// (*MVOX:Palestrina* — #132/T5 GREEN: generateEventDates)
// (*MVOX:Palestrina* — #141: string[] emission fixes DST spring-forward)
