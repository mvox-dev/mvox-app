// @vitest-environment happy-dom
// #550: an agenda RSVP (a cfgFor write) with no token sends nothing and expires the session.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const h = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: h.loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((...args: unknown[]) => {
		const [, entityId, personId] = args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: h.gotoMock }));
vi.mock('$lib/rsvp/rsvpData', async (importActual) => ({
	...(await importActual<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: h.findMyMemberIdMock,
	listMyRsvps: h.listMyRsvpsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { clearAll } from '$lib/auth/storage';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { nonGetCalls, settle } from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const E1 = {
	id: 'e1',
	name: 'Rehearsal e1',
	startDatetime: '2026-06-15T09:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
};

let fetchStub: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
	fetchStub = vi.fn<typeof fetch>(async (input) => {
		const typeName = new URL(String(input)).searchParams.get('name.string');
		const body = typeName ? { entities: [{ _id: `type-${typeName}` }] } : { entities: [] };
		return new Response(JSON.stringify(body), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchStub);
	install401Recovery();
	resetTypeIdCache();
	h.gotoMock.mockReset();
	history.replaceState({}, '', '/');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetAppState();
	resetGate();
});

describe('#550 — agenda RSVP with no token', () => {
	it('sends nothing and goes to session-expired', async () => {
		h.loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [],
				upcoming: [E1],
				recent: [],
				seasonId: null,
				seasonConductors: [],
				seasonOwners: [],
				seasonEditors: []
			})
		);
		h.findMyMemberIdMock.mockResolvedValue('member-1');
		h.listMyRsvpsMock.mockResolvedValue(toListRead([]));
		signIn();
		completionGateStore.set('complete');

		const { container } = render(Page);
		const going = await waitFor(() => {
			const btn = container.querySelector<HTMLButtonElement>(
				'[data-testid="agenda-row-e1"] [data-testid="rsvp-btn-going"]'
			);
			expect(btn?.disabled).toBe(false);
			return btn!;
		});
		await settle();
		clearAll({ preserveProvider: false });
		fetchStub.mockClear();

		await fireEvent.click(going);

		await waitFor(() => expect(h.gotoMock).toHaveBeenCalledTimes(1));
		expect(String(h.gotoMock.mock.calls[0][0])).toContain('session_expired');
		await settle();
		expect(nonGetCalls(fetchStub)).toEqual([]);
	});
});

// (*MVOX:Josquin*)
