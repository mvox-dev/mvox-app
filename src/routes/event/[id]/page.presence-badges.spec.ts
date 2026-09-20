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
//   - The badge is not a control; the row's open behaviour is #427's, now:
//     tapping the PDF link navigates to the fullscreen part viewer, no tab
//     and no byte fetch on this page at all.
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
		fileName: fileId === '' ? '' : `${fileId}.pdf`,
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

	it('the badge is NOT a control, and the row open behaviour is a NAVIGATION to the fullscreen viewer (#427 — no tab, no byte fetch here anymore)', async () => {
		installWire();
		mockWorksRead();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

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

		// Clicking the badge does NOTHING — no tab, no signing, no navigation.
		const before = gotoMock.mock.calls.length;
		await fireEvent.click(badge);
		expect(openSpy).not.toHaveBeenCalled();
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(gotoMock.mock.calls.length).toBe(before);

		// Tapping the row's PDF link navigates to the viewer (#427) — it no
		// longer opens a tab or touches a byte on this page at all.
		const links = container.querySelectorAll('[data-testid="work-link-pdf"]');
		await fireEvent.click(links[0]);
		await waitFor(() => expect(gotoMock.mock.calls.length).toBeGreaterThan(before));
		// #427 review finding 3 — the part's NAME rides the navigation: this
		// page is the only place that has it, the viewer is where the bytes
		// land. Full shape, both arguments.
		expect(gotoMock.mock.calls.slice(before)).toEqual([
			[
				'/part/file-held?db=sampledb',
				{
					state: {
						partLabel: {
							work: 'Spem in alium',
							composer: 'Thomas Tallis',
							edition: 'Vocal score',
							filename: 'file-held.pdf'
						}
					}
				}
			]
		]);
		expect(openSpy).not.toHaveBeenCalled();
	});

	// #351's two eviction-cascade pins (store put evicts a held row / evicts
	// then the write itself rejects) lived here because this page's OWN click
	// used to reach openFileBytes' store.put directly. #427 moved that read
	// (and so every write it can trigger) into the fullscreen part viewer —
	// this page's click is now a bare `goto`, so there is no store write left
	// on THIS surface for a page-reaction test to pin. The eviction
	// arithmetic itself stays covered in byteStore.presence.spec.ts; the
	// "page re-queries presence after its own write" shape these two
	// exercised has no place to live until the viewer (or a return-to-page
	// refresh) grows the same coverage — flagged, not silently dropped.
});

// (*MVOX:Tallis*)
