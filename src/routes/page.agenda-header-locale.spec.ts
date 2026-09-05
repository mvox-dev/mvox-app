// @vitest-environment happy-dom
//
// #251 RED — INTEGRATION: the real agenda route's day-group headers render in
// the APP language, not the device locale.
//
// Real +page.svelte + real AgendaList; only the data seams are mocked (same
// harness family as page.agenda-event-types.spec.ts). The unit pins live in
// AgendaList.spec.ts (#251 describe); what THIS spec forces is the wiring on
// the actual route: the page renders AgendaList as-is, so a GREEN that fixes
// the component only in isolation (or reroutes the page through some other
// header path) still has to show Estonian header text HERE, where Joosep's
// 2026-09-05 screenshot showed English.
//
// The paraglide runtime mock intercepts '$lib/paraglide/runtime.js' — the
// specifier routes/+page.svelte:83 already imports getLocale from — and backs
// it with a SvelteMap (a reactive signal), so the live language-switch test
// below genuinely invalidates a $derived-constructed formatter. happy-dom's
// device locale is en-US: every 'et' assertion proves device-locale
// independence by construction.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

type AppLocale = 'en' | 'et' | 'lv' | 'uk';
const localeMock = vi.hoisted(() => ({
	state: null as { get(k: string): string | undefined; set(k: string, v: string): unknown } | null
}));
vi.mock('$lib/paraglide/runtime.js', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	localeMock.state ??= new SvelteMap<string, string>([['locale', 'en']]);
	return {
		getLocale: () => localeMock.state!.get('locale'),
		setLocale: vi.fn(),
		locales: ['en', 'et', 'lv', 'uk'],
		overwriteGetLocale: vi.fn()
	};
});
function setAppLocale(locale: AppLocale): void {
	localeMock.state?.set('locale', locale);
}

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

function item(id: string, name: string, startDatetime: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	} as AgendaItem;
}

// Far-future date so the relative-day decoration (which reads the real clock)
// never adds a TÄNA/HOMME pill to the header under test: 2030-06-10T16:00Z is
// Monday 10 June in Europe/Tallinn.
const REHEARSAL = item('ev-proov', 'Tavaline proov', '2030-06-10T16:00:00.000Z');

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	setAppLocale('en');
});

describe('+page — agenda headers follow the app language on the real route (#251 integration)', () => {
	it("app language 'et' on an en-US device: the day-group header reads 'esmaspäev, 10. juuni'", async () => {
		setAppLocale('et');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [REHEARSAL] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const header = await waitFor(() => {
			const el = container.querySelector('[data-testid="agenda-date-header"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(header.textContent?.trim()).toBe('esmaspäev, 10. juuni');
	});

	// done-when 2 at the route level — switch the app language with the page
	// MOUNTED: the header re-renders in the new language without a reload.
	// (setLocale reloads the page today; this is the tripwire for whoever
	// removes that reload.)
	it('switching the app language live re-renders the header without a reload', async () => {
		setAppLocale('en');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming: [REHEARSAL] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const headerText = () =>
			container.querySelector('[data-testid="agenda-date-header"]')?.textContent?.trim();
		await waitFor(() => {
			expect(headerText()).toBe('Monday, June 10');
		});

		setAppLocale('et');
		await waitFor(() => {
			expect(headerText()).toBe('esmaspäev, 10. juuni');
		});
	});
});

// (*MVOX:Tallis* — #251 RED)
