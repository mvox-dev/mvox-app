// Root page works and repertoire fixtures: the upcoming event and resets its specs shared.
import { cleanup } from '@testing-library/svelte';
import { vi } from 'vitest';
import { resetAppState } from '$lib/testing/appReset';
import { listMyRsvpsMock, loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { signIn } from '$lib/testing/session';

export const REPERTOIRE_ITEMS = [
	{
		_id: 'ri-1',
		name: [{ string: 'Spem in alium' }],
		work: [{ reference: 'work-1' }],
		edition: [{ reference: 'ed-1' }],
		status: [{ string: 'active' }]
	},
	{
		_id: 'ri-2',
		name: [{ string: 'Old warhorse' }],
		work: [{ reference: 'work-2' }],
		status: [{ string: 'retired' }]
	}
];

export const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

export function cleanupUnstubResetAgendaRsvps(): void {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	listMyRsvpsMock.mockReset();
	resetAppState();
}

export const upcoming = [
	{
		id: 'ev-1',
		name: 'Rehearsal',
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];

export function agendaEvent(id: string, name: string) {
	return {
		id,
		name,
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

export function cleanupUnstubResetAgenda(): void {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	resetAppState();
}

export const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

export const recent = [
	{
		id: 'ev-0',
		name: 'Last rehearsal',
		startDatetime: past,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];

export function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'crede', name: 'Crede', personId: 'person-c' }
		]
	});
}

// (*MVOX:Josquin*)
