// Event page attendance harness (no page import): the setup its specs had word for word.
import { cleanup } from '@testing-library/svelte';
import { vi } from 'vitest';
import type { EventDetail } from '$lib/events/eventDetail';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import {
	applyAttendanceChangeMock,
	listAllRsvpsForEventMock,
	listAttendanceMock,
	loadEventDetailMock
} from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { discoverMock } from '$lib/testing/routeMocks';
import { signIn } from '$lib/testing/session';
import { isoAt } from './event';

export const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

export function setFixtures(
	detail: EventDetail,
	existing: Array<{ attendanceId: string; memberId: string; status: string }> = []
) {
	loadEventDetailMock.mockResolvedValue(detail);
	loadRosterMock.mockResolvedValue({ items: ROSTER, total: ROSTER.length, truncated: false });
	listAttendanceMock.mockResolvedValue(existing);
	listAllRsvpsForEventMock.mockResolvedValue([]);
}

export function pastDetail(over: Partial<EventDetail> = {}): EventDetail {
	return {
		id: 'ev1',
		name: 'Tuesday Rehearsal',
		eventType: 'rehearsal',
		startDatetime: isoAt(-1),
		durationMinutes: 90,
		location: '',
		description: '',
		conductorIds: [],
		conductorNames: [],
		capacity: null,
		ownerIds: [],
		editorIds: [],
		seasonId: 'season1',
		seasonOwnerIds: [],
		seasonEditorIds: [],
		seriesId: null,
		inheritedFields: [],
		...over
	};
}

export function setAuthed() {
	signIn({ collectives: [{ db: 'sampledb', name: 'sampledb', personId: 'person-p' }] });
}

export function resetAttendanceMocks(): void {
	cleanup();
	vi.unstubAllGlobals();
	loadEventDetailMock.mockReset();
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	applyAttendanceChangeMock.mockReset();
	discoverMock.mockReset();
	resetTypeIdCache();
	resetAppState();
}

// (*MVOX:Josquin*)
