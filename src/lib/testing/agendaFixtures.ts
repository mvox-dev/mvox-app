// Shared spec fixture for `loadFullAgenda`'s result shape (#167 review F4).
//
// Every page spec that mounts +page.svelte mocks `loadFullAgenda`, and each one
// hand-rolled its own object literal. When #167 added `manageableSeasonId` /
// `manageableSeasonOwners` / `manageableSeasonEditors` to the real producer,
// ~20 of those literals kept emitting the pre-#167 shape — so the page had to
// carry defaults for fields its real producer ALWAYS sets (dead code in
// production, and a silent re-entry point for the very bug #167 fixed).
//
// This builder emits the COMPLETE `FullAgendaResult`, so specs drive the page
// with a shape the producer can actually return, and the page can require the
// fields. Typed as `FullAgendaResult` (not a loose record) so a future field
// addition breaks HERE — one place — instead of in 20 literals.
//
// Review round 2, F3 — "complete" was not the same as "reachable". A caller
// that passed only `seasons: [<a lapsed season>]` got `seasonId: null` and
// `manageableSeasonId: null`, a pairing `listFullAgenda` CANNOT return: it runs
// `currentSeason` (which ignores end_date by design) and `manageableSeason`
// (which falls back to the current season when nothing later is queued) over
// that same list and answers `season-0` for both. Two specs pinned the
// controls-hidden behaviour against that impossible shape — the same
// fixture/producer divergence class as the #167 bug itself. The builder now
// runs the REAL pickers over the season list it is given, so an unpinned field
// can only hold a value the producer could actually produce.
import { currentSeason, manageableSeason } from '$lib/attendance/conductorLogic';
import type { FullAgendaResult } from '$lib/agenda/agendaData';

/**
 * A complete `FullAgendaResult`, defaulting to "nothing at all" (empty agenda,
 * no season).
 *
 * Resolution order for the season-derived fields, per field:
 *   1. the caller's explicit value, if the key is PRESENT in `overrides` (an
 *      explicit `null`/`[]` is a pin, not an absence — that is how a spec says
 *      "the viewer sees no rights here");
 *   2. otherwise, if a non-empty `seasons` list was given, whatever
 *      `listFullAgenda` would derive from it via `currentSeason` /
 *      `manageableSeason`;
 *   3. otherwise the `manageable*` fields MIRROR the viewer's season fields,
 *      which is what the producer does whenever a season is current and
 *      running — this keeps the many specs that pin `seasonId` with an empty
 *      `seasons` list (they are not about season lists at all) unchanged.
 */
export function fullAgendaResult(
	overrides: Partial<FullAgendaResult> = {},
	now: Date = new Date()
): FullAgendaResult {
	const base: FullAgendaResult = {
		upcoming: [],
		recent: [],
		seasons: [],
		seasonId: null,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: [],
		manageableSeasonId: null,
		manageableSeasonOwners: [],
		manageableSeasonEditors: []
	};
	const merged = { ...base, ...overrides };
	const pinned = <K extends keyof FullAgendaResult>(key: K): boolean =>
		Object.prototype.hasOwnProperty.call(overrides, key);

	// Exactly `listFullAgenda`'s two picks over exactly the list it was handed.
	const seasonList = merged.seasons;
	const current = seasonList.length > 0 ? currentSeason(seasonList, now) : null;
	const manageable = seasonList.length > 0 ? manageableSeason(seasonList, now) : null;

	const seasonId = pinned('seasonId') ? merged.seasonId : (current?.id ?? merged.seasonId);
	const seasonConductors = pinned('seasonConductors')
		? merged.seasonConductors
		: (current?.conductors ?? merged.seasonConductors);
	const seasonOwners = pinned('seasonOwners')
		? merged.seasonOwners
		: (current?.owners ?? merged.seasonOwners);
	const seasonEditors = pinned('seasonEditors')
		? merged.seasonEditors
		: (current?.editors ?? merged.seasonEditors);

	return {
		...merged,
		seasonId,
		seasonConductors,
		seasonOwners,
		seasonEditors,
		manageableSeasonId: pinned('manageableSeasonId')
			? merged.manageableSeasonId
			: (manageable?.id ?? seasonId),
		manageableSeasonOwners: pinned('manageableSeasonOwners')
			? merged.manageableSeasonOwners
			: (manageable?.owners ?? seasonOwners),
		manageableSeasonEditors: pinned('manageableSeasonEditors')
			? merged.manageableSeasonEditors
			: (manageable?.editors ?? seasonEditors)
	};
}

// (*MVOX:Josquin*)
