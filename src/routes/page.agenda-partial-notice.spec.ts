// @vitest-environment happy-dom
// The agenda notices for a truncated RSVP or attendance lifetime read.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_t, key) => () => String(key) })
}));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy({}, { get: (_t, key) => () => String(key) })
}));

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock, listMyAttendanceMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn(),
		listMyAttendanceMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
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
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function complete<T>(items: T[]) {
	return { items, total: items.length, truncated: false };
}
function truncated<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

interface Read<T> {
	items: T[];
	total: number;
	truncated: boolean;
}
type RsvpRead = Read<{ rsvpId: string; eventId: string; status: string }>;
type AttendanceRead = Read<{ attendanceId: string; eventId: string; status: string }>;

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

const DB_A = 'sampledb';
const DB_B = 'other-choir';

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB_A]: 'person-p', [DB_B]: 'person-q' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: DB_A, name: 'Sampledb', personId: 'person-p' },
			{ db: DB_B, name: 'Other Choir', personId: 'person-q' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(DB_A);
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

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

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
