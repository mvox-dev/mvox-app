// manageableSeason: the season an admin manages by default. The current one, else the season
// with the smallest startDate (dates or not), else null. currentSeason keeps viewer semantics.
import { afterEach, describe, expect, it } from 'vitest';
import type { Season } from '$lib/seasons/types';
import { currentSeason, manageableSeason, seasonNotEnded } from './conductorLogic';
import { resetDeviceClock, setDeviceClock, TALLINN_SUMMER_NIGHT } from '$lib/testing/deviceClock';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function season(id: string, startDate: string, endDate = ''): Season {
	return { id, name: `Season ${id}`, startDate, endDate, conductors: [], owners: [], editors: [] };
}

describe('manageableSeason — the admin equivalent of currentSeason (#167)', () => {
	it('a current season exists → returns exactly what currentSeason returns', () => {
		const seasons = [season('s-2024', '2024-09-01'), season('s-2025', '2025-09-01')];
		expect(manageableSeason(seasons, NOW)).toEqual(currentSeason(seasons, NOW));
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-2025');
	});

	it('a current season exists alongside FUTURE seasons → still the current one (managing defaults to now)', () => {
		const seasons = [
			season('s-2025', '2025-09-01'),
			season('s-2027', '2027-09-01') // not started
		];
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-2025');
	});

	it('NO season has started, ONE future season → returns it (the #167 case: just-created future season)', () => {
		const seasons = [season('s-future', '2026-09-01')];
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-future');
	});

	it('NO season has started, SEVERAL future seasons → the soonest-starting one', () => {
		const seasons = [
			season('s-2028', '2028-09-01'),
			season('s-2026', '2026-09-01'),
			season('s-2027', '2027-09-01')
		];
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-2026');
	});

	it('a season with an EMPTY startDate is still manageable when it is all there is', () => {
		// currentSeason skips ''-dated seasons (never current); the admin surface
		// must not — a created season is manageable regardless of its dates.
		const seasons = [season('s-undated', '')];
		expect(currentSeason(seasons, NOW)).toBeNull();
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-undated');
	});

	it('no seasons at all → null', () => {
		expect(manageableSeason([], NOW)).toBeNull();
	});

	// currentSeason ignores end_date on purpose (viewer scoping); the admin pick must not.
	it('the current season has LAPSED and a future one exists → the future one (the just-created season is reachable)', () => {
		const seasons = [
			season('s-lapsed', '2025-09-01', '2026-06-01'), // ended before NOW
			season('s-next', '2027-09-01')
		];
		expect(currentSeason(seasons, NOW)?.id).toBe('s-lapsed'); // viewer pick unchanged
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-next');
	});

	it('the current season has lapsed and SEVERAL future ones exist → the soonest of them', () => {
		const seasons = [
			season('s-lapsed', '2025-09-01', '2026-06-01'),
			season('s-2028', '2028-09-01'),
			season('s-2027', '2027-09-01')
		];
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-2027');
	});

	it('the current season has lapsed and NOTHING follows it → still that season (nothing better to offer)', () => {
		const seasons = [season('s-lapsed', '2025-09-01', '2026-06-01')];
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-lapsed');
	});

	it('an end_date of TODAY is not lapsed → the current season stays the pick', () => {
		const seasons = [
			season('s-ending-today', '2025-09-01', '2026-06-15'),
			season('s-next', '2027-09-01')
		];
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-ending-today');
	});

	it('an EMPTY end_date never lapses → the current season stays the pick', () => {
		const seasons = [season('s-open-ended', '2025-09-01', ''), season('s-next', '2027-09-01')];
		expect(manageableSeason(seasons, NOW)?.id).toBe('s-open-ended');
	});

	it('does not mutate its input', () => {
		const seasons = [season('s-b', '2027-09-01'), season('s-a', '2026-09-01')];
		manageableSeason(seasons, NOW);
		expect(seasons.map((s) => s.id)).toEqual(['s-b', 's-a']);
	});
});

// 01:30 on 2026-10-21 in Tallinn: UTC still says the 20th, the device says the 21st.
describe("a season's days follow the device's date", () => {
	afterEach(resetDeviceClock);
	const night = new Date(TALLINN_SUMMER_NIGHT);

	it('a season starting today is current from local midnight', () => {
		setDeviceClock(TALLINN_SUMMER_NIGHT);
		expect(currentSeason([season('s-new', '2026-10-21')], night)?.id).toBe('s-new');
	});

	it.each([
		['ended yesterday: lapsed, the next season is managed', '2026-10-20', 's-next'],
		['ends today, its last day: still managed', '2026-10-21', 's-now']
	])('a current season that %s', (_case, endDate, managed) => {
		setDeviceClock(TALLINN_SUMMER_NIGHT);
		const seasons = [season('s-now', '2026-09-01', endDate), season('s-next', '2026-11-01')];
		expect(manageableSeason(seasons, night)?.id).toBe(managed);
	});

	it.each([
		['2026-10-20', false],
		['2026-10-21', true],
		['', true]
	])('seasonNotEnded with end date "%s" is %s', (endDate, open) => {
		setDeviceClock(TALLINN_SUMMER_NIGHT);
		expect(seasonNotEnded(season('s', '2026-09-01', endDate), night)).toBe(open);
	});
});

// (*MVOX:Tallis*)
