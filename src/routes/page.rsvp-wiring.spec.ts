// @vitest-environment happy-dom
//
// #12 — the data-loading half of the RSVP wiring: once the agenda resolves,
// the page must also resolve the singer's member id and existing rsvps (#10/
// #11's read primitives) so RsvpControl (once Byrd wires it into AgendaList)
// has its initial state. Not testing the click/optimistic-write path here —
// that needs the full RsvpControl-in-AgendaList chain that doesn't exist until
// GREEN; see rsvpOptimistic.spec.ts for the write-dispatch unit coverage and
// RsvpControl.spec.ts / AgendaList.spec.ts for the presentational + prop-wiring
// contracts.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (params: { minutes: number }) => `${params.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params: { weeks: number }) => `${params.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry'
	}
}));

const { loadAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } = vi.hoisted(() => ({
	loadAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadAgenda: loadAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// #12 — not yet imported by +page.svelte (that's Byrd's GREEN); mocked here so
// the assertions below observe whether the page calls them, not a live network.
vi.mock('$lib/rsvp/rsvpData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

afterEach(() => {
	cleanup();
	loadAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — resolves member id + existing rsvps alongside the agenda (#12 data half)', () => {
	it('calls findMyMemberId with {db,token} for the selected collective and the selected person id', async () => {
		loadAgendaMock.mockResolvedValue([]);
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(findMyMemberIdMock).toHaveBeenCalled();
		});
		expect(findMyMemberIdMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, 'person-p');
	});

	it('calls listMyRsvps with {db,token} for the selected collective and the selected person id', async () => {
		loadAgendaMock.mockResolvedValue([]);
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(listMyRsvpsMock).toHaveBeenCalled();
		});
		expect(listMyRsvpsMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, 'person-p');
	});
});

// (*MVOX:Tallis*)
