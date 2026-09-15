// @vitest-environment happy-dom
//
// #351 RED — the LIBRARY surface tells the member which parts are on this
// device: one indicator, two states, on every edition-file row.
//
//   - BADGE: [data-testid="file-presence-{fileId}"] inside the file's row
//     ([data-testid="library-edition-file-{fileId}"] — src/routes/library/
//     +page.svelte, the #275 files list). Exactly TWO states, pinned via
//     message keys: m.file_presence_on_device() when the store holds the
//     bytes for the CURRENT identity's partition, m.file_presence_needs_network()
//     when it does not. No third state, no percentage, no spinner.
//   - WHILE THE STORE HAS NOT ANSWERED: NEITHER badge renders. An absent
//     badge is not a claim; a wrong badge is. In particular the page must NOT
//     default to needs-network and correct it a moment later — that
//     default-then-correct flicker is the failure this slice exists to
//     prevent, in miniature (#289's rule: telling the member nothing is
//     telling them something false).
//   - THE TRAP (issue #351): ByteStore.get() counts as an open — a per-row
//     get() would collapse LRU to render order. The page asks presence
//     through the NEW heldFileIds(db, personId) — ONE call for the whole
//     list — and never calls get() just to render.
//   - THE BADGE IS NOT A CONTROL: no button/link semantics, no role, no
//     tabindex; clicking it signs nothing and opens nothing. The row's Open
//     affordance is unchanged.
//   - WORDING: byteStore.ts:8 — the partition is a CORRECTNESS boundary, not
//     a security boundary. No locale value for these keys may imply the
//     bytes are private/secure/protected (en, et, lv, uk — pinned below).
//
// INTEGRATION (house rule): the ACTUAL /library route renders; only the read
// seams and the $lib/files/appByteStore persistence seam are substituted.
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

const {
	listWorksMock,
	listEditionsMock,
	listCopiesMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listLendingsMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock,
	resolveCopyChainsMock
} = vi.hoisted(() => ({
	listWorksMock: vi.fn(),
	listEditionsMock: vi.fn(),
	listCopiesMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listLendingsMock: vi.fn(),
	resolveBorrowerNamesMock: vi.fn(),
	resolveCopyNamesMock: vi.fn(),
	resolveCopyChainsMock: vi.fn()
}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>(
		'$lib/library/libraryData'
	);
	return {
		...actual, // keep the real, pure derive* helpers
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllEditions: listAllEditionsMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock,
		resolveCopyNames: resolveCopyNamesMock,
		resolveCopyChains: resolveCopyChainsMock
	};
});
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

const { resolveLibrarianMock } = vi.hoisted(() => ({ resolveLibrarianMock: vi.fn() }));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>(
		'$lib/library/librarianStore'
	);
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

vi.mock('$lib/library/lendingActions', () => ({
	createLending: vi.fn(),
	returnLending: vi.fn(),
	bulkCheckout: vi.fn()
}));

const { listSeasonsMock } = vi.hoisted(() => ({ listSeasonsMock: vi.fn() }));
vi.mock('$lib/seasons/entuSeasons', async () => {
	const actual = await vi.importActual<typeof import('$lib/seasons/entuSeasons')>(
		'$lib/seasons/entuSeasons'
	);
	return {
		...actual,
		listSeasons: listSeasonsMock
	};
});
const { listRepertoireItemsMock } = vi.hoisted(() => ({ listRepertoireItemsMock: vi.fn() }));
vi.mock('$lib/repertoire/repertoireData', async () => {
	const actual = await vi.importActual<typeof import('$lib/repertoire/repertoireData')>(
		'$lib/repertoire/repertoireData'
	);
	return {
		...actual,
		listRepertoireItems: listRepertoireItemsMock
	};
});

vi.mock('$lib/entity/entityCreate', () => ({
	createWork: vi.fn(),
	createEdition: vi.fn()
}));

const { uploadEditionFilesMock, signFileUrlMock } = vi.hoisted(() => ({
	uploadEditionFilesMock: vi.fn(),
	signFileUrlMock: vi.fn()
}));
vi.mock('$lib/library/editionFiles', () => ({
	uploadEditionFiles: uploadEditionFilesMock,
	formatFileSize: (bytes: number) => `${bytes} B`
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({ getAppLabelStore: () => ({ putLabel: async () => {}, labelsFor: async () => new Map(), remove: async () => {} }) }));

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;

/** The #351 presence member — an intersection until the interface lands. */
type PresenceQuery = (db: string, personId: string) => Promise<string[]>;

/** Installs a controllable heldFileIds on the fake and returns the spy —
 *  the page-level seam for BOTH the answered and the not-yet-answered
 *  states. Defaults to answering from the fake's own held rows. */
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

const IDENTITY = { db: 'polyphony', personId: 'person-p' };

function pdfData() {
	return {
		bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
		filetype: 'application/pdf',
		sha256: 'sha-fixture'
	};
}

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
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
	listSeasonsMock.mockResolvedValue([]);
	listRepertoireItemsMock.mockResolvedValue([]);
}

/** ONE work, ONE edition, TWO files — both presence states live in the SAME
 *  render: file-held is seeded into the store below, file-absent is not. */
function mockBaselineLibrary() {
	listWorksMock.mockResolvedValue(
		toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }])
	);
	listEditionsMock.mockResolvedValue(
		toListRead([
			{
				id: 'edition-1',
				name: 'Vocal score',
				publisher: 'Novello',
				externalLinks: [],
				files: [
					{ id: 'file-held', filename: 'spem-vocal.pdf', filesize: 1937, filetype: 'application/pdf' },
					{ id: 'file-absent', filename: 'spem-full.pdf', filesize: 2048, filetype: 'application/pdf' }
				]
			}
		])
	);
	listCopiesMock.mockResolvedValue(toListRead([]));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
});

afterEach(() => {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveCopyNamesMock.mockReset();
	resolveCopyChainsMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	listSeasonsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	uploadEditionFilesMock.mockReset();
	signFileUrlMock.mockReset();
	vi.unstubAllGlobals();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

async function renderReady(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
	});
	return container;
}

async function expandWork(container: HTMLElement, workId: string): Promise<void> {
	await fireEvent.click(
		container.querySelector(`[data-testid="library-work-toggle-${workId}"]`) as Element
	);
	await waitFor(() => {
		expect(container.querySelector(`#library-editions-${workId}`)).not.toBeNull();
	});
}

async function expandEdition(container: HTMLElement, editionId: string): Promise<void> {
	await waitFor(() => {
		expect(
			container.querySelector(`[data-testid="library-edition-toggle-${editionId}"]`)
		).not.toBeNull();
	});
	await fireEvent.click(
		container.querySelector(`[data-testid="library-edition-toggle-${editionId}"]`) as Element
	);
	await waitFor(() => {
		expect(container.querySelector(`#library-copies-${editionId}`)).not.toBeNull();
	});
}

/** Route rendered, work-1 and edition-1 expanded — file rows on screen. */
async function renderWithFilesVisible(): Promise<HTMLElement> {
	const container = await renderReady();
	await expandWork(container, 'work-1');
	await expandEdition(container, 'edition-1');
	await waitFor(() => {
		expect(
			container.querySelector('[data-testid="library-edition-file-file-held"]')
		).not.toBeNull();
	});
	return container;
}

describe('#351 — /library: one indicator, two states, on every file row (integration)', () => {
	it('a held file badges on-device, an unheld file badges needs-network — both states in the SAME render, each INSIDE its own file row', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();

		const container = await renderWithFilesVisible();

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
		// Each badge sits inside ITS file's row, not floating beside the list.
		expect(held.closest('[data-testid="library-edition-file-file-held"]')).not.toBeNull();
		expect(absent.closest('[data-testid="library-edition-file-file-absent"]')).not.toBeNull();
	});

	it('THE trap: rendering asks presence ONCE for the whole list — never get() — and asks for the CURRENT identity partition', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		const getSpy = vi.spyOn(fakeByteStore, 'get');

		const container = await renderWithFilesVisible();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
		});

		// One store query per list render, not one per row (two rows here);
		// re-query on a LATER render is fine, a second call in THIS settled
		// render is the per-row shape leaking back in.
		expect(presenceSpy.mock.calls).toEqual([['polyphony', 'person-p']]);
		// get() counts as an open (byteStore.ts head comment) — a render must
		// never call it, or LRU collapses to render order.
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('while the store has NOT answered, NEITHER badge renders — no default-then-correct', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		const pending = deferred<string[]>();
		installPresence(() => pending.promise);

		const container = await renderWithFilesVisible();

		// File rows are on screen, the store has not answered: an absent badge
		// is not a claim. Specifically NOT needs-network-then-correct.
		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);
		const filesBlock = container.querySelector(
			'[data-testid="library-edition-files-edition-1"]'
		)!;
		expect(filesBlock.textContent).not.toContain('[file_presence_needs_network]');
		expect(filesBlock.textContent).not.toContain('[file_presence_on_device]');

		// The answer lands → the badges appear, from the answer alone.
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

	it('the badge is NOT a control: no button/link semantics, and clicking it signs nothing and opens nothing — the row Open affordance is untouched beside it', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();
		const openSpy = vi.spyOn(window, 'open');

		const container = await renderWithFilesVisible();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
		});

		for (const fileId of ['file-held', 'file-absent']) {
			const badge = container.querySelector(`[data-testid="file-presence-${fileId}"]`)!;
			expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']).not.toContain(
				badge.tagName
			);
			expect(badge.hasAttribute('role')).toBe(false);
			expect(badge.hasAttribute('tabindex')).toBe(false);
			// Not wrapped inside the Open control (or any control) either.
			expect(badge.closest('button, a, [role="button"]')).toBeNull();
			await fireEvent.click(badge);
		}
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(openSpy).not.toHaveBeenCalled();
		// The existing Open affordance still stands, unchanged, per row.
		expect(
			container.querySelector('[data-testid="library-edition-file-open-file-held"]')
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-file-absent"]')
		).not.toBeNull();
	});

	// #351 review finding 1 — the done-when bullet "a part that is downloaded,
	// then evicted by the cap, stops showing as available", at the only level
	// the member ever sees it.
	//
	// A put is a STORE-WIDE mutation: the cap's evictUntilFits deletes the
	// globally-least-recently-opened rows to admit the newcomer, and those
	// rows can be on this very screen. A page that patches the newcomer into
	// its presence Set and stops there leaves the evicted row badged
	// "on this device" forever — the wrong-badge direction, which #351 calls
	// worse than no badge.
	it('opening an unheld part whose store put EVICTS a held one flips BOTH badges — the evicted row stops claiming on-device', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-lib?X-Amz-Expires=60');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]).slice(), {
						status: 200,
						headers: { 'content-type': 'application/pdf' }
					})
			)
		);
		// The cap in miniature. createFakeByteStore holds no cap policy (the
		// REAL eviction arithmetic is specced in byteStore.presence.spec.ts);
		// what this pins is the PAGE's reaction to a put that took something
		// else away — storing file-absent costs the device file-held.
		const realPut = fakeByteStore.put.bind(fakeByteStore);
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async (identity, fileId, data) => {
			await realPut(identity, fileId, data);
			await fakeByteStore.evict(IDENTITY, 'file-held');
		});
		const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const container = await renderWithFilesVisible();
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_on_device]');
		});

		await fireEvent.click(
			container.querySelector('[data-testid="library-edition-file-open-file-absent"]') as Element
		);

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
			['polyphony', 'person-p'],
			['polyphony', 'person-p']
		]);
	});

	// #351 second review round, finding 1 — the eviction is not undone when the
	// write that caused it FAILS. byteStore.put runs `evictUntilFits` BEFORE
	// `adapter.put` (byteStore.ts), because IndexedDB offers no way to reserve
	// space ahead of a write. So a put that rejects (transaction abort, a
	// VersionError from a rolled-back DB, site data cleared mid-open) has
	// ALREADY deleted the rows it made room with, and openFileBytes reports
	// that open 'network-uncached', not 'network-stored'. A page that re-asks
	// only on 'network-stored' therefore keeps badging the discarded rows
	// on-device — the same wrong-badge direction as the test above, reached
	// through the failure path. The re-query follows the store-write ATTEMPT,
	// not its success.
	it('an open whose store put EVICTS a held row and then REJECTS still re-queries — the discarded row stops claiming on-device', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-lib?X-Amz-Expires=60');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]).slice(), {
						status: 200,
						headers: { 'content-type': 'application/pdf' }
					})
			)
		);
		// Eviction lands, the write that needed the room does not — exactly the
		// order byteStore.put runs them in.
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async () => {
			await fakeByteStore.evict(IDENTITY, 'file-held');
			throw new Error('idb: transaction aborted');
		});
		const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const container = await renderWithFilesVisible();
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_on_device]');
		});

		await fireEvent.click(
			container.querySelector('[data-testid="library-edition-file-open-file-absent"]') as Element
		);

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
			['polyphony', 'person-p'],
			['polyphony', 'person-p']
		]);
	});
});

describe('#351 — wording honesty (byteStore.ts:8 — a correctness boundary, NOT a security boundary)', () => {
	const localeFiles = ['en', 'et', 'lv', 'uk'] as const;
	const BADGE_KEYS = ['file_presence_on_device', 'file_presence_needs_network'] as const;
	// The private/secure/protected wording family, across all four locales:
	// en private/secure/protected, et privaatne/kaitstud/turvaline,
	// lv privāts/aizsargāts/drošs, uk приватний/захищений/безпечний.
	const FORBIDDEN = [
		/priv/i,
		/secur/i,
		/protect/i,
		/kaitst/i,
		/turval/i,
		/aizsarg/i,
		/droš/i,
		/захищ/i,
		/прив/i,
		/безпеч/i
	];

	it('both badge keys exist, non-empty, in all four locales', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				// cwd-relative, the works-write-failure precedent.
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			for (const key of BADGE_KEYS) {
				expect(messages[key], `${locale}: ${key}`).toBeTruthy();
			}
		}
	});

	it('no badge value in any locale implies the bytes are private, secure or protected — on-device is a statement about AVAILABILITY', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, string>;
			for (const key of BADGE_KEYS) {
				const value = messages[key] ?? '';
				for (const pattern of FORBIDDEN) {
					expect(value, `${locale}: ${key} = "${value}" matches ${pattern}`).not.toMatch(pattern);
				}
			}
		}
	});
});

// (*MVOX:Tallis*)
