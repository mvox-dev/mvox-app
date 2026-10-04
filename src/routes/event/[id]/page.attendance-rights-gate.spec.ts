// @vitest-environment happy-dom
// 'Take attendance' on the event page is gated on the event's rights.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
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

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/events/eventDetail', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).eventDetailModule(importOriginal)
);
vi.mock('$lib/roster/rosterData', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).rosterOverRealModule(importOriginal)
);
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceReadsModule(importOriginal, 'both')
);
vi.mock('$lib/attendance/attendanceOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).attendanceOptimisticModule()
);
vi.mock('$lib/rsvp/rsvpData', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).rsvpViewerModule(await importOriginal())
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);

import Page from './+page.svelte';
import type { EventDetail } from '$lib/events/eventDetail';
import { applyAttendanceChangeMock } from '$lib/testing/mocks/events';
import {
	pastDetail,
	resetAttendanceMocks,
	setAuthed,
	setFixtures
} from '$lib/testing/pages/eventAttendance';
import { q } from '$lib/testing/pages/dom';

function renderPage() {
	vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	return render(Page);
}

afterEach(resetAttendanceMocks);

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
