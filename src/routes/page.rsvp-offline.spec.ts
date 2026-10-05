// @vitest-environment happy-dom
// The agenda row's RSVP is gated while offline.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);
vi.mock('$lib/rsvp/rsvpOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).rsvpOptimisticModule()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare', byMember: 'records' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { goOffline, goOnline, resetOnLine, expectVisibleReason } from '$lib/testing/networkSignal';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { applyRsvpChangeMock } from '$lib/testing/mocks/events';
import { E1, RIGHTS_URL, SELF_EDITOR, agendaWith, cleanupResetRsvpMocks, setAuthed, stubWire, waitForRow } from '$lib/testing/pages/agendaRsvp';
import { REASON } from '$lib/testing/pages/event';

afterEach(cleanupResetRsvpMocks);

afterEach(() => {
	resetOnLine();
});

async function renderWritableRow() {
	loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
	findMyMemberIdMock.mockResolvedValue('member-1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	applyRsvpChangeMock.mockResolvedValue(undefined);
	const fetchStub = stubWire({ [RIGHTS_URL]: { body: SELF_EDITOR } });
	setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);
	await goOnline();

	const { container } = render(Page);
	const r = await waitForRow(container, 'e1');
	await waitFor(() => {
		const btn = r.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.disabled).toBe(false);
	});
	return { container, row: r, fetchStub };
}

describe('+page (agenda) — RSVP while offline (#434 slice 6)', () => {
	it('offline: the row’s four buttons are disabled and the reason is visible inside its control', async () => {
		const { row: r } = await renderWritableRow();
		await goOffline();

		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				const btn = r.querySelector(`[data-testid="rsvp-btn-${status}"]`) as HTMLButtonElement;
				expect(btn.disabled, `rsvp-btn-${status}`).toBe(true);
			}
		});
		const control = r.querySelector('[data-testid="rsvp-control"]') as HTMLElement;
		expectVisibleReason(control, 'rsvp-write-unavailable', REASON);
	});

	it('back online: enabled again, and a click dispatches the write', async () => {
		const { row: r } = await renderWritableRow();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			const btn = r.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(btn.disabled).toBe(false);
		});
		await fireEvent.click(r.querySelector('[data-testid="rsvp-btn-going"]') as HTMLElement);
		await waitFor(() => expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1));
	});
});

// (*MVOX:Tallis*)
