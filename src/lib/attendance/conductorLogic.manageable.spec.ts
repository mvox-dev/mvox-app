// #167 RED — `manageableSeason`: the ADMIN's season pick (pure logic).
//
// The bug: after creating a season with a FUTURE start date, the agenda's
// event/series creation controls vanish. `currentSeason` (VIEWER semantics —
// the latest season already started) answers null for a future-only season
// list, and the page gates every management control on that answer — so the
// admin who just created the season cannot put a single event into it.
//
// Contract pinned here (GREEN adds the export to ./conductorLogic.ts;
// `currentSeason` itself keeps its viewer semantics UNTOUCHED — the viewer
// agenda's "Recent" scoping must not change):
//
// `manageableSeason(seasons, now)` — which season an admin manages by default:
//   1. a season is current (per `currentSeason`) → that exact season.
//   2. no season has started, but seasons EXIST → the next one to happen: the
//      season with the SMALLEST startDate (the future season the admin just
//      created and now needs to populate). A season with an empty startDate is
//      still a season — a created season is manageable REGARDLESS of its dates
//      (#167 acceptance criterion).
//   3. no seasons at all → null.
//   Never mutates its input.
import { describe, expect, it } from 'vitest';
import type { Season } from '$lib/seasons/types';
import { currentSeason, manageableSeason } from './conductorLogic';

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

	// #167 review F1 — the acceptance criterion is "regardless of start date":
	// a LAPSED season (end_date already past) is not what an admin who just
	// created the next one wants to manage. `currentSeason` ignores end_date on
	// purpose (viewer scoping); the admin pick must not.
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

// (*MVOX:Tallis*)
