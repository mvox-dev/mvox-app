// @vitest-environment happy-dom
//
// #194/#202 RED — INTEGRATION: the real agenda route shows events of ALL types.
//
// Real +page.svelte + real AgendaList; only the data seams are mocked (same
// harness family as page.agenda-error.spec.ts). This is the wiring pin: the
// unit specs prove listEvents returns concerts and AgendaList can badge them —
// THIS spec proves the page actually renders what the loader returns, badge and
// all, so a GREEN that fixes the query but drops eventType on the way to the
// UI (or never wires the badge into the page's AgendaList usage) fails here.
//
// Crede pilot reproduction (#194/#202): a 'proov' rehearsal and a
// 'Kevadkontsert' concert both live in the season — both must be visible on the
// agenda, each labeled with its type.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		// Distinct markers: the page-level badge must go through paraglide too.
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function item(id: string, name: string, startDatetime: string, eventType: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType
	} as AgendaItem;
}

// Far-future dates: the page renders `upcoming` as handed over, but AgendaList's
// relative-day decoration reads the real clock — keep the fixtures ahead of it.
const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const CONCERT = item('ev-kontsert', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — agenda shows ALL event types (#194/#202 integration)', () => {
	// NOTE (RED discipline): row PRESENCE alone would pass today — the page never
	// filtered by type, only the (here-mocked) data layer did. The end-to-end
	// "concerts actually come back" claim lives in the listEvents specs; what THIS
	// spec forces is the page-side wiring: the loader's eventType must survive all
	// the way into a rendered, localized badge on the real route.
	it('renders the concert row alongside the rehearsal row, each with its LOCALIZED type badge', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [REHEARSAL, CONCERT] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const concertRow = await waitFor(() => {
			const row = container.querySelector('[data-testid="agenda-row-ev-kontsert"]');
			expect(row).not.toBeNull();
			return row as HTMLElement;
		});
		expect(container.textContent).toContain('Kevadkontsert');
		expect(
			concertRow.querySelector('[data-testid="event-type-badge-ev-kontsert"]')?.textContent?.trim()
		).toBe('[msg:concert]');

		const rehearsalRow = container.querySelector(
			'[data-testid="agenda-row-ev-proov"]'
		) as HTMLElement;
		expect(rehearsalRow).not.toBeNull();
		expect(
			rehearsalRow.querySelector('[data-testid="event-type-badge-ev-proov"]')?.textContent?.trim()
		).toBe('[msg:rehearsal]');
	});

	it("a FREE-TEXT type ('laulupidu') renders its raw value as the badge on the real route", async () => {
		const freeText = item('ev-laulupidu', 'Üldlaulupidu', '2030-07-01T16:00:00.000Z', 'laulupidu');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [freeText] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const row = await waitFor(() => {
			const el = container.querySelector('[data-testid="agenda-row-ev-laulupidu"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(row.querySelector('[data-testid="event-type-badge-ev-laulupidu"]')?.textContent?.trim()).toBe(
			'laulupidu'
		);
	});
});

// (*MVOX:Palestrina* — #194/#202 RED)
