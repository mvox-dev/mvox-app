// Season field specs' variants: the editable next season and a two-member roster.
import type { RosterRow } from '$lib/roster/rosterData';
import type { Season } from '$lib/seasons/types';
import { ORG_EFK } from './rosterFixtures';
import { isoDate, SEASON_B_ID } from './seasonPanel';

export function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-grace',
			personId: 'p-grace',
			name: 'Grace Hopper',
			email: 'grace@x.com',
			sectionIds: [],
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

export function upcomingSeason(): Season {
	return {
		id: SEASON_B_ID,
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

// (*MVOX:Josquin*)
