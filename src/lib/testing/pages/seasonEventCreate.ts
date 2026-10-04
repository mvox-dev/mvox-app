// Event create specs' variants: an editable season, a one-member roster and a timer flush.
import type { RosterRow } from '$lib/roster/rosterData';
import type { Season } from '$lib/seasons/types';
import { ORG_EFK } from './rosterFixtures';
import { isoDate, SEASON_ID } from './seasonPanel';

export function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

export function fixtureRows(): RosterRow[] {
	return [
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

export function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

// (*MVOX:Josquin*)
