// @vitest-environment happy-dom
// The event page's attendance panel load: merge with local marks, failed marks, cancel on close.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const {
	gotoMock,
	discoverMock,
	loadEventDetailMock,
	loadRosterMock,
	listAttendanceMock,
	listAllRsvpsForEventMock,
	applyAttendanceChangeMock
} = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	loadEventDetailMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	applyAttendanceChangeMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/events/eventDetail', async (importActual) => ({
	...(await importActual<typeof import('$lib/events/eventDetail')>()),
	loadEventDetail: loadEventDetailMock,
	listEventLocations: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/roster/rosterData', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/rosterData')>()),
	loadRoster: loadRosterMock
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock
}));
vi.mock('$lib/attendance/attendanceOptimistic', () => ({
	applyAttendanceChange: applyAttendanceChangeMock
}));
vi.mock('$lib/rsvp/rsvpData', async (importActual) => ({
	...(await importActual<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: vi.fn().mockResolvedValue('member-viewer'),
	findMyRsvpForEvent: vi.fn().mockResolvedValue(null)
}));
vi.mock('$lib/repertoire/workRows', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import type { EventDetail } from '$lib/events/eventDetail';

function pastEditedDetail(): EventDetail {
	return {
		id: 'ev1',
		name: 'Tuesday Rehearsal',
		eventType: 'rehearsal',
		startDatetime: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
		durationMinutes: 90,
		location: '',
		description: '',
		conductorIds: ['person-p'],
		conductorNames: ['Vera Viewer'],
		capacity: null,
		ownerIds: [],
		editorIds: ['person-p'],
		seasonId: 'season1',
		seasonOwnerIds: [],
		seasonEditorIds: [],
		seriesId: null,
		inheritedFields: []
	};
}

const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];
const ROSTER_READ = { items: ROSTER, total: ROSTER.length, truncated: false };

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function renderPage() {
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ entities: [] }))));
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
	return render(Page);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function openPanel(container: HTMLElement) {
	await waitFor(() => expect(q(container, 'take-attendance-btn')).not.toBeNull());
	await fireEvent.click(q(container, 'take-attendance-btn')!);
}

async function closePanel(container: HTMLElement) {
	await fireEvent.click(q(container, 'attendance-collapse-btn')!);
	await waitFor(() => expect(q(container, 'take-attendance-btn')).not.toBeNull());
}

const pressed = (container: HTMLElement, testid: string) =>
	q(container, testid)?.getAttribute('aria-pressed');

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadEventDetailMock.mockReset();
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	applyAttendanceChangeMock.mockReset();
	resetTypeIdCache();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/event/[id] attendance panel load (#596)', () => {
	it('keeps a mark still in flight when the server read does not have it yet', async () => {
		loadEventDetailMock.mockResolvedValue(pastEditedDetail());
		loadRosterMock.mockResolvedValue(ROSTER_READ);
		listAttendanceMock.mockResolvedValue([]);
		listAllRsvpsForEventMock.mockResolvedValue([]);
		applyAttendanceChangeMock.mockReturnValue(new Promise(() => {}));
		const { container } = renderPage();
		await openPanel(container);
		await waitFor(() => expect(q(container, 'attendance-row-m1')).not.toBeNull());

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await closePanel(container);
		await openPanel(container);
		await waitFor(() => expect(listAttendanceMock).toHaveBeenCalledTimes(3));
		await waitFor(() => expect(q(container, 'attendance-row-m1')).not.toBeNull());

		expect(pressed(container, 'attendance-toggle-m1-present')).toBe('true');
	});

	it('remembers a failed mark across close and reopen', async () => {
		loadEventDetailMock.mockResolvedValue(pastEditedDetail());
		loadRosterMock.mockResolvedValue(ROSTER_READ);
		listAttendanceMock.mockResolvedValue([]);
		listAllRsvpsForEventMock.mockResolvedValue([]);
		applyAttendanceChangeMock.mockRejectedValue(new Error('save failed'));
		const { container } = renderPage();
		await openPanel(container);
		await waitFor(() => expect(q(container, 'attendance-row-m1')).not.toBeNull());
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => expect(q(container, 'attendance-save-failed-m1')).not.toBeNull());

		await closePanel(container);
		await openPanel(container);
		await waitFor(() => expect(q(container, 'attendance-row-m1')).not.toBeNull());

		expect(q(container, 'attendance-save-failed-m1')).not.toBeNull();
		expect(q(container, 'attendance-save-failed-m2')).toBeNull();
	});

	it('drops a load that lands after the panel closed', async () => {
		loadEventDetailMock.mockResolvedValue(pastEditedDetail());
		listAttendanceMock.mockResolvedValue([]);
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const first = deferred<typeof ROSTER_READ>();
		const second = deferred<typeof ROSTER_READ>();
		loadRosterMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const { container } = renderPage();

		await openPanel(container);
		await closePanel(container);
		await openPanel(container);
		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(2));
		first.resolve(ROSTER_READ);
		await new Promise((r) => setTimeout(r, 0));

		expect(q(container, 'attendance-row-m1')).toBeNull();
		second.resolve(ROSTER_READ);
		await waitFor(() => expect(q(container, 'attendance-row-m1')).not.toBeNull());
	});
});
