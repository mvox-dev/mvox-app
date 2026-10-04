// Season manage panel variants (agenda with a conductor, owned series) its specs had word for word.
import type { Season } from '$lib/seasons/types';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { signIn } from '$lib/testing/session';
import { SEASON_END, SEASON_ID, SEASON_START, upcomingSeason } from './seasonPanel';

export function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: ['p-grace'],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

export function seriesFixture() {
	return [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0, ownerIds: ['person-p'] }
	];
}

export function agendaResult(opts: { editor?: boolean; withUpcomingSeason?: boolean } = {}) {
	const { editor = true, withUpcomingSeason = false } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: withUpcomingSeason ? [season, upcomingSeason()] : [season]
	});
}

export async function openPanel(container: HTMLElement): Promise<HTMLElement> {
	return await openSeasonCardPanel(container);
}

export function setAuthedWithOneCollective(): void {
	signIn();
}

// (*MVOX:Josquin*)
