// #83 TA.2 — conductor seat: pure logic (RED).
//
// Contracts pinned here (GREEN creates ./conductorLogic.ts):
//
// 1. `resolveConductors(seasonConductors, eventConductors)` — the data-driven
//    conditional merge/override from the issue spec:
//      - eventConductors empty            → seasonConductors        (inherit)
//      - non-empty, NO overlap            → union, season-first     (merge — guest conductor)
//      - non-empty, ANY overlap           → eventConductors only    (override — reassignment)
//    Person refs are opaque strings (Entu person entity ids).
//
// 2. `recentEvents(items, now)` — the agenda's 'Recent' section data: ALL past
//    events (strictly before `now` — the exact complement of listAgenda's
//    `startDatetime >= now` upcoming gate), reverse-chronological, NO limit.
//    Callers pass items already scoped to the current season.
//
// 3. `currentSeason(seasons, now)` — which season "now" belongs to: the season
//    with the LATEST startDate that is <= now. `end_date` is deliberately not
//    consulted — it is an unreliable bound (see listAgenda's "Fila hooaeg" note:
//    a season whose end_date has passed can still own real events).
import { describe, expect, it } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';
import type { Season } from '$lib/seasons/types';
import { currentSeason, recentEvents, resolveConductors } from './conductorLogic';

describe('resolveConductors — conditional merge/override (#83 AC-1)', () => {
	it('eventConductors empty → returns seasonConductors (inherit)', () => {
		expect(resolveConductors(['p-anna', 'p-bert'], [])).toEqual(['p-anna', 'p-bert']);
	});

	it('no overlap → returns the union, season conductors first (merge — guest conductor)', () => {
		expect(resolveConductors(['p-anna', 'p-bert'], ['p-carl'])).toEqual([
			'p-anna',
			'p-bert',
			'p-carl'
		]);
	});

	it('ANY overlap → returns eventConductors only (override — reassignment)', () => {
		// p-bert appears in both: the event list is a REASSIGNMENT, not a guest add —
		// p-anna (season-only) is overridden OUT for this event.
		expect(resolveConductors(['p-anna', 'p-bert'], ['p-bert', 'p-carl'])).toEqual([
			'p-bert',
			'p-carl'
		]);
	});

	it('identical lists (full overlap) → returns eventConductors', () => {
		expect(resolveConductors(['p-anna'], ['p-anna'])).toEqual(['p-anna']);
	});

	it('both empty → returns []', () => {
		expect(resolveConductors([], [])).toEqual([]);
	});

	it('seasonConductors empty, eventConductors non-empty → returns eventConductors', () => {
		expect(resolveConductors([], ['p-carl'])).toEqual(['p-carl']);
	});

	it('does not mutate its inputs', () => {
		const season = ['p-anna'];
		const event = ['p-carl'];
		resolveConductors(season, event);
		expect(season).toEqual(['p-anna']);
		expect(event).toEqual(['p-carl']);
	});
});

// ── recentEvents — the 'Recent' section's data (#83 / TA agenda surface) ────

function item(id: string, startDatetime: string): AgendaItem {
	return { id, name: `Rehearsal ${id}`, startDatetime, durationMinutes: 90, location: '', conductors: [], owners: [], editors: [] };
}

const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('recentEvents — past events of the current season, reverse-chronological, NO limit', () => {
	it('returns only events strictly before now (past), excluding upcoming ones', () => {
		const items = [
			item('past-1', '2026-06-10T18:00:00.000Z'),
			item('future-1', '2026-06-20T18:00:00.000Z')
		];
		expect(recentEvents(items, NOW).map((r) => r.id)).toEqual(['past-1']);
	});

	it('an event starting EXACTLY at now is upcoming, not recent (exact complement of the agenda’s >= gate)', () => {
		const items = [item('at-now', NOW.toISOString())];
		expect(recentEvents(items, NOW)).toEqual([]);
	});

	it('orders past events reverse-chronologically (most recent first)', () => {
		const items = [
			item('oldest', '2026-06-01T18:00:00.000Z'),
			item('newest', '2026-06-14T18:00:00.000Z'),
			item('middle', '2026-06-08T18:00:00.000Z')
		];
		expect(recentEvents(items, NOW).map((r) => r.id)).toEqual(['newest', 'middle', 'oldest']);
	});

	it('returns ALL past events — no limit/cap (25 in → 25 out)', () => {
		// May 2026 days 01..25 — every one unambiguously before NOW (June 15).
		const items = Array.from({ length: 25 }, (_, i) =>
			item(`r${i + 1}`, `2026-05-${String(i + 1).padStart(2, '0')}T18:00:00.000Z`)
		);
		expect(recentEvents(items, NOW)).toHaveLength(25);
	});

	it('returns [] for an empty list', () => {
		expect(recentEvents([], NOW)).toEqual([]);
	});
});

// ── currentSeason — which season the 'Recent' list is scoped to ─────────────

function season(id: string, startDate: string, endDate = ''): Season {
	return { id, name: `Season ${id}`, startDate, endDate, conductors: [], owners: [], editors: [] };
}

describe('currentSeason — latest season already started (end_date deliberately ignored)', () => {
	it('picks the season with the latest startDate <= now', () => {
		const seasons = [
			season('s-2024', '2024-09-01'),
			season('s-2025', '2025-09-01'),
			season('s-2027', '2027-09-01') // not started yet
		];
		expect(currentSeason(seasons, NOW)?.id).toBe('s-2025');
	});

	it('ignores end_date — a season whose end_date has passed is still current if no later season has started', () => {
		// The "Fila hooaeg" shape: end_date already past, but it still owns events.
		const seasons = [season('s-fila', '2025-09-01', '2026-05-28')];
		expect(currentSeason(seasons, NOW)?.id).toBe('s-fila');
	});

	it('returns null when every season starts in the future', () => {
		const seasons = [season('s-2027', '2027-09-01')];
		expect(currentSeason(seasons, NOW)).toBeNull();
	});

	it('returns null for an empty season list', () => {
		expect(currentSeason([], NOW)).toBeNull();
	});
});

// (*MVOX:Tallis*)
