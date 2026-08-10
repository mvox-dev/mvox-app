// @vitest-environment happy-dom
//
// #90 TR.2 — the WIRING half of the Works element: proof that a real user
// reaches it. The data layer (repertoireData/workRows) and the renderer
// (RepertoireElement) were each unit-covered while NOTHING joined them to the
// page, so the feature existed only inside tests. These specs pin the join:
//   1. the page resolves works for the agenda's events (upcoming AND recent),
//      with the current season id, once the agenda load settles;
//   2. the resolved rows reach the actual rendered agenda row;
//   3. tapping PDF signs the url AT CLICK TIME (never a pre-signed href).
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	// Proxy mock: assertions below pin structure (testids, call arguments),
	// never translated copy.
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	loadWorksByEventIdMock,
	signFileUrlMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn(),
	signFileUrlMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// #91 TR.3 — +page.svelte now imports the repertoire WRITE layer (and the
// library reads that feed its pickers), which reaches entuFetch ->
// $lib/entu-config -> $env/dynamic/public: unavailable outside a SvelteKit
// request context under happy-dom. Same one-line fix the library/profile specs
// already use; the real modules keep running, only the base url is stubbed.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
// ...and the page resolves management rights per season/event on every load.
// Only that ONE call is stubbed (the pure helpers and the write functions stay
// real): left alone it issues a live request per agenda event, which is both a
// network call from a unit test and a source of teardown AbortErrors. The
// management surface itself is covered end-to-end in
// page.repertoire-manage-wiring.spec.ts.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Same $env wall as the sibling page specs: these modules pull in
// $lib/entu/request -> $env/dynamic/public, unavailable under happy-dom.
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue('member-1'),
	listMyRsvps: vi.fn().mockResolvedValue([]),
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: loadWorksByEventIdMock }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

const upcoming = [
	{
		id: 'ev-1',
		name: 'Rehearsal',
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];
const recent = [
	{
		id: 'ev-0',
		name: 'Last rehearsal',
		startDatetime: past,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];

function workRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'ri-1',
		kind: 'repertoire' as const,
		workId: 'work-1',
		editionId: 'ed-1',
		workName: 'Spem in alium',
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: '40-part original',
		ordinal: null,
		fileId: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	signFileUrlMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — Works element wiring (#90 TR.2)', () => {
	it('resolves works for every agenda event (upcoming AND recent) with the current season id', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming,
			recent,
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		loadWorksByEventIdMock.mockResolvedValue({});
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(loadWorksByEventIdMock).toHaveBeenCalled();
		});
		// #91 TR.3 widened the call: the read mode depends on the rights answer
		// (a season editor reads retired/dropped too), so the flag rides along.
		expect(loadWorksByEventIdMock).toHaveBeenCalledWith(
			{ db: 'polyphony', token: 'jwt-abc' },
			['ev-1', 'ev-0'],
			'season-1',
			expect.anything(),
			{ includeInactive: false }
		);
	});

	it('renders the resolved works inside the matching agenda row — the element a member actually sees', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow()] });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-ev-1"]')).not.toBeNull();
		});
		await vi.waitFor(() => {
			const line = container
				.querySelector('[data-testid="agenda-row-ev-1"]')
				?.querySelector('[data-testid="works-line"]');
			expect(line).not.toBeNull();
			expect(line?.textContent).toContain('Spem in alium');
		});
	});

	it('signs the PDF url AT CLICK TIME — the file id round-trips from the row to signFileUrl', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		vi.spyOn(window, 'open').mockReturnValue(null);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		const pdf = container.querySelector('[data-testid="work-link-pdf"]');
		// The whole point: no href was ever resolved at load time (a signed Entu
		// url lives 60 seconds and would be dead by now).
		expect(pdf?.getAttribute('href')).toBeNull();
		expect(signFileUrlMock).not.toHaveBeenCalled();

		await fireEvent.click(pdf!);
		expect(signFileUrlMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, 'file-score');
	});

	it('navigates the tab opened in the click gesture to the freshly signed url', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);

		// Opened SYNCHRONOUSLY inside the click (popup blockers swallow a
		// window.open issued after the signing await), and severed from us.
		expect(openSpy).toHaveBeenCalledWith('', '_blank');
		expect(tab.opener).toBeNull();
		await vi.waitFor(() => {
			expect(tab.location.href).toBe('https://s3.example/signed-1');
		});
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
	});

	it('a rejected signing closes the tab and surfaces an inline error — never a silent no-op', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		signFileUrlMock.mockRejectedValue(new Error('403'));
		const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).not.toBeNull();
		});
		expect(tab.close).toHaveBeenCalled();
		expect(tab.location.href).toBe('');
	});

	it('a failed works read leaves the agenda intact, just work-free', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		loadWorksByEventIdMock.mockRejectedValue(new Error('boom'));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-ev-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="works-line"]')).toBeNull();
	});
});

// (*MVOX:Josquin*)
