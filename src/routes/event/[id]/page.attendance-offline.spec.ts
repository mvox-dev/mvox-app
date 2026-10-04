// @vitest-environment happy-dom
// Attendance marking on the event page is gated while offline.
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
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	isWriteDisabled
} from '$lib/testing/networkSignal';
import type { EventDetail } from '$lib/events/eventDetail';
import { applyAttendanceChangeMock } from '$lib/testing/mocks/events';
import { REASON } from '$lib/testing/pages/event';
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

afterEach(() => {
	resetOnLine();
});

async function openPanelAsEditor() {
	await goOnline();
	applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
	setFixtures(pastDetail({ editorIds: ['person-p'] }));
	const rendered = renderPage();
	const { container } = rendered;
	await waitFor(() => {
		expect(q(container, 'take-attendance-btn')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'take-attendance-btn')!);
	await waitFor(() => {
		expect(q(container, 'attendance-row-m1')).not.toBeNull();
	});
	return { container, fetchStub: globalThis.fetch as unknown as ReturnType<typeof vi.fn> };
}

function toggles(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid^="attendance-toggle-"]'));
}

describe('/event/[id] — attendance while offline (#434 slice 6)', () => {
	it('offline: every toggle is write-disabled and the reason is visible in the panel', async () => {
		const { container } = await openPanelAsEditor();
		await goOffline();

		await waitFor(() => {
			expect(toggles(container).length).toBeGreaterThan(0);
			for (const t of toggles(container)) expect(isWriteDisabled(t), t.dataset.testid).toBe(true);
		});
		expectVisibleReason(q(container, 'attendance-panel')!, 'attendance-write-unavailable', REASON);
	});

	it('offline: a toggle click dispatches no write and issues no fetch', async () => {
		const { container, fetchStub } = await openPanelAsEditor();
		await goOffline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await settle();

		expect(applyAttendanceChangeMock).not.toHaveBeenCalled();
		expect(fetchStub.mock.calls.length).toBe(callsBefore);
	});

	it('back online: toggles enabled, the reason gone, and a click records', async () => {
		const { container } = await openPanelAsEditor();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			for (const t of toggles(container)) expect(isWriteDisabled(t), t.dataset.testid).toBe(false);
		});
		expect(q(container, 'attendance-write-unavailable')).toBeNull();
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
				expect.objectContaining({ eventId: 'ev1', memberId: 'm1', newStatus: 'present' })
			);
		});
	});
});

// (*MVOX:Tallis*)
