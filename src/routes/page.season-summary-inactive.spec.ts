// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
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
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule({ archived: true, others: 'bare' })
);
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceListsOverRealModule(importOriginal)
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import {
	listAllRsvpsForEventMock,
	listAttendanceMock,
	listMyAttendanceMock
} from '$lib/testing/mocks/events';
import { loadActiveAndArchivedRostersMock, loadRosterMock } from '$lib/testing/mocks/roster';
import { agendaItem, cleanupClearResetGate } from '$lib/testing/pages/agendaSummary';
import { setAuthedWithOneCollective } from '$lib/testing/pages/agendaAttendance';

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [
				agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
				agendaItem('past-2', '2026-06-03T16:00:00.000Z')
			],
			seasonId: 's1',
			seasonConductors: [],
			seasonOwners: ['person-p'],
			seasonEditors: []
		})
	);
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(toListRead([]));
	listAllRsvpsForEventMock.mockResolvedValue([]);
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
	]));
	loadActiveAndArchivedRostersMock.mockResolvedValue({
		active: toListRead([
			{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
		]),
		inactive: toListRead([
			{ memberId: 'm9', personId: 'pp-9', name: 'Gone Girl', email: '', sectionIds: ['sec-alto'] }
		])
	});
	listAttendanceMock.mockImplementation((_cfg: unknown, eventId: string) => {
		if (eventId === 'past-1') {
			return Promise.resolve([
				{ attendanceId: 'a1', memberId: 'm1', status: 'present' },
				{ attendanceId: 'a2', memberId: 'm9', status: 'present' }
			]);
		}
		return Promise.resolve([{ attendanceId: 'a3', memberId: 'm9', status: 'late' }]);
	});
});

afterEach(cleanupClearResetGate);

async function renderExpandedSummary() {
	const utils = render(Page);
	setAuthedWithOneCollective();
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull()
	);
	await fireEvent.click(utils.container.querySelector('[data-testid="season-summary-expand"]')!);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull()
	);
	return utils;
}

describe('season summary — a deactivated member keeps her rows (done-when 3, in-slice)', () => {
	it('the expanded view unions active AND inactive members: her row renders, marked inactive, with the attended COUNT', async () => {
		const { container } = await renderExpandedSummary();
		const row = container.querySelector('[data-testid="member-rate-inactive-m9"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain('Gone Girl');
		expect(row?.textContent).toContain('2'); // present@past-1 + late@past-2
	});

	it('her row shows NO rate — no attendance_member_rate message, no total, no percent (there is no honest denominator)', async () => {
		const { container } = await renderExpandedSummary();
		const row = container.querySelector('[data-testid="member-rate-inactive-m9"]');
		const text = row?.textContent ?? '';
		expect(text).not.toContain('[attendance_member_rate ');
		expect(text).not.toContain('%');
		expect(text).not.toContain('total');
	});

	it('the active member is untouched: full rate row with attended AND total over ALL season events', async () => {
		const { container } = await renderExpandedSummary();
		const row = container.querySelector('[data-testid="member-rate-m1"]');
		expect(row?.textContent).toContain('[attendance_member_rate {"attended":1,"total":2}]');
	});

	it('the membership read failing does not silently drop her: the surface reports the load error instead of rendering a roster-only list as if complete', async () => {
		loadActiveAndArchivedRostersMock.mockRejectedValue(new Error('boom'));
		const utils = render(Page);
		setAuthedWithOneCollective();
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull()
		);
		await fireEvent.click(utils.container.querySelector('[data-testid="season-summary-expand"]')!);
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="season-rates-error"]')).not.toBeNull()
		);
		expect(utils.container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});
});

describe('season summary — the rate table states a truncated member read (#321 review F2)', () => {
	const NOTICE = '[data-testid="season-summary-partial-notice"]';

	it('a truncated ARCHIVED read raises the same notice — the history half drops singers too', async () => {
		loadActiveAndArchivedRostersMock.mockResolvedValue({
			active: toListRead([
				{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
			]),
			inactive: {
				items: [
					{ memberId: 'm9', personId: 'pp-9', name: 'Gone Girl', email: '', sectionIds: [] }
				],
				total: 812,
				truncated: true
			}
		});
		const { container } = await renderExpandedSummary();

		await waitFor(() => expect(container.querySelector(NOTICE)).not.toBeNull());
		expect(container.querySelectorAll(NOTICE).length).toBe(1);
	});

	it('with both reads complete the notice is ABSENT from the DOM (not hidden — absent)', async () => {
		const { container } = await renderExpandedSummary();
		expect(container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull();

		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
