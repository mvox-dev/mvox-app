// src/lib/attendance/conductorStore.ts
//
// #83 TA.2 -- conductor seat determination. Pure logic only, NO IO.
//
// The issue calls this "a pure data comparison on already-loaded event/season
// data", and that is now literally true: conductor refs are fetched as part of
// the existing listSeasons/listRehearsals props (no separate reads), so the
// resolution here is a zero-request collapse of already-loaded data.
//
// A 2-state verdict ('conductor' | 'not-conductor') is the whole contract --
// no loading/error shape (unlike librarianStore's rights-read).
import { writable, type Writable } from 'svelte/store';
import type { AgendaItem } from '$lib/agenda/types';
import { resolveConductors } from './conductorLogic';

export type ConductorState = 'conductor' | 'not-conductor';

/**
 * Collapse resolveConductors' active list into the seat verdict for one
 * person on one event. Pure -- no IO.
 */
export function determineConductor(
	personId: string,
	seasonConductors: string[],
	eventConductors: string[]
): ConductorState {
	const active = resolveConductors(seasonConductors, eventConductors);
	return active.includes(personId) ? 'conductor' : 'not-conductor';
}

/**
 * Resolve which of the given recent events the person holds the conductor seat
 * on, using already-loaded conductor data from the season and event entities.
 * Pure -- no IO. Replaces the old resolveConductorEventIds which fired N+1
 * entity/{id}?props=conductor requests.
 */
export function computeConductorEventIds(
	personId: string,
	seasonConductors: string[],
	items: AgendaItem[]
): Set<string> {
	const result = new Set<string>();
	for (const item of items) {
		if (determineConductor(personId, seasonConductors, item.conductors) === 'conductor') {
			result.add(item.id);
		}
	}
	return result;
}

/**
 * Whether the signed-in person holds the conductor seat on ANY currently
 * resolved (recent) event -- a page-level summary derived from
 * computeConductorEventIds' result, published for future single-event
 * surfaces (e.g. TA.3's record-attendance view) that don't want to re-derive
 * it from the per-event Set. The per-row AgendaList gating uses the Set
 * itself (an event-level override can differ row by row); this store is the
 * coarser "is a conductor at all" signal.
 */
export const isConductor: Writable<ConductorState> = writable('not-conductor');

export function resetConductor(): void {
	isConductor.set('not-conductor');
}

// (*MVOX:Josquin*)
