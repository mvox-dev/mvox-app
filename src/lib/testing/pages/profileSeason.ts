// /profile season attendance harness: the season reads the card makes, and its controls.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { expect } from 'vitest';
import type { Component } from 'svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import { listMyAttendanceMock } from '$lib/testing/mocks/events';
import { listEventsMock, listSeasonsMock } from '$lib/testing/mocks/seasons';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { agendaItem } from '$lib/testing/pages/agendaSummary';
import { signIn } from '$lib/testing/session';

export const SUMMARY = '[data-testid="season-summary"]';
export const EXPAND = '[data-testid="season-summary-expand"]';

export const PAST_EVENTS = [
	agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
	agendaItem('past-2', '2026-06-03T16:00:00.000Z')
];

export function season(
	opts: { owners?: string[]; editors?: string[]; conductors?: string[] } = {}
) {
	return {
		id: 's1',
		name: 'Season',
		startDate: '2026-01-01',
		endDate: '',
		conductors: opts.conductors ?? [],
		owners: opts.owners ?? [],
		editors: opts.editors ?? []
	};
}

// A member of sampledb, two past events in the current season, one of them attended.
export function wireMemberSeason(opts: Parameters<typeof season>[0] = {}): void {
	listMyProfilesMock.mockResolvedValue([]);
	listSeasonsMock.mockResolvedValue([season(opts)]);
	listEventsMock.mockResolvedValue(PAST_EVENTS);
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyAttendanceMock.mockResolvedValue(
		toListRead([{ attendanceId: 'a1', eventId: 'past-1', status: 'present' }])
	);
}

export function renderProfile(Page: Component) {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }] });
	return render(Page);
}

export async function renderWithSummary(Page: Component) {
	const utils = renderProfile(Page);
	await waitFor(() => expect(utils.container.querySelector(SUMMARY)).not.toBeNull());
	return utils;
}

export async function renderExpanded(Page: Component, firstRow = 'member-rate-m1') {
	const utils = await renderWithSummary(Page);
	await waitFor(() => expect(utils.container.querySelector(EXPAND)).not.toBeNull());
	await fireEvent.click(utils.container.querySelector(EXPAND)!);
	await waitFor(() =>
		expect(utils.container.querySelector(`[data-testid="${firstRow}"]`)).not.toBeNull()
	);
	return utils;
}

// (*MVOX:Josquin*)
