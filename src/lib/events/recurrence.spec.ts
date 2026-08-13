// #132/T5 RED — generateEventDates, the PURE recurrence calculator behind the
// event-series bulk generator (design sketch D). No fetches, no Date.now(), no
// timezone conversion: the whole occurrence list is determined by the params,
// and every generated Date is a LOCAL wall-clock construction.
//
// Pinned contract (GREEN must implement — see recurrence.ts's module doc):
//   - 'daily': every calendar day in [from, until], dayOfWeek IGNORED.
//   - 'weekly'/'biweekly': the days whose LOCAL getDay() === dayOfWeek,
//     stepping 7/14 CALENDAR days from the first matching day >= from (the
//     anchor). Calendar stepping, not milliseconds — a fixed-ms step drifts
//     the wall-clock hour across a DST boundary.
//   - Bounds INCLUSIVE on both ends; from > until → [].
//   - timeOfDay 'HH:MM' attached as LOCAL hours/minutes (seconds/ms zero).
//   - skipDates excludes calendar dates from the OUTPUT without re-anchoring
//     the cadence; a skip that is not an occurrence is a no-op.
//   - Result sorted ascending.
//
// Weekday facts used below (verified):
//   2026-09-01 is a TUESDAY. Mondays in [2026-09-01, 2026-12-01]:
//   Sep 7/14/21/28, Oct 5/12/19/26, Nov 2/9/16/23/30 — 13 of them.
//   Wednesdays in [2026-09-01, 2026-10-01]: Sep 2/9/16/23/30.
//   Europe/Tallinn falls back (EEST +3 → EET +2) on Sunday 2026-10-25 —
//   the machine/test TZ, which makes the DST cases below load-bearing.
import { describe, expect, it } from 'vitest';

import { generateEventDates, type RecurrenceParams } from './recurrence';

/** A LOCAL wall-clock Date for an ISO calendar day + time — the shape every
 *  generated occurrence must equal (new Date(y, m, d, h, mi) is DST-correct
 *  in whatever TZ the test runs under, so these expectations are TZ-agnostic). */
function atLocal(isoDay: string, hours: number, minutes: number): Date {
	const [y, m, d] = isoDay.split('-').map(Number);
	return new Date(y, m - 1, d, hours, minutes, 0, 0);
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
		expect(dates.map((d) => d.getDate())).toEqual([1, 2, 3, 5, 6, 7]);
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
	it('timeOfDay lands as LOCAL hours/minutes on EVERY generated date, seconds and ms zero', () => {
		const dates = generateEventDates(params({ timeOfDay: '08:05' }));

		expect(dates).toHaveLength(13);
		for (const d of dates) {
			expect(d.getHours()).toBe(8);
			expect(d.getMinutes()).toBe(5);
			expect(d.getSeconds()).toBe(0);
			expect(d.getMilliseconds()).toBe(0);
		}
	});

	it('generates in LOCAL time, not UTC-shifted: the first Monday IS new Date(2026, 8, 7, 19, 0) — a Date.UTC / "…T19:00Z" construction fails this in any non-UTC TZ (this suite runs in Europe/Tallinn)', () => {
		const [first] = generateEventDates(params());

		expect(first.getTime()).toBe(new Date(2026, 8, 7, 19, 0, 0, 0).getTime());
	});

	it('the wall-clock hour SURVIVES the DST fall-back (Europe/Tallinn, 2026-10-25): Mondays Oct 19 / Oct 26 / Nov 2 all read 19:00 local — a fixed-ms weekly step drifts to 18:00 after the switch', () => {
		const dates = generateEventDates(params({ from: '2026-10-19', until: '2026-11-02' }));

		expect(dates).toEqual([
			atLocal('2026-10-19', 19, 0),
			atLocal('2026-10-26', 19, 0),
			atLocal('2026-11-02', 19, 0)
		]);
		for (const d of dates) {
			expect(d.getHours()).toBe(19);
		}
	});
});

// (*MVOX:Tallis* — #132/T5 RED: the pure recurrence calculator's contract)
