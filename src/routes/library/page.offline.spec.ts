// @vitest-environment happy-dom
// #434: the library offline shows the last seen data; only `globalThis.fetch` is stubbed, the
// real readers run through readCache over fake-indexeddb.
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { msgProxy } = vi.hoisted(() => ({
	msgProxy: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_t, key) => (params?: Record<string, unknown>) =>
			params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/messages.js', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/messages', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/runtime', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk'],
	overwriteGetLocale: vi.fn()
}));
vi.mock('$lib/paraglide/runtime.js', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk'],
	overwriteGetLocale: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/library')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import LibraryPage from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache, resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { isoDateFormatter, tallinnHHMM } from '$lib/preferences/timeFormat';
import { json } from '$lib/testing/entuFetchKit';

const DB = 'sampledb';
const PERSON = 'person-1';
const DB_ENTITY = 'db-entity-1';
const LIBRARY = 'lib-1';

// Profile and record names differ with real names on, so the row names her by the record name
// only if the real-names reads were cached too.
const BORROWER_MEMBER = 'm-2';
const BORROWER_PERSON = 'p-2';
const PROFILE_NAME = 'Liisa Laulja';
const RECORD_NAME = 'Liisa Päris';

const WORKS = [
	{ id: 'w-1', name: 'Messa di Gloria', composer: 'Puccini' },
	{ id: 'w-2', name: 'Stabat Mater', composer: 'Pergolesi' }
];
const EDITION = { id: 'e-1', name: 'Carus 2019', publisher: 'Carus' };
const COPY = { id: 'c-1', copyNumber: 3 };

// Only Date is faked. 07:05Z is 10:05 in Tallinn (EEST), so the as-of time is unmistakable.
const READ_AT = new Date('2026-09-28T07:05:00.000Z');
const LATER_SAME_DAY = new Date('2026-09-28T09:40:00.000Z');
const NEXT_DAY = new Date('2026-09-29T08:00:00.000Z');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** The online Entu: discovery plus the library's reads; everything else answers empty. Without
  * `librarianPerson` as the library's `_owner`, every viewer resolves to not-librarian. */
function onlineEntu(opts: { librarianPerson?: string } = {}) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=library&')) {
			return json(
				opts.librarianPerson ? { count: 1, entities: [{ _id: LIBRARY }] } : { count: 0, entities: [] }
			, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${LIBRARY}?props=_owner,_editor`)) {
			return json({
				entity: { _id: LIBRARY, _owner: [{ reference: opts.librarianPerson ?? '' }] }
			}, 200, JSON_HEADERS);
		}
		// The librarian panel's three collective-wide feeds, distinct from the per-node reads below.
		if (url.includes('_type.string=edition&props=')) {
			return json({
				count: 1,
				entities: [
					{
						_id: EDITION.id,
						name: [{ string: EDITION.name }],
						publisher: [{ string: EDITION.publisher }],
						_parent: [{ reference: WORKS[0].id, entity_type: 'work' }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=copy&props=')) {
			return json({
				count: 1,
				entities: [
					{
						_id: COPY.id,
						copy_number: [{ number: COPY.copyNumber }],
						_parent: [{ reference: EDITION.id, entity_type: 'edition' }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=member&status.string=active')) {
			return json({
				count: 1,
				entities: [{ _id: BORROWER_MEMBER, person: [{ reference: BORROWER_PERSON }] }]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=mvox_collective')) {
			return json(
				{ count: 1, entities: [{ _id: 'marker-1', name: [{ string: 'Sample Choir' }] }] },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: DB_ENTITY }] }, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${DB_ENTITY}?`) && url.includes('roster_show_real_names')) {
			return json(
				{ entity: { _id: DB_ENTITY, roster_show_real_names: [{ boolean: true }] } },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes('_type.string=admin_member_record')) {
			return json({
				count: 1,
				entities: [
					{
						_id: 'rec-2',
						person: [{ reference: BORROWER_PERSON }],
						name: [{ string: RECORD_NAME }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=work&')) {
			return json({
				count: WORKS.length,
				entities: WORKS.map((w) => ({
					_id: w.id,
					name: [{ string: w.name }],
					composer: [{ string: w.composer }]
				}))
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=lending&')) {
			return json({
				count: 1,
				entities: [
					{
						_id: 'l-1',
						copy: [{ reference: COPY.id }],
						member: [{ reference: BORROWER_MEMBER }],
						assigned_at: [{ date: '2026-09-01' }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		// The my-loans chain, for the describe block whose signed-in person is the borrower.
		if (
			url.includes('_type.string=member&') &&
			url.includes(`person.reference=${BORROWER_PERSON}`)
		) {
			return json({ count: 1, entities: [{ _id: BORROWER_MEMBER }] }, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${COPY.id}?props=name,copy_number`)) {
			return json(
				{ entity: { _id: COPY.id, copy_number: [{ number: COPY.copyNumber }] } },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes(`entity/${COPY.id}?props=copy_number,_parent`)) {
			return json({
				entity: {
					_id: COPY.id,
					copy_number: [{ number: COPY.copyNumber }],
					_parent: [{ reference: EDITION.id, entity_type: 'edition' }]
				}
			}, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${EDITION.id}?props=name,_parent`)) {
			return json({
				entity: {
					_id: EDITION.id,
					name: [{ string: EDITION.name }],
					_parent: [{ reference: WORKS[0].id, entity_type: 'work' }]
				}
			}, 200, JSON_HEADERS);
		}
		if (url.includes(`entity/${BORROWER_MEMBER}?props=person`)) {
			return json(
				{ entity: { _id: BORROWER_MEMBER, person: [{ reference: BORROWER_PERSON }] } },
				200,
				JSON_HEADERS
			);
		}
		if (
			url.includes('_type.string=profile') &&
			url.includes(`_parent.reference=${BORROWER_PERSON}`)
		) {
			return json({
				count: 1,
				entities: [
					{ _id: 'prof-2', name: [{ string: PROFILE_NAME }], _sharing: [{ string: 'domain' }] }
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=edition&') && url.includes(`_parent.reference=${WORKS[0].id}`)) {
			return json({
				count: 1,
				entities: [
					{
						_id: EDITION.id,
						name: [{ string: EDITION.name }],
						publisher: [{ string: EDITION.publisher }]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=copy&') && url.includes(`_parent.reference=${EDITION.id}`)) {
			return json({
				count: 1,
				entities: [{ _id: COPY.id, copy_number: [{ number: COPY.copyNumber }] }]
			}, 200, JSON_HEADERS);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
	});
}

function offlineEntu() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

/** Discovery through the store's own entry point, then mount /library. */
async function openLibrary() {
	collectiveState.set({ status: 'loading' });
	await hydrateCollectives();
	return render(LibraryPage);
}

async function expectListing(container: HTMLElement) {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="library-work-list"]'), 'library-work-list').not.toBeNull();
		for (const w of WORKS) {
			const row = container.querySelector(`[data-testid="library-work-${w.id}"]`);
			expect(row, `library-work-${w.id}`).not.toBeNull();
			expect(row!.textContent).toContain(w.name);
			expect(row!.textContent).toContain(w.composer);
		}
	});
	expect(container.querySelector('[data-testid="library-load-error"]')).toBeNull();
	// A restored screen claims no failure: every alert on it is the assertion, not just
	// `library-load-error`.
	const alert = container.querySelector('[role="alert"]');
	expect(alert, `unexpected alert: ${alert?.getAttribute('data-testid') ?? alert?.textContent}`).toBeNull();
}

/** Expand work w-1 -> edition e-1 and wait for the lent copy row, named through the whole
  * lendings -> member -> profile -> real-names chain. */
async function expandToLentCopy(container: HTMLElement): Promise<Element> {
	const workToggle = await waitFor(() => {
		const el = container.querySelector(`[data-testid="library-work-toggle-${WORKS[0].id}"]`);
		expect(el, 'work toggle').not.toBeNull();
		return el!;
	});
	await fireEvent.click(workToggle);
	const editionToggle = await waitFor(() => {
		const el = container.querySelector(`[data-testid="library-edition-toggle-${EDITION.id}"]`);
		expect(el, `library-edition-toggle-${EDITION.id}`).not.toBeNull();
		return el!;
	});
	expect(container.querySelector(`[data-testid="library-edition-${EDITION.id}"]`)!.textContent).toContain(
		EDITION.name
	);
	await fireEvent.click(editionToggle);
	return waitFor(() => {
		const el = container.querySelector(`[data-testid="library-copy-${COPY.id}"]`);
		expect(el, `library-copy-${COPY.id}`).not.toBeNull();
		expect(el!.textContent).toContain(RECORD_NAME);
		return el!;
	});
}

async function asOfLine(container: HTMLElement): Promise<Element> {
	return waitFor(() => {
		const el = container.querySelector('[data-testid="library-as-of"]');
		expect(el, 'library-as-of').not.toBeNull();
		return el!;
	});
}

/** Resolves once the online stub was asked for `needle`, so a fire-and-forget side read is
  * stored before the cache is drained. */
async function awaitRead(stub: ReturnType<typeof onlineEntu>, needle: string) {
	await waitFor(() => {
		expect(
			stub.mock.calls.some(([input]) => urlOf(input as RequestInfo | URL).includes(needle)),
			`online read matching ${needle}`
		).toBe(true);
	});
}

/** One full online visit: listing + the lent copy opened, cache drained, page unmounted. */
async function onlineVisit() {
	const stub = onlineEntu();
	vi.stubGlobal('fetch', stub);
	const first = await openLibrary();
	await expectListing(first.container);
	await expandToLentCopy(first.container);
	// The librarian resolution is fire-and-forget; its reads must be stored for the offline
	// visit to restore the state instead of alerting.
	await awaitRead(stub, '_type.string=library&');
	await flushReadCache();
	cleanup();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: READ_AT });
	setReadCacheFactory(new IDBFactory());
	// #343's part byte store (file presence badges) opens the global
	// IndexedDB — a separate, fresh one.
	vi.stubGlobal('indexedDB', new IDBFactory());
	resetServedFromCache();
	localStorage.clear();
	setToken('tok-1');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: READ_AT.getTime() + 48 * 3_600_000
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	clearAll({ preserveProvider: false });
	setReadCacheFactory(undefined);
	collectiveState.set({ status: 'loading' });
});

describe('#434 slice 4 — the library renders offline from the read cache', () => {
	it('an online visit shows the listing and NO as-of line', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		const copy = await expandToLentCopy(container);
		expect(copy.textContent).toContain(RECORD_NAME);
		expect(container.querySelector('[data-testid="library-as-of"]')).toBeNull();
	});

	it('online visit, then every fetch rejecting: the same listing, plus "as of" the stored read time', async () => {
		await onlineVisit();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);

		const asOf = await asOfLine(container);
		// The STORED read's time (10:05 Tallinn), not the offline visit's (12:40).
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		expect(asOf.textContent).not.toContain(tallinnHHMM(LATER_SAME_DAY));
		// Same day: no date alongside it.
		expect(asOf.textContent).not.toContain(isoDateFormatter('Europe/Tallinn').format(READ_AT));
		// The one shared line, with the renamed key.
		expect(asOf.textContent).toContain('last_read_as_of');
	});

	it('offline, the opened work and edition expand from the cache, and the lent copy names its borrower as online did', async () => {
		await onlineVisit();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		// Every read behind this row was cached: expansions, lendings, member -> profile and the
		// real-names overlay (record name, not profile name).
		const copy = await expandToLentCopy(container);
		expect(copy.textContent).toContain(RECORD_NAME);
		expect(copy.textContent).not.toContain(PROFILE_NAME);
		expect(container.querySelector(`[data-testid="library-work-toggle-${WORKS[0].id}"]`)).not.toBeNull();
		await asOfLine(container);
	});

	it('a stored read from an EARLIER day carries its date as well as its time', async () => {
		await onlineVisit();

		vi.setSystemTime(NEXT_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		const asOf = await asOfLine(container);
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		expect(asOf.textContent).toContain(isoDateFormatter('Europe/Tallinn').format(READ_AT));
	});

	it('a later ONLINE visit after an offline one shows no as-of line (reset at load start)', async () => {
		await onlineVisit();

		vi.stubGlobal('fetch', offlineEntu());
		const second = await openLibrary();
		await asOfLine(second.container);
		cleanup();

		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		expect(container.querySelector('[data-testid="library-as-of"]')).toBeNull();
	});

	it('with NOTHING cached, offline still fails legibly: library-load-error, no listing, no as-of', async () => {
		// Discovery alone is warmed (so the page has a collective and reaches its
		// own load); the library's reads were never made online.
		vi.stubGlobal('fetch', onlineEntu());
		collectiveState.set({ status: 'loading' });
		await hydrateCollectives();
		await flushReadCache();

		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-load-error"]'), 'library-load-error').not.toBeNull();
		});
		expect(container.querySelector('[data-testid="library-work-list"]')).toBeNull();
		expect(container.querySelector('[data-testid="library-as-of"]')).toBeNull();
	});
});

describe('#434 slice 4 review round, finding 2 — the borrower sees her OWN loans offline', () => {
	// The signed-in person is the borrower of copy c-1 here, so the my-loans reads are exercised;
	// with the default person the section is absent online too.
	beforeEach(() => {
		authStore.set({
			status: 'authenticated',
			personIdByDb: { [DB]: BORROWER_PERSON },
			expMs: READ_AT.getTime() + 48 * 3_600_000
		});
	});

	/** Expand the my-loans section and wait for the one active loan's row. */
	async function openMyLoans(container: HTMLElement): Promise<Element> {
		const toggle = await waitFor(() => {
			const el = container.querySelector('[data-testid="my-loans-toggle"]');
			expect(el, 'my-loans-toggle').not.toBeNull();
			return el!;
		});
		await fireEvent.click(toggle);
		return waitFor(() => {
			const row = container.querySelector('[data-testid="my-loans-item-l-1"]');
			expect(row, 'my-loans-item-l-1').not.toBeNull();
			// The FULL label: copy number, work and edition — the copy read plus
			// the edition read behind it.
			expect(row!.textContent, 'my-loans row label').toContain(
				`Copy #${COPY.copyNumber} — ${WORKS[0].name} / ${EDITION.name}`
			);
			return row!;
		});
	}

	it('online her loan row is labelled by copy, work and edition', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		await openMyLoans(container);
		expect(container.querySelector('[data-testid="library-as-of"]')).toBeNull();
	});

	it('offline the section is still on screen, with the same labels and an as-of line', async () => {
		const stub = onlineEntu();
		vi.stubGlobal('fetch', stub);
		const first = await openLibrary();
		await expectListing(first.container);
		await openMyLoans(first.container);
		await awaitRead(stub, '_type.string=library&');
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		await openMyLoans(container);
		await asOfLine(container);
	});
});

describe('#434 slice 4 review round 2, finding 1 — a LIBRARIAN sees her panel offline, not an alert', () => {
	// The signed-in person owns the collective's library, so the feeds gated behind 'librarian'
	// are exercised; `expectListing`'s no-alert assertion catches an uncached one.
	function librarianEntu() {
		return onlineEntu({ librarianPerson: PERSON });
	}

	/** Wait for the librarian panel and the availability counter, which is derived from the
	 *  picker feeds and so only shows if they landed. */
	async function expectLibrarianPanel(container: HTMLElement) {
		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]'), 'librarian-tools').not.toBeNull();
			expect(
				container.querySelector('[data-testid="bulk-checkout-work-select"]'),
				'bulk-checkout-work-select'
			).not.toBeNull();
		});
		// FULL shape: `total: 1` is edition e-1's one copy, seen only through the
		// picker feeds; `available: 0` is that copy lent out to m-2.
		const row = container.querySelector(`[data-testid="library-work-${WORKS[0].id}"]`);
		expect(row!.textContent, 'availability counter off the picker feeds').toContain(
			'library_work_availability {"available":0,"total":1}'
		);
		expect(container.querySelector('[data-testid="librarian-load-error"]')).toBeNull();
	}

	/** One full online visit as the librarian, every panel read drained into the cache. */
	async function librarianOnlineVisit() {
		const stub = librarianEntu();
		vi.stubGlobal('fetch', stub);
		const first = await openLibrary();
		await expectListing(first.container);
		await expectLibrarianPanel(first.container);
		await awaitRead(stub, '_type.string=member&status.string=active');
		await flushReadCache();
		cleanup();
	}

	it('online the librarian panel is on screen, with no alert and no as-of line', async () => {
		vi.stubGlobal('fetch', librarianEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		await expectLibrarianPanel(container);
		expect(container.querySelector('[data-testid="library-as-of"]')).toBeNull();
	});

	it('offline the panel is restored from the last-seen feeds — no librarian-load-error, and an as-of line', async () => {
		await librarianOnlineVisit();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		await expectLibrarianPanel(container);
		const asOf = await asOfLine(container);
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
	});

	it('offline the bulk-checkout member picker still names its members', async () => {
		await librarianOnlineVisit();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		await expectLibrarianPanel(container);
		await fireEvent.change(container.querySelector('[data-testid="bulk-checkout-work-select"]')!, {
			target: { value: WORKS[0].id }
		});
		await fireEvent.change(
			await waitFor(() => {
				const el = container.querySelector('[data-testid="bulk-checkout-edition-select"]');
				expect(el, 'bulk-checkout-edition-select').not.toBeNull();
				return el!;
			}),
			{ target: { value: EDITION.id } }
		);
		const list = await waitFor(() => {
			const el = container.querySelector('[data-testid="bulk-checkout-member-list"]');
			expect(el, 'bulk-checkout-member-list').not.toBeNull();
			return el!;
		});
		// The real-names overlay's answer; the name map resolves fire-and-forget, so wait for it.
		await waitFor(() => {
			expect(list.textContent, 'bulk-checkout member name').toContain(RECORD_NAME);
		});
		expect(list.textContent).not.toContain('library_borrower_unknown');
	});

	it('with NOTHING cached, offline the librarian panel still fails legibly rather than claiming a state', async () => {
		// Discovery alone warmed: the page reaches its own load, the listing
		// fails, and there is no last-seen librarian answer to restore either.
		vi.stubGlobal('fetch', librarianEntu());
		collectiveState.set({ status: 'loading' });
		await hydrateCollectives();
		await flushReadCache();

		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-load-error"]'), 'library-load-error').not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')).toBeNull();
	});
});

describe('#434 slice 4 — the page is wired through its own entry points', () => {
	const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
	const page = read('src/routes/library/+page.svelte');
	const loads = read('src/lib/library/libraryPageLoads.ts');
	const writes = read('src/lib/library/libraryPageWrites.ts');
	const all = [page, loads, writes];

	it('renders the ONE shared as-of line, never a copy of it', () => {
		expect(page).toContain("import AsOfLine from '$lib/components/offline/AsOfLine.svelte'");
		expect(page).toContain('<AsOfLine readAt={$servedFromCache} testid="library-as-of"');
		expect(page).toContain('resetServedFromCache()');
	});

	it('loads through libraryPageData, not the shared readers directly', () => {
		expect(page).toContain("from '$lib/library/libraryPageData'");
		expect(loads).toContain("from '$lib/library/libraryPageData'");
		expect(page).toContain('loadLibraryListing(');
		expect(loads).toContain('loadLibraryEditions(');
		expect(loads).toContain('loadLibraryCopies(');
		for (const source of all) {
			expect(source).not.toMatch(/\blistWorks\(/);
			expect(source).not.toMatch(/\blistEditions\(/);
			expect(source).not.toMatch(/\blistCopies\(/);
		}
	});

	it('the librarian state and the my-loans chain load through libraryPageData too', () => {
		// A red `librarian-load-error` beside a restored listing, or a vanishing my-loans section,
		// is a reader the page reached past its own entry points.
		expect(loads).toContain('loadLibrarianState(');
		expect(page).toContain('loadMyMemberId(');
		expect(page).toContain('loadMyLoanCopyNames(');
		expect(page).toContain('loadMyLoanCopyChains(');
		for (const source of all) {
			expect(source).not.toMatch(/\bresolveLibrarian\(/);
			expect(source).not.toMatch(/\bfindMyMemberId\(/);
			expect(source).not.toMatch(/\bresolveCopyNames\(/);
			expect(source).not.toMatch(/\bresolveCopyChains\(/);
		}
	});

	it('the librarian panel feeds load through libraryPageData too (review round 2, finding 1)', () => {
		expect(loads).toContain('loadLibrarianPickers(');
		expect(loads).toContain('loadLibrarianMemberNames(');
		for (const source of all) {
			expect(source).not.toMatch(/\blistAllEditions\(/);
			expect(source).not.toMatch(/\blistAllCopies\(/);
			expect(source).not.toMatch(/\blistActiveMembers\(/);
			expect(source).not.toMatch(/\bresolveBorrowerNames\(/);
		}
		// One path serves the mount effect and the retry.
		const pickerCalls = all.map((source) => source.match(/loadLibrarianPickers\(/g)?.length ?? 0);
		expect(pickerCalls).toEqual([0, 1, 0]);
	});

	it('every write resolves its own `_parent` LIVE (review round 2, finding 2)', () => {
		// `loadLibrarianState` is cache-backed and a GET inside a write may not be, so the three
		// write paths resolve the parent through the flag-free `resolveWriteLibraryId`.
		expect(writes).toContain("resolveWriteLibraryId");
		expect(writes.match(/await resolveWriteLibraryId\(cfg\)/g)?.length ?? 0).toBe(1);
		expect(writes.match(/await requireWriteLibraryId\(cfg, /g)?.length ?? 0).toBe(3);
		for (const source of all) expect(source).not.toMatch(/\$libraryEntityIdStore/);
	});

	it('the three post-write lending re-reads store without serving (refreshLibraryLendings)', () => {
		// Post-write lending re-reads: a served copy could show pre-write availability, an uncached
		// one leaves the stored copy behind. Store-only does neither.
		expect(writes.match(/refreshLibraryLendings\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
		expect(writes.match(/await refreshLendings\(cfg\)/g)?.length ?? 0).toBe(3);
		for (const source of all) expect(source).not.toMatch(/\blistLendings\(/);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
