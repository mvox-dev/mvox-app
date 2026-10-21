// Agenda rules for conductors, recent events and seasons: pure logic, no IO.
import type { AgendaItem } from '$lib/agenda/types';
import type { Season } from '$lib/seasons/types';
import { localDayKey } from '$lib/preferences/timeFormat';

// Mihkel 2026-08-10 (#77): no event conductors inherits; an overlap replaces; else guests add.
export function resolveConductors(seasonConductors: string[], eventConductors: string[]): string[] {
	if (eventConductors.length === 0) return [...seasonConductors];

	const hasOverlap = eventConductors.some((id) => seasonConductors.includes(id));
	if (hasOverlap) return [...eventConductors];

	return [...seasonConductors, ...eventConductors];
}

export function recentEvents(items: AgendaItem[], now: Date): AgendaItem[] {
	const nowIso = now.toISOString();
	return items
		.filter((item) => item.startDatetime < nowIso)
		.sort((a, b) => b.startDatetime.localeCompare(a.startDatetime));
}

// end_date is not read: a season past its end date can still own real events (Fila hooaeg).
export function currentSeason(seasons: Season[], now: Date): Season | null {
	const nowDate = localDayKey(now);
	const started = seasons.filter((s) => s.startDate !== '' && s.startDate <= nowDate);
	if (started.length === 0) return null;
	return started.reduce((latest, s) => (s.startDate > latest.startDate ? s : latest));
}

export function seasonNotEnded(season: Season, now: Date): boolean {
	return season.endDate === '' || season.endDate >= localDayKey(now);
}

// An admin manages the current season; once it lapses, the soonest one not yet started (#167).
export function manageableSeason(seasons: Season[], now: Date): Season | null {
	const nowDate = localDayKey(now);
	const current = currentSeason(seasons, now);
	const lapsed = current !== null && !seasonNotEnded(current, now);
	if (current && !lapsed) return current;
	const sortKey = (s: Season): string => (s.startDate === '' ? '9999-12-31' : s.startDate);
	const soonest = seasons
		.filter((s) => s.startDate === '' || s.startDate > nowDate)
		.reduce<Season | null>((best, s) => (best === null || sortKey(s) < sortKey(best) ? s : best), null);
	return soonest ?? current;
}

// (*MVOX:Josquin*)
