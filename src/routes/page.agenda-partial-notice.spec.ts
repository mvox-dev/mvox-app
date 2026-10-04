// @vitest-environment happy-dom
// The agenda notices for a truncated RSVP or attendance lifetime read.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
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
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
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
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/mocks/events')).attendanceHandlesModule({ lists: false, writes: false, mine: 'handle' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { listMyAttendanceMock } from '$lib/testing/mocks/events';
import { cleanupClearReset, q } from '$lib/testing/pages/dom';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { DB_A, DB_B, complete, truncated } from '$lib/testing/pages/agenda';

interface Read<T> {
	items: T[];
	total: number;
	truncated: boolean;
}
type RsvpRead = Read<{ rsvpId: string; eventId: string; status: string }>;
type AttendanceRead = Read<{ attendanceId: string; eventId: string; status: string }>;

function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: DB_A, name: 'Sampledb', personId: 'person-p' }, { db: DB_B, name: 'Other Choir', personId: 'person-q' }] });
}

function emptyAgenda() {
	return fullAgendaResult({
		seasons: [],
		upcoming: [],
		recent: [],
		seasonId: null,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: []
	});
}

afterEach(cleanupClearReset);

describe('#321 — the agenda states when the singer’s own answer/attendance set is partial', () => {
	it('a truncated listMyRsvps read renders rsvp-partial-notice (visible, role=status, i18n copy)', async () => {
		loadFullAgendaMock.mockResolvedValue(emptyAgenda());
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyAttendanceMock.mockResolvedValue(complete([]));
		listMyRsvpsMock.mockResolvedValue(
			truncated([{ rsvpId: 'rsvp-1', eventId: 'event-1', status: 'going' }], 503)
		);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
		});
		const el = q(container, 'rsvp-partial-notice')!;
		expect(el.getAttribute('role')).toBe('status');
		expect(el.className).not.toMatch(/sr-only|hidden/);
		expect(el.getAttribute('aria-hidden')).not.toBe('true');
		expect(el.textContent).toContain('rsvp_partial_notice');
	});

	it('a truncated listMyAttendance read renders attendance-partial-notice', async () => {
		loadFullAgendaMock.mockResolvedValue(emptyAgenda());
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(complete([]));
		listMyAttendanceMock.mockResolvedValue(
			truncated([{ attendanceId: 'att-1', eventId: 'event-1', status: 'present' }], 520)
		);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'attendance-partial-notice')).not.toBeNull();
		});
		const el = q(container, 'attendance-partial-notice')!;
		expect(el.getAttribute('role')).toBe('status');
		expect(el.className).not.toMatch(/sr-only|hidden/);
		expect(el.textContent).toContain('attendance_partial_notice');
	});

	it('with both reads COMPLETE neither notice is in the DOM', async () => {
		loadFullAgendaMock.mockResolvedValue(emptyAgenda());
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(complete([{ rsvpId: 'rsvp-1', eventId: 'event-1', status: 'going' }]));
		listMyAttendanceMock.mockResolvedValue(complete([]));
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => {
			expect(listMyRsvpsMock).toHaveBeenCalled();
			expect(listMyAttendanceMock).toHaveBeenCalled();
		});
		expect(q(container, 'rsvp-partial-notice')).toBeNull();
		expect(q(container, 'attendance-partial-notice')).toBeNull();
	});

	it('neither truncation fact leaks across a collective switch: A truncated on both reads → switch to B → both notices gone while B is still loading', async () => {
		const bRsvp = deferred<RsvpRead>();
		const bAttendance = deferred<AttendanceRead>();
		loadFullAgendaMock.mockResolvedValue(emptyAgenda());
		findMyMemberIdMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === DB_A ? 'member-a' : 'member-b')
		);
		listMyRsvpsMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === DB_A
				? Promise.resolve(truncated([{ rsvpId: 'rsvp-a', eventId: 'event-a', status: 'going' }], 503))
				: bRsvp.promise
		);
		listMyAttendanceMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === DB_A
				? Promise.resolve(truncated([{ attendanceId: 'att-a', eventId: 'event-a', status: 'present' }], 520))
				: bAttendance.promise
		);
		setAuthedWithTwoCollectives();

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
			expect(q(container, 'attendance-partial-notice')).not.toBeNull();
		});

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => {
			const select = q(container, 'selected-collective') as HTMLSelectElement | null;
			expect(select?.value).toBe(DB_B);
			expect(select?.selectedOptions[0]?.text.trim()).toBe('Other Choir');
			expect(listMyRsvpsMock).toHaveBeenCalledWith(expect.objectContaining({ db: DB_B }), 'person-q');
		});
		expect(q(container, 'rsvp-partial-notice')).toBeNull();
		expect(q(container, 'attendance-partial-notice')).toBeNull();

		bRsvp.resolve(complete([{ rsvpId: 'rsvp-b', eventId: 'event-b', status: 'going' }]));
		bAttendance.resolve(complete([]));
		await bRsvp.promise;
		await bAttendance.promise;
		await waitFor(() => {
			expect(q(container, 'rsvp-partial-notice')).toBeNull();
			expect(q(container, 'attendance-partial-notice')).toBeNull();
		});
	});
});

// (*MVOX:Tallis*)
