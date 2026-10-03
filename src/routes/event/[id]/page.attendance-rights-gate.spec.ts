// @vitest-environment happy-dom
// 'Take attendance' on the event page is gated on the event's rights.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const {
	loadEventDetailMock,
	loadRosterMock,
	listAttendanceMock,
	listAllRsvpsForEventMock,
	applyAttendanceChangeMock
} = vi.hoisted(() => ({
	loadEventDetailMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	applyAttendanceChangeMock: vi.fn()
}));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/events/eventDetail', async (importActual) => ({
	...(await importActual<typeof import('$lib/events/eventDetail')>()),
	loadEventDetail: loadEventDetailMock,
	listEventLocations: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/roster/rosterData', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/rosterData')>()),
	loadRoster: loadRosterMock
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock
}));
vi.mock('$lib/attendance/attendanceOptimistic', () => ({
	applyAttendanceChange: applyAttendanceChangeMock
}));
vi.mock('$lib/rsvp/rsvpData', async (importActual) => ({
	...(await importActual<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: vi.fn().mockResolvedValue('member-viewer'),
	findMyRsvpForEvent: vi.fn().mockResolvedValue(null)
}));
vi.mock('$lib/repertoire/workRows', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));

import Page from './+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import type { EventDetail } from '$lib/events/eventDetail';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';

function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

function pastDetail(over: Partial<EventDetail> = {}): EventDetail {
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

const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

function setAuthed() {
	signIn({ collectives: [{ db: 'sampledb', name: 'sampledb', personId: 'person-p' }] });
}

function setFixtures(
	detail: EventDetail,
	existing: Array<{ attendanceId: string; memberId: string; status: string }> = []
) {
	loadEventDetailMock.mockResolvedValue(detail);
	loadRosterMock.mockResolvedValue({ items: ROSTER, total: ROSTER.length, truncated: false });
	listAttendanceMock.mockResolvedValue(existing);
	listAllRsvpsForEventMock.mockResolvedValue([]);
}

function renderPage() {
	vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	return render(Page);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

afterEach(() => {
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
});

describe('/event/[id] — the marking gate is EVENT RIGHTS, not the seat (#356)', () => {
	it('an event EDITOR with NO conductor seat sees Take attendance, opens the panel, and records', async () => {
		setFixtures(
			pastDetail({
				editorIds: ['person-p'],
				conductorIds: ['person-someone-else'],
				conductorNames: ['Sofia Someone']
			})
		);
		const { container } = renderPage();

		await waitFor(() => {
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'take-attendance-btn')!);
		await waitFor(() => {
			expect(q(container, 'attendance-panel')).not.toBeNull();
			expect(q(container, 'attendance-row-m1')).not.toBeNull();
		});

		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
				expect.objectContaining({ eventId: 'ev1', memberId: 'm1', newStatus: 'present' })
			);
		});
	});

	it('an event OWNER with no seat sees the button too — ownership subsumes editing', async () => {
		setFixtures(pastDetail({ ownerIds: ['person-p'] }));
		const { container } = renderPage();

		await waitFor(() => {
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
	});

	it('a SEAT-ONLY conductor on a record-less past event gets NO section, no button, no empty panel (#356 retires the seat as a gate)', async () => {
		setFixtures(
			pastDetail({ conductorIds: ['person-p'], conductorNames: ['Vera Viewer'] }),
			[]
		);
		const { container } = renderPage();

		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(q(container, 'event-detail-attendance')).toBeNull();
		expect(q(container, 'take-attendance-btn')).toBeNull();
		expect(q(container, 'attendance-panel')).toBeNull();
	});

	it('neither rights nor seat, records present: the tally stays (domain data) but no affordance and no panel', async () => {
		setFixtures(pastDetail(), [
			{ attendanceId: 'att-1', memberId: 'm1', status: 'present' }
		]);
		const { container } = renderPage();

		await waitFor(() => {
			expect(q(container, 'event-detail-attendance')).not.toBeNull();
		});
		expect(q(container, 'take-attendance-btn')).toBeNull();
		expect(q(container, 'attendance-panel')).toBeNull();
	});
});

// (*MVOX:Tallis*)
