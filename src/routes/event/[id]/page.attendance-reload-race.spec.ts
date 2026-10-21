// @vitest-environment happy-dom
// The event page drops an attendance write that settles after the page reloaded.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

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
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import {
	applyAttendanceChangeMock,
	listAllRsvpsForEventMock,
	listAttendanceMock,
	loadEventDetailMock
} from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { ROSTER, pastDetail, resetAttendanceMocks } from '$lib/testing/pages/eventAttendance';
import { q } from '$lib/testing/pages/dom';
import { setAuthed } from '$lib/testing/pages/seasonRepertoire';

afterEach(resetAttendanceMocks);

describe('/event/[id] — an attendance write that settles after a reload applies nothing', () => {
	it('a collective switch mid-write: the late save marks nobody present in the new view', async () => {
		const detail = pastDetail({ conductorIds: ['person-p'], editorIds: ['person-p'] });
		loadEventDetailMock.mockResolvedValue(detail);
		loadRosterMock.mockResolvedValue({ items: ROSTER, total: ROSTER.length, truncated: false });
		listAttendanceMock.mockResolvedValue([]);
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValue(held.promise);
		vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
		pageStub.params = { id: 'ev1' };
		pageStub.url = new URL('http://localhost/event/ev1');
		setAuthed(['sampledb', 'vox']);
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'take-attendance-btn')!);
		await waitFor(() => {
			expect(q(container, 'attendance-row-m1')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('vox');
		await waitFor(() => {
			expect(loadEventDetailMock.mock.calls.length).toBe(2);
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
		expect(q(container, 'event-detail-attendance-tally')).toBeNull();

		held.resolve({ attendanceId: 'att-new-1' });
		await new Promise((r) => setTimeout(r, 30));

		expect(q(container, 'event-detail-attendance-tally'), 'the late write landed').toBeNull();
	});
});

// (*MVOX:Josquin*)
