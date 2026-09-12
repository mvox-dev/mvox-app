// @vitest-environment happy-dom
//
// #343 — the EVENT DETAIL page's PDF open goes through the byte store, and —
// new to this page — a failed open finally SAYS so. Today (branch base) this
// page's handlePdfClick has NO error surface at all: a rejected open is a
// `console.error` and a silently closed tab (zero spec coverage — this file
// is that coverage). The agenda page's #91 idiom is the in-repo reference:
// [data-testid="repertoire-pdf-error"] rendering m.repertoire_pdf_error().
//
// PINNED: the SAME existing key on this page — ZERO new locale keys anywhere
// in this slice (locale-file pin below). Popup-blocker pattern preserved:
// window.open('', '_blank') SYNCHRONOUSLY inside the click, before any await.
//
// INTEGRATION posture (house rule): the REAL route component renders; only
// the wire (global fetch), the works read (loadWorksByEventId — the module
// seam the agenda works-wiring spec uses), signFileUrl, and the
// $lib/files/appByteStore persistence seam are substituted.
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

function makeTab() {
	return { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
}

function renderPage() {
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
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
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('event detail — PDF open through the byte store (#343)', () => {
	it('the tab opens SYNC in the click gesture and receives a blob: URL — never the raw signed url', async () => {
		installWire();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const tab = makeTab();
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const { container } = renderPage();
		await fireEvent.click(await pdfLink(container));

		expect(openSpy).toHaveBeenCalledWith('', '_blank');
		expect(tab.opener).toBeNull();
		await waitFor(() => {
			expect(tab.location.href).toMatch(/^blob:/);
		});
		expect(tab.location.href).not.toContain('s3.example');
		expect(fakeByteStore.heldFor('polyphony', 'person-p')).toEqual(['file-score']);
	});

	it('READ-THROUGH on this page too: a second open signs nothing and fetches nothing', async () => {
		const fetchMock = installWire();
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const tabs = [makeTab(), makeTab()];
		let openCount = 0;
		vi.spyOn(window, 'open').mockImplementation(() => tabs[openCount++] as unknown as Window);

		const { container } = renderPage();
		const link = await pdfLink(container);

		await fireEvent.click(link);
		await waitFor(() => {
			expect(tabs[0].location.href).toMatch(/^blob:/);
		});
		await fireEvent.click(link);
		await waitFor(() => {
			expect(tabs[1].location.href).toMatch(/^blob:/);
		});

		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		const byteGets = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('https://s3.example/'));
		expect(byteGets.length).toBe(1);
	});

	// #343 fix-round — Gama's 1(b) ruling: a byte GET dying after successful
	// signing now falls back to the signed URL already in hand instead of
	// closing the tab with an error (the exact pre-#343 delivery path).
	it('a fetch that fails AFTER successful signing falls back to the RAW signed url — no error surface, tab not closed', async () => {
		installWire({ bytesFail: true });
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const { container } = renderPage();
		await fireEvent.click(await pdfLink(container));

		await waitFor(() => {
			expect(tab.location.href).toBe(SIGNED_URL);
		});
		expect(tab.close).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
		expect(fakeByteStore.heldFor('polyphony', 'person-p')).toEqual([]);
	});

	it('a rejected SIGNING gets the same surface (the case the page used to swallow into console.error)', async () => {
		installWire();
		signFileUrlMock.mockRejectedValue(new Error('403'));
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const { container } = renderPage();
		await fireEvent.click(await pdfLink(container));

		await waitFor(() => {
			expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).not.toBeNull();
		});
		expect(tab.close).toHaveBeenCalled();
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
