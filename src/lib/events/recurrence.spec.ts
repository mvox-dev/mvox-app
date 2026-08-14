// #132/T5 RED — generateEventDates, the PURE recurrence calculator behind the
// event-series bulk generator (design sketch D). No fetches, no Date.now(), no
// timezone conversion: the whole occurrence list is determined by the params.
// Calendar stepping (which DAY is an occurrence) uses `Date` objects pinned at
// midnight; the EMITTED occurrence is a 'YYYY-MM-DDTHH:MM' local datetime
// STRING, formatted directly from the day + `timeOfDay` (#141 — see
// recurrence.ts's module doc for why: a `Date` constructed AT the requested
// hour is not safe across DST spring-forward).
//
// Pinned contract (GREEN must implement — see recurrence.ts's module doc):
//   - 'daily': every calendar day in [from, until], dayOfWeek IGNORED.
//   - 'weekly'/'biweekly': the days whose LOCAL getDay() === dayOfWeek,
//     stepping 7/14 CALENDAR days from the first matching day >= from (the
//     anchor). Calendar stepping, not milliseconds — a fixed-ms step drifts
//     the wall-clock hour across a DST boundary.
//   - Bounds INCLUSIVE on both ends; from > until → [].
//   - timeOfDay 'HH:MM' attached to every emitted string VERBATIM.
//   - skipDates excludes calendar dates from the OUTPUT without re-anchoring
//     the cadence; a skip that is not an occurrence is a no-op.
//   - Result sorted ascending.
//
// Weekday facts used below (verified):
//   2026-09-01 is a TUESDAY. Mondays in [2026-09-01, 2026-12-01]:
//   Sep 7/14/21/28, Oct 5/12/19/26, Nov 2/9/16/23/30 — 13 of them.
//   Wednesdays in [2026-09-01, 2026-10-01]: Sep 2/9/16/23/30.
//   Europe/Tallinn falls back (EEST +3 → EET +2) on Sunday 2026-10-25, and
//   springs forward (EET +2 → EEST +3) on Sunday 2026-03-29 — the machine/
//   test TZ, which makes the DST cases below load-bearing.
import { describe, expect, it } from 'vitest';

import { generateEventDates, type RecurrenceParams } from './recurrence';

/** The 'YYYY-MM-DDTHH:MM' string every generated occurrence must equal —
 *  built the same way the fix requires (string formatting, no `Date`
 *  constructed at the target hour), so the test itself can't hide a
 *  DST-normalization bug. */
function atLocal(isoDay: string, hours: number, minutes: number): string {
	const h = String(hours).padStart(2, '0');
	const mi = String(minutes).padStart(2, '0');
	return `${isoDay}T${h}:${mi}`;
}

const MONDAYS_SEP_TO_DEC = [
	'2026-09-07',
	'2026-09-14',
	'2026-09-21',
	'2026-09-28',
	'2026-10-05',
	'2026-10-12',
	'2026-10-19',
	'2026-10-26',
	'2026-11-02',
	'2026-11-09',
	'2026-11-16',
	'2026-11-23',
	'2026-11-30'
];

/** Baseline params: weekly Mondays 19:00, the season-shaped range. */
function params(over: Partial<RecurrenceParams> = {}): RecurrenceParams {
	return {
		repeat: 'weekly',
		dayOfWeek: 1,
		timeOfDay: '19:00',
		from: '2026-09-01',
		until: '2026-12-01',
		skipDates: [],
		...over
	};
}

describe('generateEventDates — weekly', () => {
	it('weekly on Monday from 2026-09-01 to 2026-12-01 → exactly the 13 Mondays, ascending, each at 19:00 local (FULL list equality — partial assertions hide bugs)', () => {
		const dates = generateEventDates(params());

		expect(dates).toEqual(MONDAYS_SEP_TO_DEC.map((d) => atLocal(d, 19, 0)));
	});

	it('both bounds are INCLUSIVE: from 2026-09-07 (a Monday) to 2026-11-30 (a Monday) still yields all 13 — the endpoints are occurrences, not fenceposts', () => {
		const dates = generateEventDates(params({ from: '2026-09-07', until: '2026-11-30' }));

		expect(dates).toEqual(MONDAYS_SEP_TO_DEC.map((d) => atLocal(d, 19, 0)));
	});

	it('a single-day range that IS the target weekday yields exactly that one occurrence', () => {
		const dates = generateEventDates(params({ from: '2026-09-07', until: '2026-09-07' }));

		expect(dates).toEqual([atLocal('2026-09-07', 19, 0)]);
	});

	it('a range containing NO matching weekday yields [] (Tue 2026-09-01 .. Sun 2026-09-06, looking for a Monday)', () => {
		expect(generateEventDates(params({ until: '2026-09-06' }))).toEqual([]);
	});
});

describe('generateEventDates — biweekly', () => {
	it('biweekly on Wednesday from 2026-09-01 to 2026-10-01 → every OTHER Wednesday, anchored at the first matching day: Sep 2, 16, 30', () => {
		const dates = generateEventDates(
			params({ repeat: 'biweekly', dayOfWeek: 3, timeOfDay: '18:30', until: '2026-10-01' })
		);

		expect(dates).toEqual([
			atLocal('2026-09-02', 18, 30),
			atLocal('2026-09-16', 18, 30),
			atLocal('2026-09-30', 18, 30)
		]);
	});

	it('skipping the FIRST biweekly occurrence does NOT re-anchor the cadence: the survivors stay on their original fortnight (Sep 16, 30 — never Sep 9, 23)', () => {
		const dates = generateEventDates(
			params({
				repeat: 'biweekly',
				dayOfWeek: 3,
				timeOfDay: '18:30',
				until: '2026-10-01',
				skipDates: ['2026-09-02']
			})
		);

		expect(dates).toEqual([atLocal('2026-09-16', 18, 30), atLocal('2026-09-30', 18, 30)]);
	});
});

describe('generateEventDates — daily', () => {
	it('daily from Sept 1 to Sept 7 → 7 consecutive dates; dayOfWeek is IGNORED (3 is passed, the run still starts on a Tuesday)', () => {
		const dates = generateEventDates(
			params({ repeat: 'daily', dayOfWeek: 3, from: '2026-09-01', until: '2026-09-07' })
		);

		expect(dates).toEqual(
			[
				'2026-09-01',
				'2026-09-02',
				'2026-09-03',
				'2026-09-04',
				'2026-09-05',
				'2026-09-06',
				'2026-09-07'
			].map((d) => atLocal(d, 19, 0))
		);
	});

	it('skipDates carve days out of a daily run too', () => {
		const dates = generateEventDates(
			params({
				repeat: 'daily',
				from: '2026-09-01',
				until: '2026-09-07',
				skipDates: ['2026-09-04']
			})
		);

		expect(dates).toHaveLength(6);
		expect(dates.map((d) => Number(d.slice(8, 10)))).toEqual([1, 2, 3, 5, 6, 7]);
	});
});

describe('generateEventDates — skipDates', () => {
	it('skipDates exclude exactly the named occurrences from the weekly run (13 → 11, the two named Mondays gone, everything else untouched)', () => {
		const dates = generateEventDates(params({ skipDates: ['2026-09-14', '2026-10-05'] }));

		expect(dates).toEqual(
			MONDAYS_SEP_TO_DEC.filter((d) => d !== '2026-09-14' && d !== '2026-10-05').map((d) =>
				atLocal(d, 19, 0)
			)
		);
	});

	it('a skip date that is NOT an occurrence is a no-op (2026-09-08 is a Tuesday — the 13 Mondays all survive)', () => {
		const dates = generateEventDates(params({ skipDates: ['2026-09-08'] }));

		expect(dates).toHaveLength(13);
	});
});

describe('generateEventDates — bounds', () => {
	it('from > until → [] (never a throw, never a wrapped-around range)', () => {
		expect(generateEventDates(params({ from: '2026-12-01', until: '2026-09-01' }))).toEqual([]);
	});
});

describe('generateEventDates — the attached time', () => {
	it('timeOfDay lands as LOCAL HH:MM on EVERY generated date, verbatim', () => {
		const dates = generateEventDates(params({ timeOfDay: '08:05' }));

		expect(dates).toHaveLength(13);
		for (const d of dates) {
			expect(d.endsWith('T08:05')).toBe(true);
		}
	});

	it('generates in LOCAL time, not UTC-shifted: the first Monday IS 2026-09-07T19:00', () => {
		const [first] = generateEventDates(params());

		expect(first).toBe('2026-09-07T19:00');
	});

	it('the wall-clock hour SURVIVES the DST fall-back (Europe/Tallinn, 2026-10-25): Mondays Oct 19 / Oct 26 / Nov 2 all read 19:00 local — a fixed-ms weekly step drifts to 18:00 after the switch', () => {
		const dates = generateEventDates(params({ from: '2026-10-19', until: '2026-11-02' }));

		expect(dates).toEqual([
			atLocal('2026-10-19', 19, 0),
			atLocal('2026-10-26', 19, 0),
			atLocal('2026-11-02', 19, 0)
		]);
	});

	it('#141 — the wall-clock hour SURVIVES the DST spring-forward (Europe/Tallinn, 2026-03-29, 03:00 does not exist): a daily run through it still reads 03:00 on every day, including the skipped local hour — a `new Date(y,m,d,3,0)` construction would normalize that one day to 04:00', () => {
		const dates = generateEventDates(
			params({
				repeat: 'daily',
				timeOfDay: '03:00',
				from: '2026-03-28',
				until: '2026-03-30'
			})
		);

		expect(dates).toEqual(['2026-03-28T03:00', '2026-03-29T03:00', '2026-03-30T03:00']);
	});

	it('#141 — a WEEKLY series landing exactly on spring-forward Sunday (2026-03-29) also keeps 03:00, not 04:00', () => {
		const dates = generateEventDates(
			params({
				repeat: 'weekly',
				dayOfWeek: 0,
				timeOfDay: '03:00',
				from: '2026-03-29',
				until: '2026-03-29'
			})
		);

		expect(dates).toEqual(['2026-03-29T03:00']);
	});
});

// (*MVOX:Tallis* — #132/T5 RED: the pure recurrence calculator's contract)
// (*MVOX:Palestrina* — #141: string[] contract + DST spring-forward cases)
