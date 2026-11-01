// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
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
vi.mock('$lib/rsvp/rsvpOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).rsvpOptimisticModule()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/mocks/events')).attendanceHandlesModule({ lists: true, writes: false, mine: 'empty' })
);
vi.mock('$lib/attendance/attendanceOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).attendanceOptimisticModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './agenda/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import {
	applyAttendanceChangeMock,
	applyRsvpChangeMock,
	listAllRsvpsForEventMock,
	listAttendanceMock
} from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { cleanupClearResetGate } from '$lib/testing/pages/agendaSummary';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';

function agendaItem(id: string, startDatetime: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

const ROSTER = [
	{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

function setWorld() {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [agendaItem('e1', '2099-06-15T09:00:00.000Z')],
			recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z')],
			seasonId: 's1',
			seasonConductors: ['person-p'],
			seasonOwners: [],
			seasonEditors: []
		})
	);
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other', name: 'Other', personId: 'person-p' }
		]
	});
	completionGateStore.set('complete');
}

function q(container: HTMLElement, selector: string): HTMLElement | null {
	return container.querySelector(selector);
}

function rsvpButton(container: HTMLElement, status: string): HTMLButtonElement | null {
	return q(container, `[data-testid="agenda-row-e1"] [data-testid="rsvp-btn-${status}"]`) as
		| HTMLButtonElement
		| null;
}

async function switchCollective(): Promise<void> {
	const callsBefore = loadFullAgendaMock.mock.calls.length;
	selectedCollectiveDbStore.set('other');
	await waitFor(() => {
		expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(callsBefore);
		expect(rsvpButton(document.body, 'going')).not.toBeNull();
	});
}

async function openPanel(container: HTMLElement): Promise<void> {
	const button = '[data-testid="agenda-recent-row-past-1"] [data-testid="take-attendance-btn"]';
	await waitFor(() => {
		expect(q(container, button)).not.toBeNull();
	});
	await fireEvent.click(q(container, button)!);
	await waitFor(() => {
		expect(q(container, '[data-testid="attendance-row-m1"]')).not.toBeNull();
	});
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(cleanupClearResetGate);
useKeptProblems();

// This world leaves the agenda's background reads unmocked; those reports are not under test.
const keptWrites = async (identity?: { db: string; personId: string }) =>
	(await keptProblems(identity)).filter((p) => p.action.startsWith('saving'));
const SAMPLEDB = { db: 'sampledb', personId: 'person-p' };

describe('#554 — agenda RSVP: a write settling after a collective switch changes nothing', () => {
	it('a stale success leaves the new collective’s answer and saved cue alone, and pending clears', async () => {
		setWorld();
		const held = deferred<{ rsvpId: string }>();
		applyRsvpChangeMock.mockReturnValue(held.promise);
		const { container } = render(Page);
		await waitFor(() => {
			expect(rsvpButton(container, 'going')?.disabled).toBe(false);
		});
		await fireEvent.click(rsvpButton(container, 'going')!);

		await switchCollective();
		held.resolve({ rsvpId: 'rsvp-a' });
		await settle();

		expect(rsvpButton(container, 'going')?.getAttribute('aria-pressed')).toBe('false');
		const saved = q(container, '[data-testid="agenda-row-e1"] [data-testid="rsvp-saved-status"]');
		expect(saved?.textContent?.trim() ?? '').toBe('');
		expect(rsvpButton(container, 'going')?.disabled).toBe(false);
	});

	it('a stale failure adds no failure to the new collective, pending clears, and it is reported under its own collective', async () => {
		setWorld();
		const held = deferred<{ rsvpId: string }>();
		applyRsvpChangeMock.mockReturnValue(held.promise);
		const { container } = render(Page);
		await waitFor(() => {
			expect(rsvpButton(container, 'going')?.disabled).toBe(false);
		});
		await fireEvent.click(rsvpButton(container, 'going')!);

		await switchCollective();
		held.reject(new Error('save failed'));
		await settle();

		const failed = q(container, '[data-testid="agenda-row-e1"] [data-testid="rsvp-save-failed"]');
		expect(failed).toBeNull();
		expect(rsvpButton(container, 'going')?.disabled).toBe(false);
		await vi.waitFor(async () =>
			expect(await keptWrites(SAMPLEDB)).toEqual([
				{ area: 'agenda', action: 'saving an answer', detail: 'Error: save failed' }
			])
		);
		expect(await keptWrites()).toEqual([]);
	});
});

describe('#554 — agenda attendance: a write settling after a collective switch changes nothing', () => {
	it('a stale failure adds no failure to the new collective’s panel, pending clears, and it is reported under its own collective', async () => {
		setWorld();
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValue(held.promise);
		const { container } = render(Page);
		await openPanel(container);
		await fireEvent.click(q(container, '[data-testid="attendance-toggle-m2-present"]')!);

		await switchCollective();
		await openPanel(container);
		held.reject(new Error('save failed'));
		await settle();

		expect(q(container, '[data-testid="attendance-save-failed-m2"]')).toBeNull();
		const toggle = q(container, '[data-testid="attendance-toggle-m2-present"]') as HTMLButtonElement;
		expect(toggle.getAttribute('aria-disabled')).not.toBe('true');
		await vi.waitFor(async () =>
			expect(await keptWrites(SAMPLEDB)).toEqual([
				{ area: 'agenda', action: 'saving attendance', detail: 'Error: save failed' }
			])
		);
		expect(await keptWrites()).toEqual([]);
	});

	it('a stale success leaves the new collective’s own attendance alone', async () => {
		setWorld();
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValue(held.promise);
		const { container } = render(Page);
		await openPanel(container);
		await fireEvent.click(q(container, '[data-testid="attendance-toggle-m1-present"]')!);

		await switchCollective();
		held.resolve({ attendanceId: 'att-a' });
		await settle();

		expect(q(container, '[data-testid="attendance-badge-past-1"]')?.getAttribute('data-status')).toBe(
			'not-recorded'
		);
	});
});

describe('#1049 — an agenda RSVP or attendance failure that shows sends one report', () => {
	it('a failed answer shows its message and keeps one report with the error', async () => {
		setWorld();
		applyRsvpChangeMock.mockRejectedValue(new Error('HTTP 500'));
		const { container } = render(Page);
		await waitFor(() => {
			expect(rsvpButton(container, 'going')?.disabled).toBe(false);
		});
		await fireEvent.click(rsvpButton(container, 'going')!);

		await waitFor(() => {
			expect(q(container, '[data-testid="agenda-row-e1"] [data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		await vi.waitFor(async () =>
			expect(await keptWrites()).toEqual([
				{ area: 'agenda', action: 'saving an answer', detail: 'Error: HTTP 500' }
			])
		);
	});

	it('an answer refused for an expired session sends no report', async () => {
		setWorld();
		applyRsvpChangeMock.mockRejectedValue(new AuthExpiredError());
		const { container } = render(Page);
		await waitFor(() => {
			expect(rsvpButton(container, 'going')?.disabled).toBe(false);
		});
		await fireEvent.click(rsvpButton(container, 'going')!);
		await waitFor(() => {
			expect(rsvpButton(container, 'going')?.disabled).toBe(false);
		});
		await settle();

		expect(await keptWrites()).toEqual([]);
	});

	it('a failed attendance mark shows its message and keeps one report with the error', async () => {
		setWorld();
		applyAttendanceChangeMock.mockRejectedValue(new Error('HTTP 403'));
		const { container } = render(Page);
		await openPanel(container);
		await fireEvent.click(q(container, '[data-testid="attendance-toggle-m2-present"]')!);

		await waitFor(() => {
			expect(q(container, '[data-testid="attendance-save-failed-m2"]')).not.toBeNull();
		});
		await vi.waitFor(async () =>
			expect(await keptWrites()).toEqual([
				{ area: 'agenda', action: 'saving attendance', detail: 'Error: HTTP 403' }
			])
		);
	});
});
