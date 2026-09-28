// @vitest-environment happy-dom
//
// #434 slice 4/6 RED — the LIBRARY offline ("Offline, last seen data").
//
// CONTRACT (team-lead shared design, fixed for all six slices; slice-4 shape
// defined HERE, implemented in GREEN):
//
//   src/lib/library/libraryData.ts — SHARED readers (the librarian's pickers,
//     the post-write re-reads, the my-loans chain), so none hard-wires a flag
//     (slice 2 review round, finding 2). Each of listWorks, listLendings,
//     listEditions, listCopies and resolveBorrowerNames gains a trailing
//     `opts: EntuFetchOptions = {}` and threads it into EVERY read it makes:
//     resolveBorrowerNames -> each member's `entity/{id}?props=person` read ->
//     listMyProfiles(cfg, personId, fetchImpl, opts), and the real-names overlay
//     resolveRealNameByPerson(cfg, fetchImpl, opts). A lending row that comes
//     back offline naming its borrower by her profile name while the online
//     visit showed her record name is a stored copy rendered WRONG.
//
//   src/lib/library/libraryPageData.ts (NEW — the screen's own entry points,
//     the role agendaData.loadFullAgenda / eventPageData play for slices 2-3;
//     the ONE new file allowed to name the flags, readCache.optin-fence.spec.ts)
//     composing libraryData's OWN exported readers (so existing page specs that
//     mock `$lib/library/libraryData` keep working):
//       loadLibraryListing(cfg, fetchImpl = fetch)
//         -> { works: ListRead<Work>, lendings: ListRead<Lending>,
//              borrowerNames: Map<string, string> }   — CACHED_READ
//         (borrowerNames = resolveBorrowerNames over the ACTIVE lendings'
//          member ids, exactly what the page's load computes today)
//       loadLibraryEditions(cfg, workId, fetchImpl = fetch)    — CACHED_READ
//       loadLibraryCopies(cfg, editionId, fetchImpl = fetch)   — CACHED_READ
//       refreshLibraryLendings(cfg, fetchImpl = fetch)
//         -> { lendings, borrowerNames } — CACHED_READ_STORE_ONLY, for the
//         page's three post-write re-reads (inline checkout, return, bulk
//         checkout): the live answer or a rejection, never a stored copy, but
//         the stored copy moves past the write (slice 3 review round, finding 2).
//
//   src/routes/library/+page.svelte
//     - the routeLoad `load` body calls resetServedFromCache() FIRST, before
//       any cached read starts (readCache's load-epoch guard drops a stamp
//       from a read that began before the reset), then loads through
//       loadLibraryListing; work/edition expansion loads through
//       loadLibraryEditions / loadLibraryCopies.
//     - when $servedFromCache is non-null it renders the ONE shared line:
//       <AsOfLine readAt={$servedFromCache} testid="library-as-of" ... />
//       — never a copy of its markup. No new message key (last_read_as_of).
//     - offline its fire-and-forget side reads (findMyMemberId for my-loans,
//       resolveLibrarian, repertoire badges) reject; none may escape as an
//       unhandled rejection or take the listing down.
//     - with NOTHING cached, offline stays what it is today: library-load-error
//       (routeLoad's classification), no as-of line.
//
// INTEGRATION, NOT ISOLATION: nothing between the page and `fetch` is mocked —
// the REAL hydrateCollectives -> discoverCollectives (cached since slice 2),
// the REAL libraryData readers -> entuFetch -> readCache over fake-indexeddb.
// Only `globalThis.fetch` is stubbed: an online router, then a stub rejecting
// every call.
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

const DB = 'sampledb';
const PERSON = 'person-1';
const DB_ENTITY = 'db-entity-1';

// The borrower: member m-2 -> person p-2. Her PROFILE name and her RECORD name
// differ, and roster_show_real_names is ON — so the lent-copy row names her by
// the record name only if the real-names overlay's reads were cached too.
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

// A fixed "today" (only Date is faked — IndexedDB and waitFor keep real timers).
// 07:05Z is 10:05 in Tallinn (EEST), so the as-of time is unmistakable.
const READ_AT = new Date('2026-09-28T07:05:00.000Z');
const LATER_SAME_DAY = new Date('2026-09-28T09:40:00.000Z');
const NEXT_DAY = new Date('2026-09-29T08:00:00.000Z');

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** The online Entu: discovery (slice 2's fixture) plus the library's reads.
 *  Everything else answers empty. */
function onlineEntu() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=mvox_collective')) {
			return json({ count: 1, entities: [{ _id: 'marker-1', name: [{ string: 'Sample Choir' }] }] });
		}
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: DB_ENTITY }] });
		}
		if (url.includes(`entity/${DB_ENTITY}?`) && url.includes('roster_show_real_names')) {
			return json({ entity: { _id: DB_ENTITY, roster_show_real_names: [{ boolean: true }] } });
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
			});
		}
		if (url.includes('_type.string=work&')) {
			return json({
				count: WORKS.length,
				entities: WORKS.map((w) => ({
					_id: w.id,
					name: [{ string: w.name }],
					composer: [{ string: w.composer }]
				}))
			});
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
			});
		}
		// #434 slice 4 review round, finding 2 — the my-loans chain, for the
		// describe block below whose SIGNED-IN person IS the borrower: her own
		// active member row, then copy -> edition -> work for the row's label.
		if (
			url.includes('_type.string=member&') &&
			url.includes(`person.reference=${BORROWER_PERSON}`)
		) {
			return json({ count: 1, entities: [{ _id: BORROWER_MEMBER }] });
		}
		if (url.includes(`entity/${COPY.id}?props=name,copy_number`)) {
			return json({ entity: { _id: COPY.id, copy_number: [{ number: COPY.copyNumber }] } });
		}
		if (url.includes(`entity/${COPY.id}?props=copy_number,_parent`)) {
			return json({
				entity: {
					_id: COPY.id,
					copy_number: [{ number: COPY.copyNumber }],
					_parent: [{ reference: EDITION.id, entity_type: 'edition' }]
				}
			});
		}
		if (url.includes(`entity/${EDITION.id}?props=name,_parent`)) {
			return json({
				entity: {
					_id: EDITION.id,
					name: [{ string: EDITION.name }],
					_parent: [{ reference: WORKS[0].id, entity_type: 'work' }]
				}
			});
		}
		if (url.includes(`entity/${BORROWER_MEMBER}?props=person`)) {
			return json({ entity: { _id: BORROWER_MEMBER, person: [{ reference: BORROWER_PERSON }] } });
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
			});
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
			});
		}
		if (url.includes('_type.string=copy&') && url.includes(`_parent.reference=${EDITION.id}`)) {
			return json({
				count: 1,
				entities: [{ _id: COPY.id, copy_number: [{ number: COPY.copyNumber }] }]
			});
		}
		return json({ count: 0, entities: [] });
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
	// #434 slice 4 review round, finding 1 — a restored screen claims NO
	// failure. The first cut passed this helper offline while rendering a red
	// `librarian-load-error` alert beside the restored work list, because
	// `resolveLibrarian`'s three reads were uncached and it maps any throw to
	// `state: 'error'`. `library-load-error` alone missed it; every alert on a
	// restored screen is the assertion that catches the next one too.
	const alert = container.querySelector('[role="alert"]');
	expect(alert, `unexpected alert: ${alert?.getAttribute('data-testid') ?? alert?.textContent}`).toBeNull();
}

/** Expand work w-1 -> edition e-1 and wait for the LENT copy row, which names
 *  its borrower through the whole lendings -> member -> profile -> real-names
 *  chain. Returns the copy row. */
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

/** Resolves once the online stub has been asked for a path matching `needle` —
 *  how a FIRE-AND-FORGET side read (the librarian resolution, the my-loans
 *  chain) is waited for before the cache is drained. Without it `onlineVisit`
 *  can flush before those puts are even started, and the offline half then
 *  tests an empty cache rather than the page. */
async function awaitRead(stub: ReturnType<typeof onlineEntu>, needle: string) {
	await waitFor(() => {
		expect(
			stub.mock.calls.some(([input]) => urlOf(input as RequestInfo | URL).includes(needle)),
			`online read matching ${needle}`
		).toBe(true);
	});
}

/** One full online visit: listing + the lent copy opened, then the cache
 *  writes drained and the page unmounted. */
async function onlineVisit() {
	const stub = onlineEntu();
	vi.stubGlobal('fetch', stub);
	const first = await openLibrary();
	await expectListing(first.container);
	await expandToLentCopy(first.container);
	// The librarian resolution is fire-and-forget (#434 slice 4 review round,
	// finding 1): its three reads have to be STORED for the offline visit to
	// restore the state instead of alerting.
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
		// Editions + copies (expansion reads), lendings (availability), member ->
		// profile (borrower name) and the real-names overlay (record name, not
		// the profile name) — every read behind this row was cached.
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
	// The signed-in person IS the borrower of copy c-1 here. The default fixture
	// person is not, so my-loans is absent online AND offline there — which is
	// exactly why the section silently vanishing offline went unnoticed: the
	// member-id read, the copy-name read and the copy -> edition -> work chain
	// read were all uncached.
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

describe('#434 slice 4 — the page is wired through its own entry points', () => {
	const page = readFileSync(resolve(process.cwd(), 'src/routes/library/+page.svelte'), 'utf-8');

	it('renders the ONE shared as-of line, never a copy of it', () => {
		expect(page).toContain("import AsOfLine from '$lib/components/offline/AsOfLine.svelte'");
		expect(page).toContain('<AsOfLine readAt={$servedFromCache} testid="library-as-of"');
		expect(page).toContain('resetServedFromCache()');
	});

	it('loads through libraryPageData, not the shared readers directly', () => {
		expect(page).toContain("from '$lib/library/libraryPageData'");
		expect(page).toContain('loadLibraryListing(');
		expect(page).toContain('loadLibraryEditions(');
		expect(page).toContain('loadLibraryCopies(');
		expect(page).not.toMatch(/\blistWorks\(/);
		expect(page).not.toMatch(/\blistEditions\(/);
		expect(page).not.toMatch(/\blistCopies\(/);
	});

	it('the librarian state and the my-loans chain load through libraryPageData too', () => {
		// #434 slice 4 review round, findings 1 and 2 — a red
		// `librarian-load-error` beside a restored listing, and a my-loans
		// section that silently vanishes, are both a reader the page reached
		// past its own entry points.
		expect(page).toContain('loadLibrarianState(');
		expect(page).toContain('loadMyMemberId(');
		expect(page).toContain('loadMyLoanCopyNames(');
		expect(page).toContain('loadMyLoanCopyChains(');
		expect(page).not.toMatch(/\bresolveLibrarian\(/);
		expect(page).not.toMatch(/\bfindMyMemberId\(/);
		expect(page).not.toMatch(/\bresolveCopyNames\(/);
		expect(page).not.toMatch(/\bresolveCopyChains\(/);
	});

	it('the three post-write lending re-reads store without serving (refreshLibraryLendings)', () => {
		// Inline checkout, return and bulk checkout each re-read the lendings
		// after the write lands. A cache-SERVED re-read could show the
		// pre-write availability; an uncached one leaves the stored copy behind
		// the write. Store-only is the one that does neither.
		expect(page.match(/refreshLibraryLendings\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
		expect(page).not.toMatch(/\blistLendings\(/);
	});
});

// (*MVOX:Tallis* — #434 slice 4/6 RED)
// (*MVOX:Josquin* — #434 slice 4 review round, findings 1 and 2)
