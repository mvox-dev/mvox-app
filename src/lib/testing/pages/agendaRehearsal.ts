// Agenda rows that are all rehearsals, for the root page header and paper specs.
import type { AgendaItem } from '$lib/agenda/types';

export function item(id: string, name: string, startDatetime: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	} as AgendaItem;
}

export const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z');

// (*MVOX:Josquin*)
