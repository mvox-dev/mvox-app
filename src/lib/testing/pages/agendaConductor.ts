// Agenda row with a typed shape, shared by the attendance panel and conductor wiring specs.

export function agendaItem(
	id: string,
	startDatetime: string,
	conductors: string[] = []
): {
	id: string;
	name: string;
	startDatetime: string;
	durationMinutes: number;
	location: string;
	conductors: string[];
	owners: string[];
	editors: string[];
} {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors,
		owners: [],
		editors: []
	};
}

// (*MVOX:Josquin*)
