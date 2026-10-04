// Roster fixtures its specs had word for word: collective ids, section trees, member rows.
import type { RosterRow } from '$lib/roster/rosterData';
import type { SectionNode } from '$lib/sections/sectionData';

export const ORG_A = 'org-a';

export const ORG_B = 'org-b';

export const ORG_EFK = '69c7f8718489bfcb0e81b065';

export const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9';

export const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';

export const EFK_ALTO = '69c7f8748489bfcb0e81b0cd';

export const EFK_BASS = '69c7f8768489bfcb0e81b163';

export const SIREEN_SOPRANO_II = '69c7f8798489bfcb0e81b207';

export function treeA(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

export function treeB(): SectionNode[] {
	return [
		{ id: 'sec-b1', name: 'Bass I', displayOrder: 1, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] },
		{ id: 'sec-b2', name: 'Bass II', displayOrder: 2, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] }
	];
}

export function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: 'bea@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

export function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B }
	];
}

export function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [EFK_SOPRANO],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

export function liveShapedTree(): SectionNode[] {
	return [
		{
			id: EFK_SOPRANO,
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			dbEntityId: ORG_EFK,
			depth: 0,
			children: []
		},
		{
			id: SIREEN_SOPRANO_II,
			name: 'Soprano II',
			displayOrder: 3,
			parentId: null,
			dbEntityId: ORG_SIREEN,
			depth: 0,
			children: []
		},
		{
			id: EFK_ALTO,
			name: 'Alto',
			displayOrder: 4,
			parentId: null,
			dbEntityId: ORG_EFK,
			depth: 0,
			children: []
		}
	];
}

export const altoSection = {
	id: 'sec-alto',
	name: 'Alto',
	displayOrder: 0,
	parentId: null,
	dbEntityId: 'db-1',
	depth: 0,
	children: []
};

export const rosterTwo: RosterRow[] = [
	{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: 'db-1' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
];

export function fixtureTree(): SectionNode[] {
	const sop1: SectionNode = {
		id: 'sec-sop1',
		name: 'Soprano 1',
		displayOrder: 1,
		parentId: 'sec-sop',
		depth: 1,
		children: []
	};
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [sop1] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] }
	];
}

// (*MVOX:Josquin*)
