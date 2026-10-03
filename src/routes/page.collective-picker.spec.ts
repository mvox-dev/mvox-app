// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () => (await import('$lib/testing/messageMocks')).echoMessages());

const {
	loadFullAgendaMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listMyAttendanceMock,
	hydrateCollectivesMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	hydrateCollectivesMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', async () => (await import('$lib/testing/routeMocks')).discoverModule());
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/collectives/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/collectives/store')>()),
	hydrateCollectives: hydrateCollectivesMock
}));
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () => (await import('$lib/testing/routeMocks')).navigationModule());
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: (rsvps: Array<{ rsvpId: string; eventId: string; status: string }>) => {
		const map: Record<string, { rsvpId: string; status: string }> = {};
		for (const r of rsvps) map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
		return map;
	},
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: listMyAttendanceMock,
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: (
		records: Array<{ attendanceId: string; memberId: string; status: string }>
	) => {
		const map: Record<string, { attendanceId: string; status: string }> = {};
		for (const r of records) map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
		return map;
	}
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import { get } from 'svelte/store';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';

const DB_A = 'sampledb';
const DB_B = 'orlando';
const SELECTED_KEY = 'mvox.selected_collective';

function complete<T>(items: T[]) {
	return { items, total: items.length, truncated: false };
}
function truncated<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function agendaEvent(id: string, name: string) {
	return {
		id,
		name,
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

function installAgendaPerDb() {
	loadFullAgendaMock.mockImplementation(async () =>
		fullAgendaResult(
			get(selectedCollectiveDbStore) === DB_B
				? { upcoming: [agendaEvent('or-ev', 'Orlando rehearsal')] }
				: { upcoming: [agendaEvent('pv-ev', 'Sampledb rehearsal')] }
		)
	);
}

function installRsvpReadsPerDb() {
	findMyMemberIdMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === DB_B ? 'member-b' : 'member-a'
	);
	listMyRsvpsMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === DB_A
			? truncated([{ rsvpId: 'rsvp-a', eventId: 'pv-ev', status: 'going' }], 503)
			: complete([])
	);
	listMyAttendanceMock.mockResolvedValue(complete([]));
}

function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: DB_A, name: 'Sampledb', personId: 'person-p' }, { db: DB_B, name: 'Orlando', personId: 'person-p' }] });
}

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: DB_A, name: 'Sampledb', personId: 'person-p' }] });
}

function setAuthedWithStatus(state: { status: 'none' } | { status: 'error'; erroredDbs: string[] } | { status: 'loading' }) {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: {},
		expMs: Date.now() + 100_000
	});
	collectiveState.set(state);
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function headerSelect(container: HTMLElement): HTMLSelectElement | null {
	return container.querySelector<HTMLSelectElement>('select[data-testid="selected-collective"]');
}

async function renderTwoCollectivesReady() {
	installAgendaPerDb();
	installRsvpReadsPerDb();
	setAuthedWithTwoCollectives();
	const rendered = render(Page);
	await waitFor(() => {
		expect(rendered.container.textContent).toContain('Sampledb rehearsal');
	});
	return rendered;
}

async function switchVia(container: HTMLElement, db: string) {
	const select = headerSelect(container);
	expect(select, 'the header collective <select>').not.toBeNull();
	await fireEvent.change(select!, { target: { value: db } });
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	localStorage.removeItem(SELECTED_KEY);
});

describe('#338 — header picker with 2+ collectives', () => {
	it('renders a native, classed <select> as the name — options are the collectives, value the selected db; the switch LINK is gone', async () => {
		const { container } = await renderTwoCollectivesReady();

		const select = headerSelect(container);
		expect(select, 'select[data-testid="selected-collective"]').not.toBeNull();

		expect(container.querySelectorAll('[data-testid="selected-collective"]')).toHaveLength(1);

		const options = Array.from(select!.options);
		expect(options.map((o) => o.value)).toEqual([DB_A, DB_B]);
		expect(options.map((o) => o.text.trim())).toEqual(['Sampledb', 'Orlando']);
		expect(select!.value).toBe(DB_A);

		expect(select!.getAttribute('aria-label')).toBe('[agenda_switch_collective]');

		expect(select!.getAttribute('class'), 'the select carries a class').toBeTruthy();

		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
	});

	it('changing the select drives the REAL selectCollective path: localStorage, goto ?collective=, and the new collective end to end', async () => {
		const { container } = await renderTwoCollectivesReady();

		await switchVia(container, DB_B);

		await waitFor(() => {
			expect(localStorage.getItem(SELECTED_KEY)).toBe(DB_B);
			expect(gotoMock).toHaveBeenCalledWith(
				expect.stringContaining('collective=orlando'),
				expect.objectContaining({ keepFocus: true, noScroll: true })
			);
		});

		await waitFor(() => {
			const select = headerSelect(container)!;
			expect(select.value).toBe(DB_B);
			expect(select.selectedOptions[0]?.text.trim()).toBe('Orlando');
			expect(container.textContent).toContain('Orlando rehearsal');
		});
	});
});

describe('#338 — static mode with exactly one collective', () => {
	it('the header renders the plain name <p> BYTE-IDENTICAL to today — no select, no affordance', async () => {
		installAgendaPerDb();
		installRsvpReadsPerDb();
		setAuthedWithOneCollective();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'selected-collective')).not.toBeNull();
		});

		const name = q(container, 'selected-collective')!;
		expect(name.outerHTML).toBe(
			'<p class="font-display text-xl text-ink" data-testid="selected-collective">Sampledb</p>'
		);
		expect(container.querySelector('select[data-testid="selected-collective"]')).toBeNull();
		expect(container.querySelector('[data-testid="collective-picker"]')).toBeNull();
		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
	});
});

describe('#338 — collectives status none', () => {
	it('renders m.agenda_collectives_none() as TEXT — no link, no navigation anywhere', async () => {
		setAuthedWithStatus({ status: 'none' });
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.textContent).toContain('[agenda_collectives_none]');
		});
		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
		expect(container.querySelectorAll('a')).toHaveLength(0);
	});
});

describe('#338 — collectives status error', () => {
	function setErrored() {
		hydrateCollectivesMock.mockResolvedValue({
			status: 'error',
			erroredDbs: ['alpha-db', 'beta-db']
		});
		setAuthedWithStatus({ status: 'error', erroredDbs: ['alpha-db', 'beta-db'] });
	}

	it('renders a classed retry <button> that re-fires collective discovery through the store', async () => {
		setErrored();
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'collectives-retry')).not.toBeNull();
		});
		const retry = q(container, 'collectives-retry')!;
		expect(retry.tagName).toBe('BUTTON');
		expect(retry.getAttribute('class'), 'the retry button carries a class (#335)').toBeTruthy();
		expect(retry.textContent).toContain('[agenda_collectives_error_retry]');
		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
		expect(container.querySelectorAll('a')).toHaveLength(1);
		expect(container.querySelector('a[href="/downloads"]')).not.toBeNull();

		expect(hydrateCollectivesMock).not.toHaveBeenCalled();
		await fireEvent.click(retry);
		await waitFor(() => {
			expect(hydrateCollectivesMock).toHaveBeenCalledTimes(1);
		});
	});

	it('names the dbs that could not be checked — the new single-param key, joined at the call site', async () => {
		setErrored();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.textContent).toContain(
				'[agenda_collectives_error_dbs {"dbs":"alpha-db, beta-db"}]'
			);
		});
	});

	it('a retry that fails again keeps the error panel standing — no unhandled rejection, button live again', async () => {
		setErrored();
		hydrateCollectivesMock.mockRejectedValue(new Error('discovery down'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'collectives-retry')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'collectives-retry')!);

		await waitFor(() => {
			expect(consoleError).toHaveBeenCalled();
		});
		expect(get(collectiveState)).toEqual({ status: 'error', erroredDbs: ['alpha-db', 'beta-db'] });
		expect(container.textContent).toContain(
			'[agenda_collectives_error_dbs {"dbs":"alpha-db, beta-db"}]'
		);
		const retry = q(container, 'collectives-retry') as HTMLButtonElement;
		expect(retry.disabled).toBe(false);

		await fireEvent.click(retry);
		await waitFor(() => {
			expect(hydrateCollectivesMock).toHaveBeenCalledTimes(2);
		});
		consoleError.mockRestore();
	});
});

describe('#338 — collectives status loading', () => {
	it('renders m.agenda_collectives_loading() as text, with no navigation', async () => {
		setAuthedWithStatus({ status: 'loading' });
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.textContent).toContain('[agenda_collectives_loading]');
		});
		expect(container.querySelectorAll('a')).toHaveLength(0);
	});
});

describe('#338 — switching via the header select leaves no state behind', () => {
	it('A→B: nothing from A survives on screen — agenda rows and A’s truncation notice are gone', async () => {
		const { container } = await renderTwoCollectivesReady();
		await waitFor(() => {
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
		});

		await switchVia(container, DB_B);

		await waitFor(() => {
			expect(container.textContent).toContain('Orlando rehearsal');
		});
		expect(container.textContent).not.toContain('Sampledb rehearsal');
		expect(q(container, 'rsvp-partial-notice')).toBeNull();
	});

	it('A→B→A: still clean, and A’s facts come back FRESH — generation counters survive in-place double switches', async () => {
		const { container } = await renderTwoCollectivesReady();
		await waitFor(() => {
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
		});

		await switchVia(container, DB_B);
		await waitFor(() => {
			expect(container.textContent).toContain('Orlando rehearsal');
			expect(q(container, 'rsvp-partial-notice')).toBeNull();
		});

		await switchVia(container, DB_A);
		await waitFor(() => {
			expect(container.textContent).toContain('Sampledb rehearsal');
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
		});
		expect(container.textContent).not.toContain('Orlando rehearsal');
		expect(headerSelect(container)!.value).toBe(DB_A);
		expect(localStorage.getItem(SELECTED_KEY)).toBe(DB_A);
	});
});

// (*MVOX:Tallis* — #338 RED)
