// Season repertoire specs' works, running season and queries they had word for word.
import type { Season } from '$lib/seasons/types';
import { signIn } from '$lib/testing/session';
import { isoDate } from './seasonPanel';

export type EntityRaw = Record<string, unknown>;

export const WORKS: EntityRaw[] = [
	{
		_id: 'work-1',
		name: [{ string: 'Spem in alium' }],
		composer: [{ string: 'Thomas Tallis' }]
	},
	{ _id: 'work-2', name: [{ string: 'Old warhorse' }] },
	{
		_id: 'work-3',
		name: [{ string: 'Nunc dimittis' }],
		composer: [{ string: 'Arvo Pärt' }]
	}
];

export const RI_RETIRED: EntityRaw = {
	_id: 'ri-2',
	name: [{ string: 'Old warhorse' }],
	work: [{ reference: 'work-2' }],
	status: [{ string: 'retired' }]
};

export function runningSeason(): Season {
	return {
		id: 'season-1',
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

export function q(scope: ParentNode, testid: string): HTMLElement | null {
	return scope.querySelector(`[data-testid="${testid}"]`);
}

export function qa(scope: ParentNode, testid: string): HTMLElement[] {
	return Array.from(scope.querySelectorAll(`[data-testid="${testid}"]`));
}

export function setAuthed(dbs: string[] = ['sampledb']) {
	signIn({ collectives: dbs.map((db) => ({ db, name: db, personId: 'person-p' })) });
}

// (*MVOX:Josquin*)
