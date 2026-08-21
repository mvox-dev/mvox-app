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

/**
 * #167 — the ADMIN's season pick, as opposed to `currentSeason`'s VIEWER pick.
 * An admin who just created a season needs to manage it NOW, whatever its
 * dates say (#167 acceptance criterion 1: "REGARDLESS of start date"):
 *
 *   1. a season is current (per `currentSeason`) and has NOT lapsed -> that
 *      exact season.
 *   2. otherwise -> the soonest NOT-YET-STARTED season, if there is one. Two
 *      cases collapse into this branch:
 *        - nothing has started at all: the future season the admin just
 *          created (the original #167 case).
 *        - the "current" season has LAPSED (a non-empty `end_date` already in
 *          the past) while a later season is waiting: a lapsed season has
 *          nothing left to manage, and pinning the admin surface to it made
 *          the just-created next season unreachable for series creation
 *          (#167 review F1). `currentSeason` deliberately ignores `end_date`
 *          for VIEWER scoping ("Fila hooaeg" — a lapsed season can still own
 *          real events), which is exactly why the ADMIN pick has to look at it
 *          separately rather than change that rule.
 *      A season with an empty `startDate` counts as not-yet-started and sorts
 *      as "infinitely far" against any real date -- last among candidates, but
 *      still a candidate.
 *   3. neither -> the lapsed current season if that is all there is (nothing
 *      better to offer, and its panel is still the only way to fix its dates),
 *      else null (no seasons at all).
 *
 * KNOWN TRADE, deliberate and pending a product ruling (#167 review round 2,
 * F4): step 2 hands the ENTIRE admin surface to the future season, so with a
 * lapsed current season plus any not-yet-started one the lapsed season becomes
 * unmanageable — no gear, no rename, no date fix, and [+ Series] (which has no
 * season picker) files under the future season. Since `end_date` is an
 * unreliable bound (the "Fila hooaeg" case above), a lapsed season CAN still own
 * events that `listFullAgenda` puts in `upcoming` — an admin may therefore see
 * live events whose season they can no longer manage. The panel exposes exactly
 * one season at a time, so this is a choice between two reachable seasons, not
 * an oversight; if it needs closing, the shape is a season SELECTOR in the
 * manage panel (seeded from the already-fetched `seasons` list), not further
 * tuning of this automatic pick.
 *
 * Never mutates its input. `currentSeason` itself keeps its viewer semantics
 * UNTOUCHED -- this is a separate, additive pick.
 */
export function manageableSeason(seasons: Season[], now: Date): Season | null {
	const nowDate = now.toISOString().slice(0, 10);
	const current = currentSeason(seasons, now);
	const lapsed = current !== null && current.endDate !== '' && current.endDate < nowDate;
	if (current && !lapsed) return current;
	const sortKey = (s: Season): string => (s.startDate === '' ? '9999-12-31' : s.startDate);
	// Not-yet-started seasons only. When nothing is current this is every
	// season there is; when the current one has lapsed it is the queue behind it.
	const soonest = seasons
		.filter((s) => s.startDate === '' || s.startDate > nowDate)
		.reduce<Season | null>((best, s) => (best === null || sortKey(s) < sortKey(best) ? s : best), null);
	return soonest ?? current;
}

// (*MVOX:Josquin*)
