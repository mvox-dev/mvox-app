// src/lib/attendance/conductorLogic.ts
//
// #83 TA.2 — pure logic, no IO. Three small, independently-testable pieces:
//
// 1. `resolveConductors` — the data-driven conditional merge/override ruled by
//    Mihkel (2026-08-10, issue #77): event.conductor empty -> inherit season's;
//    non-empty with overlap -> override (event list only, a reassignment);
//    non-empty with no overlap -> merge (season list + event's guests).
//
// 2. `recentEvents` — the agenda's 'Recent' section data: ALL past events
//    (strictly before `now`, the exact complement of listFullAgenda's upcoming
//    `startDatetime >= now` gate), reverse-chronological, NO limit (Mihkel:
//    "the season is the natural boundary" — no separate cap needed since
//    callers already scope `items` to the current season).
//
// 3. `currentSeason` — which season "now" belongs to. `end_date` is
//    deliberately NOT consulted: it's an unreliable bound on a season's real
//    events (see agendaData.ts's "Fila hooaeg" note — a season whose end_date
//    has passed can still own real upcoming/recent events). The season with
//    the latest startDate that has already started is "current".
import type { AgendaItem } from '$lib/agenda/types';
import type { Season } from '$lib/seasons/types';

/**
 * The conditional merge/override from #77's conductor model. Person refs are
 * opaque strings (Entu person entity ids). Never mutates its inputs.
 */
export function resolveConductors(seasonConductors: string[], eventConductors: string[]): string[] {
	if (eventConductors.length === 0) return [...seasonConductors];

	const hasOverlap = eventConductors.some((id) => seasonConductors.includes(id));
	if (hasOverlap) return [...eventConductors];

	return [...seasonConductors, ...eventConductors];
}

/**
 * ALL past events among `items` (strictly before `now`), reverse-chronological.
 * Callers pass items already scoped to the current season — no separate limit
 * here (Mihkel: "All past events shown — no limit on recent events; the season
 * is the natural boundary").
 */
export function recentEvents(items: AgendaItem[], now: Date): AgendaItem[] {
	const nowIso = now.toISOString();
	return items
		.filter((item) => item.startDatetime < nowIso)
		.sort((a, b) => b.startDatetime.localeCompare(a.startDatetime));
}

/**
 * The season "now" belongs to: the season with the latest `startDate` that is
 * already `<= now`. `end_date` is deliberately ignored (see module doc).
 * Returns null when every season starts in the future, or the list is empty.
 */
export function currentSeason(seasons: Season[], now: Date): Season | null {
	const nowDate = now.toISOString().slice(0, 10);
	const started = seasons.filter((s) => s.startDate !== '' && s.startDate <= nowDate);
	if (started.length === 0) return null;
	return started.reduce((latest, s) => (s.startDate > latest.startDate ? s : latest));
}

// (*MVOX:Josquin*)
