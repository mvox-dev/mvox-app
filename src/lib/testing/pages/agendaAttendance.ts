// Root page attendance harness: conductor sign-in, recent-row fixtures and the mock reset.
import { cleanup } from '@testing-library/svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import {
	createAttendanceMock,
	deleteAttendanceMock,
	listAllRsvpsForEventMock,
	listAttendanceMock,
	updateAttendanceStatusMock
} from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { signIn } from '$lib/testing/session';

export function setAuthedWithOneCollective(personId = 'person-p') {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId }] });
	completionGateStore.set('complete');
}

export function agendaItem(id: string, startDatetime: string, conductors: string[] = []) {
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

export const rowSelector = (eventId: string) => `[data-testid="agenda-recent-row-${eventId}"]`;

export const panelInRow = (eventId: string) => `${rowSelector(eventId)} [data-testid="attendance-panel"]`;

export function cleanupResetAttendanceMocks(): void {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	createAttendanceMock.mockReset();
	updateAttendanceStatusMock.mockReset();
	deleteAttendanceMock.mockReset();
	resetAppState();
	resetGate();
}

// (*MVOX:Josquin*)
