// @vitest-environment happy-dom
//
// #351 RED — the EVENT DETAIL surface: the same one-indicator-two-states
// presence badge on every part row that carries a file, mirrored from the
// /library pins (page.library-presence-badges.spec.ts — the shared testid
// contract is [data-testid="file-presence-{fileId}"] + the two
// file_presence_* message keys; the wording-honesty locale pins live there,
// once, for both surfaces).
//
//   - A row whose file the store HOLDS (current identity's partition) badges
//     m.file_presence_on_device(); a row whose file it does not badges
//     m.file_presence_needs_network(); a row with NO file gets NO badge.
//   - While the store has not answered: NEITHER — an absent badge is not a
//     claim, and needs-network-then-correct is the forbidden flicker.
//   - THE trap (issue #351): presence is ONE heldFileIds(db, personId) call
//     for the whole works list — never a per-row get(), which counts as an
//     open and would collapse the store's LRU to render order.
//   - The badge is not a control, and the row's open behaviour is UNCHANGED:
//     tapping the PDF link still opens the tab exactly as #343 pinned it.
//
// INTEGRATION posture (house rule): the REAL route component renders; only
// the wire, loadWorksByEventId, signFileUrl and the $lib/files/appByteStore
// seam are substituted — same seams as page.pdf-open-bytes.spec.ts.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { gotoMock, discoverMock, loadWorksByEventIdMock, signFileUrlMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn(),
	signFileUrlMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({ getAppLabelStore: () => ({ putLabel: async () => {}, labelsFor: async () => new Map(), remove: async () => {} }) }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;

type PresenceQuery = (db: string, personId: string) => Promise<string[]>;

function installPresence(impl?: PresenceQuery) {
	const spy = vi.fn<PresenceQuery>(
		impl ?? (async (db, personId) => fakeByteStore.heldFor(db, personId))
	);
	(fakeByteStore as unknown as { heldFileIds: PresenceQuery }).heldFileIds = spy;
	return spy;
}

function deferred<T>() {
	let resolveIt!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolveIt = r;
	});
	return { promise, resolve: resolveIt };
}

const IDENTITY = { db: 'sampledb', personId: 'person-p' };

function pdfData() {
	return {
		bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
		filetype: 'application/pdf',
		sha256: 'sha-fixture'
	};
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

const SIGNED_URL = 'https://s3.example/signed-ev?X-Amz-Expires=60';
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/** Reads only: the event + its season; every other side read answers empty.
 *  The signed-URL GET serves bytes. */
function installWire() {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.startsWith('https://s3.example/')) {
			return new Response(PDF_BYTES.slice(), {
				status: 200,
				headers: { 'content-type': 'application/pdf' }
			});
		}
		if (url.includes('/entity/ev1'))
			return json({
				entity: {
					_id: 'ev1',
					name: [{ string: 'Tuesday Rehearsal' }],
					start_datetime: [{ datetime: isoAt(7) }],
					duration_minutes: [{ number: 90 }],
					_parent: [
						{ reference: 'org1', entity_type: 'organization' },
						{ reference: 'season1', entity_type: 'season' }
					]
				}
			});
		if (url.includes('/entity/season1'))
			return json({
				entity: {
					_id: 'season1',
					name: [{ string: '2026/27' }],
					start_date: [{ date: isoAt(-30).slice(0, 10) }]
				}
			});
		return json({ entities: [] });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function workRow(id: string, workName: string, fileId: string) {
	return {
		id,
		kind: 'repertoire' as const,
		workId: `work-${id}`,
		editionId: `ed-${id}`,
		workName,
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: 'Vocal score',
		ordinal: null,
		fileId,
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

/** Three rows: a held file, an unheld file, and NO file — all three badge
 *  outcomes on one surface. */
function mockWorksRead() {
	loadWorksByEventIdMock.mockResolvedValue({
		ev1: [
			workRow('ri-1', 'Spem in alium', 'file-held'),
			workRow('ri-2', 'If ye love me', 'file-absent'),
			workRow('ri-3', 'O nata lux', '')
		]
	});
}

function makeTab() {
	return { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
}

function renderPage() {
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
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
	return render(Page);
}

async function worksVisible(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-link-pdf"]')).not.toBeNull();
	});
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	resetTypeIdCache();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadWorksByEventIdMock.mockReset();
	signFileUrlMock.mockReset();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#351 — event detail: presence badges on part rows (integration)', () => {
	it('held → on-device, unheld → needs-network, no file → NO badge — all in the SAME render', async () => {
		installWire();
		mockWorksRead();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();

		const { container } = renderPage();
		await worksVisible(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="file-presence-file-absent"]')).not.toBeNull();
		});
		const held = container.querySelector('[data-testid="file-presence-file-held"]')!;
		const absent = container.querySelector('[data-testid="file-presence-file-absent"]')!;
		expect(held.textContent).toContain('[file_presence_on_device]');
		expect(held.textContent).not.toContain('[file_presence_needs_network]');
		expect(absent.textContent).toContain('[file_presence_needs_network]');
		expect(absent.textContent).not.toContain('[file_presence_on_device]');
		// The fileless row makes no claim — exactly two badges on this surface.
		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(2);
	});

	it('THE trap: the works list asks presence ONCE — heldFileIds for the current identity — and never get() to render', async () => {
		installWire();
		mockWorksRead();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		const getSpy = vi.spyOn(fakeByteStore, 'get');

		const { container } = renderPage();
		await worksVisible(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
		});

		expect(presenceSpy.mock.calls).toEqual([['sampledb', 'person-p']]);
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('while the store has NOT answered, NEITHER badge renders; the answer landing paints both, from the answer alone', async () => {
		installWire();
		mockWorksRead();
		const pending = deferred<string[]>();
		installPresence(() => pending.promise);

		const { container } = renderPage();
		await worksVisible(container);

		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);
		const works = container.querySelector('[data-testid="event-detail-works"]')!;
		expect(works.textContent).not.toContain('[file_presence_needs_network]');
		expect(works.textContent).not.toContain('[file_presence_on_device]');

		pending.resolve(['file-held']);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_on_device]');
			expect(
				container.querySelector('[data-testid="file-presence-file-absent"]')!.textContent
			).toContain('[file_presence_needs_network]');
		});
	});

	it('the badge is NOT a control, and the row open behaviour is UNCHANGED: tapping the PDF link still opens the tab with a blob: URL (#343 pin)', async () => {
		installWire();
		mockWorksRead();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const tab = makeTab();
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const { container } = renderPage();
		await worksVisible(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
		});

		const badge = container.querySelector('[data-testid="file-presence-file-held"]')!;
		expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']).not.toContain(
			badge.tagName
		);
		expect(badge.hasAttribute('role')).toBe(false);
		expect(badge.hasAttribute('tabindex')).toBe(false);
		expect(badge.closest('button, a, [role="button"]')).toBeNull();

		// Clicking the badge does NOTHING — no tab, no signing.
		await fireEvent.click(badge);
		expect(openSpy).not.toHaveBeenCalled();
		expect(signFileUrlMock).not.toHaveBeenCalled();

		// Tapping the row's PDF link works exactly as #343 pinned it.
		const links = container.querySelectorAll('[data-testid="work-link-pdf"]');
		await fireEvent.click(links[0]);
		expect(openSpy).toHaveBeenCalledWith('', '_blank');
		await waitFor(() => {
			expect(tab.location.href).toMatch(/^blob:/);
		});
	});

	// #351 review finding 1 — the done-when bullet "a part that is downloaded,
	// then evicted by the cap, stops showing as available", at the only level
	// the member ever sees it. Mirrors the /library pin of the same name.
	//
	// A put is a STORE-WIDE mutation: the cap's evictUntilFits deletes the
	// globally-least-recently-opened rows to admit the newcomer, and those
	// rows can be on this very screen. A page that patches the newcomer into
	// its presence Set and stops there leaves the evicted row badged
	// "on this device" forever — the wrong-badge direction.
	it('opening an unheld part whose store put EVICTS a held one flips BOTH badges — the evicted row stops claiming on-device', async () => {
		installWire();
		mockWorksRead();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		// The cap in miniature. createFakeByteStore holds no cap policy (the
		// REAL eviction arithmetic is specced in byteStore.presence.spec.ts);
		// what this pins is the PAGE's reaction to a put that took something
		// else away — storing file-absent costs the device file-held.
		const realPut = fakeByteStore.put.bind(fakeByteStore);
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async (identity, fileId, data) => {
			await realPut(identity, fileId, data);
			await fakeByteStore.evict(IDENTITY, 'file-held');
		});
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const { container } = renderPage();
		await worksVisible(container);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_on_device]');
		});

		// Row 2 is the unheld part — its open goes to the network and stores.
		const links = container.querySelectorAll('[data-testid="work-link-pdf"]');
		await fireEvent.click(links[1]);

		await waitFor(() => {
			// The newcomer is now on the device...
			expect(
				container.querySelector('[data-testid="file-presence-file-absent"]')!.textContent
			).toContain('[file_presence_on_device]');
			// ...and the row the cap took away no longer says it is.
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_needs_network]');
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).not.toContain('[file_presence_on_device]');
		});
		// A RE-QUERY, not a local patch: the store, not the page, is what
		// knows which rows survived.
		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p']
		]);
	});

	// #351 second review round, finding 1 — mirrored from the /library pin of
	// the same name. byteStore.put evicts BEFORE it writes (no way to reserve
	// IndexedDB space ahead of a write), so a put that REJECTS has already
	// discarded the rows it made room with — and openFileBytes reports that
	// open 'network-uncached'. Re-asking only on 'network-stored' leaves the
	// discarded rows badged on-device. The re-query follows the write ATTEMPT.
	it('an open whose store put EVICTS a held row and then REJECTS still re-queries — the discarded row stops claiming on-device', async () => {
		installWire();
		mockWorksRead();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		// Eviction lands, the write that needed the room does not — exactly the
		// order byteStore.put runs them in.
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async () => {
			await fakeByteStore.evict(IDENTITY, 'file-held');
			throw new Error('idb: transaction aborted');
		});
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const { container } = renderPage();
		await worksVisible(container);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_on_device]');
		});

		const links = container.querySelectorAll('[data-testid="work-link-pdf"]');
		await fireEvent.click(links[1]);

		// The open still DELIVERS — the cache is never a gate (#343).
		await waitFor(() => {
			expect(tab.location.href).not.toBe('');
		});
		await waitFor(() => {
			// Nothing was stored, so the newcomer gained no offline copy...
			expect(
				container.querySelector('[data-testid="file-presence-file-absent"]')!.textContent
			).toContain('[file_presence_needs_network]');
			// ...and the row the failed write discarded no longer claims one.
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_needs_network]');
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).not.toContain('[file_presence_on_device]');
		});
		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p']
		]);
	});
});

// (*MVOX:Tallis*)
