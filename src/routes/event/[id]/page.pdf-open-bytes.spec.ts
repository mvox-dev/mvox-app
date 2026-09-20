// @vitest-environment happy-dom
//
// #343 established: this page's PDF open reads THROUGH the byte store.
// #427 moves the consumption: the click no longer opens a blank tab and
// navigates it to a blob: URL — it is a plain in-app navigation to the
// fullscreen part viewer, /part/<fileId>?db=<db>, and THE VIEWER runs the
// openFileBytes read-through (see src/routes/part/page.part-viewer.spec.ts).
// The old popup-blocker dance (window.open('', '_blank') sync in the click)
// existed to survive an async gap before a cross-document navigation; an
// in-app goto has no such gap and must open no tab at all.
//
// INTEGRATION posture (house rule): the REAL route component renders; only
// the wire (global fetch), the works read (loadWorksByEventId — the module
// seam the agenda works-wiring spec uses), signFileUrl, and the
// $lib/files/appByteStore persistence seam are substituted — kept in place
// precisely to pin that the click TOUCHES NONE OF THEM anymore.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

const SIGNED_URL = 'https://s3.example/signed-ev?X-Amz-Expires=60';
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/** Reads only: the event + its season; every other side read answers empty.
 *  The signed-URL GET serves bytes unless `bytesFail` says otherwise. */
function installWire(opts: { bytesFail?: boolean } = {}) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.startsWith('https://s3.example/')) {
			if (opts.bytesFail) throw new TypeError('Failed to fetch');
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

function workRowFixture() {
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
		fileId: 'file-score',
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
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
	loadWorksByEventIdMock.mockResolvedValue({ ev1: [workRowFixture()] });
	return render(Page);
}

async function pdfLink(container: HTMLElement): Promise<Element> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="work-link-pdf"]')).not.toBeNull();
	});
	return container.querySelector('[data-testid="work-link-pdf"]')!;
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
	gotoMock.mockReset();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#427 — the PDF affordance navigates to the in-app part viewer', () => {
	// The pre-#427 delivery (blank tab + blob URL) is GONE from this
	// handler. The byte-store substitution harness above STAYS — it is
	// exactly what proves the click no longer touches any of it.
	it('click → goto(/part/<fileId>?db=<db>) — full shape on the emitted call — and NO tab opens', async () => {
		installWire();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		const { container } = renderPage();
		const link = await pdfLink(container);
		const before = gotoMock.mock.calls.length;
		await fireEvent.click(link);

		await waitFor(() => expect(gotoMock.mock.calls.length).toBeGreaterThan(before));
		expect(gotoMock.mock.calls.slice(before)).toEqual([['/part/file-score?db=sampledb']]);
		expect(openSpy).not.toHaveBeenCalled();
	});

	it('the click moves NO bytes: no signing, no byte GET, no store write — the viewer route owns the read', async () => {
		const fetchMock = installWire();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		vi.spyOn(window, 'open').mockImplementation(() => null);

		const { container } = renderPage();
		const link = await pdfLink(container);
		const before = gotoMock.mock.calls.length;
		await fireEvent.click(link);
		await waitFor(() => expect(gotoMock.mock.calls.length).toBeGreaterThan(before));

		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(
			fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('https://s3.example/'))
		).toEqual([]);
		expect(fakeByteStore.heldFor('sampledb', 'person-p')).toEqual([]);
	});
});

describe('#343 — zero new locale keys (pinned)', () => {
	const localeFiles = ['en', 'et', 'lv', 'uk'] as const;

	it('the existing keys this slice reuses are present in all four locales', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				// The works-write-failure precedent: cwd-relative, not
				// import.meta.url — the [id] segment breaks URL resolution.
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			expect(messages['repertoire_pdf_error'], locale).toBeTruthy();
			expect(messages['library_edition_file_open_error'], locale).toBeTruthy();
		}
	});

	it('no byte-store/offline/cache key was added — the slice ships on existing strings alone', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			const offenders = Object.keys(messages).filter((k) => /offline|cache|byte_store|bytestore/i.test(k));
			expect(offenders, locale).toEqual([]);
		}
	});
});

// (*MVOX:Tallis*)
