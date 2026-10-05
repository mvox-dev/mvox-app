// @vitest-environment happy-dom
// #434: the library offline shows the last seen data; only `globalThis.fetch` is stubbed, the
// real readers run through readCache over fake-indexeddb.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () => (await import('$lib/testing/messageMocks')).echoMessages());
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/library')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import LibraryPage from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache, resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { isoDateFormatter, tallinnHHMM } from '$lib/preferences/timeFormat';
import { json } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import {
	DB,
	DB_ENTITY,
	JSON_HEADERS,
	LATER_SAME_DAY,
	PERSON,
	READ_AT,
	offlineEntu,
	seedOfflineSession,
	urlOf
} from '$lib/testing/pages/event';

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

const NEXT_DAY = new Date('2026-09-29T08:00:00.000Z');

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

beforeEach(seedOfflineSession);

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetAppState();
	setReadCacheFactory(undefined);
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
	it('offline a loan whose edition never answered still carries its stored copy name', async () => {
		const live = onlineEntu();
		const noEdition = vi.fn(async (input: RequestInfo | URL) =>
			urlOf(input).includes(`entity/${EDITION.id}?props=name,_parent`)
				? json({ message: 'boom' }, 500, JSON_HEADERS)
				: live(input)
		);
		vi.stubGlobal('fetch', noEdition);
		const first = await openLibrary();
		await expectListing(first.container);
		await fireEvent.click(
			await waitFor(() => {
				const el = first.container.querySelector('[data-testid="my-loans-toggle"]');
				expect(el, 'my-loans-toggle').not.toBeNull();
				return el!;
			})
		);
		const onlineLabel = await waitFor(() => {
			const text = first.container.querySelector('[data-testid="my-loans-item-l-1"]')?.textContent ?? '';
			expect(text).toContain(`#${COPY.copyNumber}`);
			return text;
		});
		await awaitRead(live, '_type.string=library&');
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		await fireEvent.click(
			await waitFor(() => {
				const el = container.querySelector('[data-testid="my-loans-toggle"]');
				expect(el, 'my-loans-toggle').not.toBeNull();
				return el!;
			})
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans-item-l-1"]')?.textContent).toBe(onlineLabel);
		});
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

	/** Expand work w-1 and edition e-1, then wait for `testid` inside copy c-1's row. */
	async function openCopyRow(container: HTMLElement, testid: string): Promise<Element> {
		await fireEvent.click(
			await waitFor(() => {
				const el = container.querySelector(`[data-testid="library-work-toggle-${WORKS[0].id}"]`);
				expect(el, 'work toggle').not.toBeNull();
				return el!;
			})
		);
		await fireEvent.click(
			await waitFor(() => {
				const el = container.querySelector(`[data-testid="library-edition-toggle-${EDITION.id}"]`);
				expect(el, 'edition toggle').not.toBeNull();
				return el!;
			})
		);
		return waitFor(() => {
			const el = container.querySelector(`[data-testid="library-copy-${COPY.id}"] [data-testid="${testid}"]`);
			expect(el, testid).not.toBeNull();
			return el!;
		});
	}

	it('a return re-reads the lendings into the store, so a later offline visit shows the copy available', async () => {
		const live = librarianEntu();
		let returned = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = urlOf(input);
				if (init?.method === 'POST' && url.includes('entity/l-1')) {
					returned = true;
					return json({}, 200, JSON_HEADERS);
				}
				if (returned && url.includes('_type.string=lending&')) {
					return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
				}
				return live(input);
			})
		);
		const first = await openLibrary();
		await expectLibrarianPanel(first.container);
		await fireEvent.click(await openCopyRow(first.container, `library-return-${COPY.id}`));
		await waitFor(() => {
			expect(first.container.querySelector(`[data-testid="inline-checkout-${COPY.id}"]`)).not.toBeNull();
		});
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openLibrary();
		await expectListing(container);
		await openCopyRow(container, `inline-checkout-${COPY.id}`);
		expect(container.querySelector(`[data-testid="library-return-${COPY.id}"]`)).toBeNull();
	});

	/** The librarian with copy c-1 available and the lending type resolvable; `libraryDown()`
	 *  makes the library-parent read fail from then on. */
	function checkoutEntu() {
		const live = librarianEntu();
		let libraryReadDown = false;
		const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = urlOf(input);
			if (url.includes('_type.string=lending&')) return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
			if (url.includes('_type.string=entity')) {
				return json({ count: 1, entities: [{ _id: 'type-lending' }] }, 200, JSON_HEADERS);
			}
			if (libraryReadDown && url.includes('_type.string=library&')) {
				throw new TypeError('Failed to fetch');
			}
			if (init?.method === 'POST') return json({ _id: 'l-new' }, 200, JSON_HEADERS);
			return live(input);
		});
		return { live, stub, libraryDown: () => (libraryReadDown = true) };
	}

	async function checkOutCopy(wire: ReturnType<typeof checkoutEntu>, libraryDown: boolean) {
		vi.stubGlobal('fetch', wire.stub);
		const { container } = await openLibrary();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]'), 'librarian-tools').not.toBeNull();
		});
		const select = await openCopyRow(container, `inline-checkout-${COPY.id}`);
		await awaitRead(wire.live, '_type.string=member&status.string=active');
		await flushReadCache();
		if (libraryDown) wire.libraryDown();
		await fireEvent.change(select, { target: { value: BORROWER_MEMBER } });
		return container;
	}

	const posts = (stub: ReturnType<typeof vi.fn>) =>
		stub.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

	it('a checkout writes one lending under the library it read live', async () => {
		const wire = checkoutEntu();
		await checkOutCopy(wire, false);

		await waitFor(() => {
			expect(posts(wire.stub)).toHaveLength(1);
		});
		expect(String((posts(wire.stub)[0][1] as RequestInit).body)).toContain(`"reference":"${LIBRARY}"`);
	});

	it('a checkout resolves its library parent live: when that read fails, nothing is written', async () => {
		const wire = checkoutEntu();
		const container = await checkOutCopy(wire, true);

		await waitFor(() => {
			expect(container.querySelector(`[data-testid="inline-checkout-error-${COPY.id}"]`)).not.toBeNull();
		});
		expect(posts(wire.stub)).toEqual([]);
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

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
