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
//
// #343 FLIPS the delivery leg on every path that can serve bytes. The handler
// captures (db, personId) from selectedCollectiveIdentityStore AT CLICK TIME,
// opens the tab synchronously (popup-blocker pattern kept), then serves the
// bytes through the read-through byte store (openFileBytes → the
// $lib/files/appByteStore seam, faked in-memory here) — the tab receives a
// `blob:` URL on a cache hit and on a stored fetch. On the DEGRADED paths it
// receives the signed URL itself (byte fetch or body read rejected, or the
// declared size over the store cap), because the cache may not gate an open:
// "NEVER the signed URL" is therefore not a claim this suite makes globally —
// the fallback specs below pin that handover deliberately, and openFileBytes'
// DELIVERY REPORTING block is the account of all four paths.
// A second open of the same file signs
// nothing and fetches nothing. A late-settling open whose identity is no
// longer current must NOT navigate (the routeLoad isCurrent discipline,
// applied to this chain), while its bytes still land under the ISSUING
// identity's partition — never the new one.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
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
	listMyRsvps: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
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
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
// #343 — the byte-store seam: the page reaches persistence ONLY through
// getAppByteStore(), so an in-memory fake (fresh per test, see beforeEach)
// stands in for IndexedDB. The fake implements the full pinned ByteStore
// contract and records every put() for the partition/no-url assertions.
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;

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

/** #343 identity-switch harness: TWO collectives, so the page can genuinely
 *  change identity mid-flight (polyphony/person-p → crede/person-c). */
function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', crede: 'person-c' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'crede', name: 'Crede', personId: 'person-c' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

/** A byte-serving global fetch for the signed-URL GET leg. Returns the mock
 *  so tests can count network trips.
 *
 *  This page ALSO fires two pre-existing, #343-unrelated bulk reads on every
 *  mount regardless of the PDF click (#262's schedule_item read and #167's
 *  database-entity rights fallback), both via bare default-`fetch` — the
 *  SAME global this stubs. Routing those two by URL to a harmless empty
 *  answer, untracked by `fetchMock`, keeps `fetchMock` an honest count of
 *  ONLY the byte-GET leg this suite is actually about (same shape as the
 *  `wrapped` fetch precedent in page.repertoire-manage-wiring.spec.ts). */
function stubByteFetch(bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])) {
	const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
		new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'application/pdf' } })
	);
	vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('https://s3.example/')) return fetchMock(input);
		return new Response(JSON.stringify({ entities: [] }), { status: 200 });
	});
	return fetchMock;
}

function makeTab() {
	return { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
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

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	signFileUrlMock.mockReset();
	vi.unstubAllGlobals();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — Works element wiring (#90 TR.2)', () => {
	it('resolves works for every agenda event (upcoming AND recent) with the current season id', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent,
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
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
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
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
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
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
		// #343 — the read-through leg may thread a fetchImpl behind cfg+fileId;
		// the click-time pin is on WHAT gets signed, not the arity.
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(signFileUrlMock.mock.calls[0].slice(0, 2)).toEqual([
			{ db: 'polyphony', token: 'jwt-abc' },
			'file-score'
		]);
	});

	// #343 GOLDEN FLIP — this test used to pin `tab.location.href` to the raw
	// signed URL. It now pins the OPPOSITE: the tab gets a same-origin `blob:`
	// URL serving the fetched bytes, and the signed URL never reaches the tab
	// (it lives 60s, is method-scoped, and must stay a transport secret).
	it('navigates the tab opened in the click gesture to a blob: URL of the bytes — NEVER the raw signed url', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		const fetchMock = stubByteFetch();
		const tab = makeTab();
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);

		// Opened SYNCHRONOUSLY inside the click (popup blockers swallow a
		// window.open issued after any await), and severed from us — #343
		// keeps the pattern byte-for-byte.
		expect(openSpy).toHaveBeenCalledWith('', '_blank');
		expect(tab.opener).toBeNull();
		await vi.waitFor(() => {
			expect(tab.location.href).toMatch(/^blob:/);
		});
		expect(tab.location.href).not.toContain('s3.example');
		// The byte GET went to the signed URL, once.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe('https://s3.example/signed-1');
		// And the bytes landed under the CLICKING identity's partition.
		expect(fakeByteStore.heldFor('polyphony', 'person-p')).toEqual(['file-score']);
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
	});

	it('READ-THROUGH: opening the same part twice signs once and fetches once — the second tab is served from the store', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		const fetchMock = stubByteFetch();
		const tabs = [makeTab(), makeTab()];
		let openCount = 0;
		vi.spyOn(window, 'open').mockImplementation(() => tabs[openCount++] as unknown as Window);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);

		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);
		await vi.waitFor(() => {
			expect(tabs[0].location.href).toMatch(/^blob:/);
		});

		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);
		await vi.waitFor(() => {
			expect(tabs[1].location.href).toMatch(/^blob:/);
		});

		// ONCE each, total — the second open asked the network for nothing.
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('OFFLINE: a part already in the store opens with the network down — no signing, no fetch, no error surface', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		// The rehearsal-with-no-signal shape: every network path is dead —
		// INCLUDING the page's own #343-unrelated bg reads (schedule_item,
		// database rights), routed through an untracked thrower so `fetchMock`
		// stays an honest count of the byte-GET leg alone (see stubByteFetch's
		// header for why those reads exist on every mount).
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		const fetchMock = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.startsWith('https://s3.example/')) return fetchMock();
			throw new TypeError('Failed to fetch');
		});
		fakeByteStore.seed({ db: 'polyphony', personId: 'person-p' }, 'file-score', {
			bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
			filetype: 'application/pdf',
			sha256: 'sha-cached'
		});
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);

		await vi.waitFor(() => {
			expect(tab.location.href).toMatch(/^blob:/);
		});
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
	});

	it('IDENTITY GUARD: an open that settles AFTER a collective switch closes its tab and releases the bytes — they still land under the ISSUING identity', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		// Hold the signing so the WHOLE chain settles after the switch.
		let releaseSigning!: (url: string) => void;
		signFileUrlMock.mockReturnValue(new Promise<string>((r) => (releaseSigning = r)));
		const fetchMock = stubByteFetch();
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		// The URL this open mints is captured rather than guessed: openFileBytes
		// also revokes the PREVIOUS url minted for the same fileId (its one-live-
		// url-per-file rule), and that latch is module state shared with the
		// other tests in this file.
		const createSpy = vi.spyOn(URL, 'createObjectURL');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
		setAuthedWithTwoCollectives();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);

		// The singer switches to the other collective while the open is in flight.
		selectedCollectiveDbStore.set('crede');
		releaseSigning('https://s3.example/signed-1');
		await vi.waitFor(() => {
			// The fetch under the OLD identity still completes and stores under
			// polyphony/person-p — the late-settle poisoning case: NEVER crede.
			expect(fakeByteStore.heldFor('polyphony', 'person-p')).toEqual(['file-score']);
		});
		expect(fakeByteStore.heldFor('crede', 'person-c')).toEqual([]);

		// But the tab must NOT act for an identity that is no longer current.
		expect(tab.location.href).toBe('');
		expect(tab.location.href).not.toMatch(/^blob:/);
		// #343 review — suppression UNDOES the click: the synchronously-opened
		// tab is closed (a stray about:blank that never resolves is worse than
		// no tab) and the minted object URL is revoked (a full copy of the score
		// pinned behind a URL nothing can reach is a leak, not a cache).
		await vi.waitFor(() => {
			expect(tab.close).toHaveBeenCalled();
		});
		const minted = String(createSpy.mock.results.at(-1)!.value);
		expect(minted).toMatch(/^blob:/);
		expect(revokeSpy).toHaveBeenCalledWith(minted);
		// A suppressed late open is not an error — nothing to alarm about.
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
		void fetchMock;
		createSpy.mockRestore();
		revokeSpy.mockRestore();
	});

	// #343 fix-round — Gama's 1(b) ruling: a byte GET dying AFTER successful
	// signing (network dropped inside the 60s window, or a CORS TypeError on
	// an unallowlisted origin) no longer closes the tab with an error. It
	// falls back to the signed URL already in hand — the exact pre-#343
	// path — so the tab still opens the file; nothing is stored (the ruling's
	// distinguishability point: this is `network-uncached`/`fallback-
	// navigation`, never a cache hit — see openFileBytes.spec.ts).
	it('a fetch that fails AFTER successful signing falls back to the RAW signed url — tab not closed, no error surface, nothing stored', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		const fetchMock = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', fetchMock);
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);

		await vi.waitFor(() => {
			expect(tab.location.href).toBe('https://s3.example/signed-1');
		});
		expect(tab.close).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
		// Nothing half-fetched reached the store — a fallback delivers, it never caches.
		expect(fakeByteStore.heldFor('polyphony', 'person-p')).toEqual([]);
	});

	// #343 fix-round (f) — the late-settle identity guard must hold even when
	// the settling leg is the FALLBACK, not a stored success: a screen that
	// has moved on to another collective must not be handed ANY navigation,
	// blob or raw, for the identity it left behind.
	it('LATE SETTLE + FALLBACK: an identity switch during flight suppresses the fallback navigation too — no stale-identity tab action', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		let releaseSigning!: (url: string) => void;
		signFileUrlMock.mockReturnValue(new Promise<string>((r) => (releaseSigning = r)));
		const fetchMock = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', fetchMock);
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		setAuthedWithTwoCollectives();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);

		// The singer switches collectives WHILE the chain is in flight; the
		// fetch then rejects (the fallback trigger) only after the switch.
		selectedCollectiveDbStore.set('crede');
		releaseSigning('https://s3.example/signed-1');

		await vi.waitFor(() => {
			expect(tab.close).toHaveBeenCalled();
		});
		// Never the fallback url, under the stale identity.
		expect(tab.location.href).toBe('');
		expect(tab.location.href).not.toBe('https://s3.example/signed-1');
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
		expect(fakeByteStore.heldFor('polyphony', 'person-p')).toEqual([]);
		expect(fakeByteStore.heldFor('crede', 'person-c')).toEqual([]);
	});

	it('a rejected signing closes the tab and surfaces an inline error — never a silent no-op', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
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
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
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
