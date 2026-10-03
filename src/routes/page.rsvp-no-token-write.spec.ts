// @vitest-environment happy-dom
// #550: an agenda RSVP (a cfgFor write) with no token sends nothing and expires the session.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const h = vi.hoisted(() => ({
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));
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
vi.mock('$lib/rsvp/rsvpData', async (importActual) => ({
	...(await importActual<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: h.findMyMemberIdMock,
	listMyRsvps: h.listMyRsvpsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
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
import { gotoMock } from '$lib/testing/routeMocks';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';

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
	gotoMock.mockReset();
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
		loadFullAgendaMock.mockResolvedValue(
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

		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
		await settle();
		expect(nonGetCalls(fetchStub)).toEqual([]);
	});
});

// (*MVOX:Josquin*)
