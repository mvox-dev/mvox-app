// @vitest-environment happy-dom
// The season attendance card on /profile (#920): placement, gate, "All members", switch.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/profile/linkedIdentities', async () =>
	(await import('$lib/testing/mocks/profile')).noLinkedIdentitiesModule()
);
vi.mock('$lib/seasons/entuSeasons', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonReadsModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceListsOverRealModule(importOriginal)
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule({ archived: true, others: 'bare' })
);
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);

import Page from './profile/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { deferred } from '$lib/testing/entuFetchKit';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	findMyMemberIdMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { listAttendanceMock, listMyAttendanceMock } from '$lib/testing/mocks/events';
import { loadActiveAndArchivedRostersMock } from '$lib/testing/mocks/roster';
import { listEventsMock, listSeasonsMock } from '$lib/testing/mocks/seasons';
import { COLLECTIVE_A, COLLECTIVE_B, flushMicrotasks } from '$lib/testing/pages/profile';
import {
	EXPAND,
	SUMMARY,
	renderExpanded,
	renderProfile,
	renderWithSummary,
	season,
	wireMemberSeason
} from '$lib/testing/pages/profileSeason';
import { agendaItem } from '$lib/testing/pages/agendaSummary';
import { signIn } from '$lib/testing/session';

const ALICE = { memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' };
const GONE = { memberId: 'm9', personId: 'pp-9', name: 'Gone Girl', email: '', sectionIds: [] };
const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const rate = (c: HTMLElement) => q(c, '[data-testid="my-season-rate"]')?.textContent?.trim();

beforeEach(() => {
	vi.clearAllMocks();
	resolveDatabaseEntityIdMock.mockResolvedValue('db-entity-a');
	resolveManageRightsMock.mockResolvedValue('not-editor');
	loadActiveAndArchivedRostersMock.mockResolvedValue({
		active: toListRead([ALICE]),
		inactive: toListRead([GONE])
	});
	listAttendanceMock.mockImplementation((_cfg: unknown, eventId: string) =>
		Promise.resolve(
			eventId === 'past-1'
				? [
						{ attendanceId: 'x1', memberId: 'm1', status: 'present' },
						{ attendanceId: 'x2', memberId: 'm9', status: 'present' }
					]
				: [{ attendanceId: 'x3', memberId: 'm9', status: 'late' }]
		)
	);
});

afterEach(() => {
	cleanup();
	resetAppState();
	resetGate();
});

describe('#920 — the season attendance card sits right below the /profile title', () => {
	it("a member sees the card first after the h1, with the agenda's rate for the current season", async () => {
		wireMemberSeason();
		const { container } = await renderWithSummary(Page);
		const h1 = container.querySelector('h1')!;
		expect(h1.nextElementSibling?.getAttribute('data-testid')).toBe('season-summary');
		expect(rate(container)).toBe('[attendance_season_rate {"attended":1,"total":2}]');
		expect(listEventsMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'sampledb' }), 's1');
	});

	it('a member whose profile has no name yet sees no card, until the completion check passes', async () => {
		wireMemberSeason();
		const { container } = renderProfile(Page, 'incomplete');
		await waitFor(() => expect(listMyAttendanceMock).toHaveBeenCalled());
		await flushMicrotasks();
		expect(q(container, SUMMARY)).toBeNull();
		completionGateStore.set('complete');
		await waitFor(() => expect(q(container, SUMMARY)).not.toBeNull());
	});

	it('a person with no member record sees no card', async () => {
		wireMemberSeason();
		findMyMemberIdMock.mockResolvedValue(null);
		const { container } = renderProfile(Page);
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await flushMicrotasks();
		expect(listSeasonsMock).not.toHaveBeenCalled();
		expect(q(container, SUMMARY)).toBeNull();
	});

	it('no past event in the current season: no card, as on the agenda', async () => {
		wireMemberSeason();
		listEventsMock.mockResolvedValue([]);
		const { container } = renderProfile(Page);
		await waitFor(() => expect(listEventsMock).toHaveBeenCalled());
		await flushMicrotasks();
		expect(q(container, SUMMARY)).toBeNull();
	});
});

describe('#920 / #85 — the rate counts the current season\'s past events', () => {
	it('zero records still show the card: attended 0 of N', async () => {
		wireMemberSeason();
		listMyAttendanceMock.mockResolvedValue(toListRead([]));
		const { container } = await renderWithSummary(Page);
		expect(rate(container)).toBe('[attendance_season_rate {"attended":0,"total":2}]');
	});

	it('late counts, every event type counts, and other seasons stay out', async () => {
		wireMemberSeason();
		listSeasonsMock.mockResolvedValue([
			{ ...season(), id: 's-old', startDate: '2025-01-01' },
			season()
		]);
		listEventsMock.mockResolvedValue([
			{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z'), eventType: 'rehearsal' },
			{ ...agendaItem('past-2', '2026-06-03T16:00:00.000Z'), eventType: 'concert' },
			{ ...agendaItem('next-1', '2099-06-03T16:00:00.000Z'), eventType: 'concert' }
		]);
		listMyAttendanceMock.mockResolvedValue(
			toListRead([
				{ attendanceId: 'a1', eventId: 'past-1', status: 'late' },
				{ attendanceId: 'a2', eventId: 'past-2', status: 'present' },
				{ attendanceId: 'a3', eventId: 'old-1', status: 'present' }
			])
		);
		const { container } = await renderWithSummary(Page);
		expect(rate(container)).toBe('[attendance_season_rate {"attended":2,"total":2}]');
		expect(listEventsMock).toHaveBeenCalledTimes(1);
		expect(listEventsMock).toHaveBeenCalledWith(expect.anything(), 's1');
	});
});

describe('#920 / #365 — "All members" opens on season rights, as it did on the agenda', () => {
	it('a season OWNER gets the button, and the comparison opens on click', async () => {
		wireMemberSeason({ owners: ['person-p'] });
		const { container } = await renderExpanded(Page);
		expect(q(container, '[data-testid="member-rate-m1"]')?.textContent).toContain(
			'[attendance_member_rate {"attended":1,"total":2}]'
		);
	});

	it('a season EDITOR gets the button', async () => {
		wireMemberSeason({ editors: ['person-p'] });
		const { container } = await renderWithSummary(Page);
		expect(q(container, EXPAND)).not.toBeNull();
	});

	it('a member with neither grant gets no button', async () => {
		wireMemberSeason({ owners: ['someone-else'], editors: ['other-person'] });
		const { container } = await renderWithSummary(Page);
		expect(q(container, EXPAND)).toBeNull();
		expect(resolveManageRightsMock).not.toHaveBeenCalled();
	});

	it('the conductor seat does not count: a conductor with no grant gets no button', async () => {
		wireMemberSeason({ owners: ['someone-else'], conductors: ['person-p'] });
		const { container } = await renderWithSummary(Page);
		expect(q(container, EXPAND)).toBeNull();
	});

	it("a season whose grants are hidden borrows the database entity's editor right", async () => {
		wireMemberSeason();
		resolveManageRightsMock.mockResolvedValue('editor');
		const { container } = await renderWithSummary(Page);
		expect(q(container, EXPAND)).not.toBeNull();
		expect(resolveManageRightsMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'sampledb' }),
			'db-entity-a',
			'person-p'
		);
	});
});

describe('#920 / #255 — the expanded list keeps deactivated members and states a short read', () => {
	it('her row renders marked inactive with the attended count and no rate', async () => {
		wireMemberSeason({ owners: ['person-p'] });
		const { container } = await renderExpanded(Page);
		const text = q(container, '[data-testid="member-rate-inactive-m9"]')?.textContent ?? '';
		expect(text).toContain('Gone Girl');
		expect(text).toContain('[attendance_member_count_inactive {"attended":2}]');
		expect(text).not.toContain('[attendance_member_rate ');
	});

	it('a failed member read shows the load error, not a roster-only list', async () => {
		wireMemberSeason({ owners: ['person-p'] });
		loadActiveAndArchivedRostersMock.mockRejectedValue(new Error('boom'));
		const { container } = await renderWithSummary(Page);
		await fireEvent.click(q(container, EXPAND)!);
		await waitFor(() => expect(q(container, '[data-testid="season-rates-error"]')).not.toBeNull());
		expect(q(container, '[data-testid="member-rate-m1"]')).toBeNull();
	});

	it('a truncated archived read raises the notice once; complete reads raise none', async () => {
		wireMemberSeason({ owners: ['person-p'] });
		loadActiveAndArchivedRostersMock.mockResolvedValue({
			active: toListRead([ALICE]),
			inactive: { items: [GONE], total: 812, truncated: true }
		});
		const NOTICE = '[data-testid="season-summary-partial-notice"]';
		const { container } = await renderExpanded(Page);
		expect(container.querySelectorAll(NOTICE).length).toBe(1);
		cleanup();
		loadActiveAndArchivedRostersMock.mockResolvedValue({
			active: toListRead([ALICE]),
			inactive: toListRead([GONE])
		});
		const complete = await renderExpanded(Page);
		expect(q(complete.container, NOTICE)).toBeNull();
	});
});

describe('#920 — the card follows the selected collective', () => {
	function wirePerCollective(heldA?: Promise<unknown>) {
		wireMemberSeason();
		listMyAttendanceMock.mockImplementation(async (cfg: { db: string }) => {
			if (cfg.db === 'bravura') return toListRead([]);
			if (heldA) await heldA;
			return toListRead([{ attendanceId: 'a1', eventId: 'past-1', status: 'present' }]);
		});
	}

	it("switching shows the new collective's rate", async () => {
		wirePerCollective();
		signIn({ collectives: [COLLECTIVE_A, COLLECTIVE_B], selected: 'sampledb' });
		completionGateStore.set('complete');
		const { container } = render(Page);
		await waitFor(() => expect(rate(container)).toContain('"attended":1'));
		selectedCollectiveDbStore.set('bravura');
		await waitFor(() => expect(rate(container)).toContain('"attended":0'));
	});

	it("a read for the collective left behind never lands on the new one's card", async () => {
		const held = deferred<void>();
		wirePerCollective(held.promise);
		signIn({ collectives: [COLLECTIVE_A, COLLECTIVE_B], selected: 'sampledb' });
		completionGateStore.set('complete');
		const { container } = render(Page);
		await waitFor(() => expect(listMyAttendanceMock).toHaveBeenCalledTimes(1));
		selectedCollectiveDbStore.set('bravura');
		await waitFor(() => expect(rate(container)).toContain('"attended":0'));
		held.resolve();
		await flushMicrotasks();
		expect(rate(container)).toContain('"attended":0');
	});
});

// (*MVOX:Josquin*)
