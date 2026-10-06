// Role rows named off the roster, which wins: a rights value's `string` is baked at grant time.
import type { RolePerson } from '$lib/admin/roleManagement';
import type { RosterRow } from '$lib/roster/rosterData';

export function resolveNamesFromRoster(persons: RolePerson[], roster: RosterRow[]): RolePerson[] {
	if (roster.length === 0) return persons;
	const byPersonId = new Map(roster.map((r) => [r.personId, r.name]));
	return persons.map((p) => ({ ...p, name: byPersonId.get(p.id) ?? p.name }));
}

// (*MVOX:Josquin*)
