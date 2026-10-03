// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		library_title: () => 'Library',
		library_no_collective: () => 'Select a collective to view the library.',
		library_load_error: () => 'Something went wrong loading the library.',
		library_retry: () => 'Retry',
		library_empty: () => 'Nothing in the library yet.',
		library_work_composer_unknown: () => 'Unknown composer',
		library_editions_empty: () => 'No editions yet.',
		library_edition_publisher_unknown: () => 'Unknown publisher',
		library_copies_empty: () => 'No copies yet.',
		library_copy_available: () => 'Available',
		library_copy_lent_to: (p: { name: string }) => `Out — ${p.name}`,
		library_borrower_unknown: () => 'an unnamed member',
		library_copy_name_unknown: () => 'Untitled copy',
		library_lent_since: (p: { date: string }) => `since ${p.date}`,
		library_node_load_error: () => 'Could not load.',
		library_node_retry: () => 'Retry',
		library_librarian_tools: () => 'Librarian tools',
		library_librarian_load_error: () => 'Could not check librarian access.',
		library_librarian_retry: () => 'Retry',
		library_my_loans_title: (p: { count: number }) => `My loans (${p.count})`,
		library_my_loans_copy_label: (p: { copyName: string }) => `${p.copyName}`,
		library_my_loans_overdue: () => 'Overdue',
		library_checkout_submit: () => 'Checkout',
		library_return: () => 'Return',
		library_bulk_checkout_title: () => 'Bulk checkout',
		library_bulk_checkout_edition_placeholder: () => 'Select edition',
		library_bulk_checkout_work_placeholder: () => 'Select work',
		library_bulk_checkout_availability: (p: { available: number; total: number }) =>
			`${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_work_availability: (p: { available: number; total: number }) =>
			`${p.available}/${p.total}`,
		library_inline_checkout_placeholder: () => 'Select member',
		library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_inline_checkout_error: () => 'Checkout failed',
		library_copy_sort_label: () => 'Sort copies by',
		library_copy_sort_nr: () => 'Nr',
		library_copy_sort_member: () => 'Member',
		library_copy_sort_since: () => 'Since',
		library_available_summary: (p: { count: number }) => `${p.count} copies available for lending`,
		library_create_work_button: () => 'Add work',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_cancel: () => 'Cancel',
		library_create_work_name_required: () => 'Work title is required.',
		library_create_work_created: (p: { name: string }) => `${p.name} created.`,
		library_create_work_error: () => 'Could not create the work.',
		library_create_edition_button: () => 'Add edition',
		library_create_edition_name_label: () => 'Name',
		library_create_edition_publisher_label: () => 'Publisher',
		library_create_edition_submit: () => 'Create edition',
		library_create_edition_cancel: () => 'Cancel',
		library_create_edition_name_required: () => 'Edition name is required.',
		library_create_edition_created: (p: { name: string }) => `${p.name} created.`,
		library_create_edition_error: () => 'Could not create the edition.',
		library_edition_file_attach: () => 'Attach files',
		library_edition_file_open: () => 'Open',
		library_edition_file_uploading: () => 'Uploading…',
		library_edition_file_uploaded: (p: { filenames: string }) => `${p.filenames} attached.`,
		library_edition_file_failed: (p: { filename: string }) => `Could not attach ${p.filename}.`,
		library_edition_file_broken: (p: { filename: string }) =>
			`${p.filename} failed and could not be cleaned up.`,
		library_edition_file_error: () => 'Could not attach files.',
		library_edition_file_not_created: (p: { filename: string }) =>
			`${p.filename} was not attached — the server returned nothing for it.`,
		file_presence_on_device: () => 'On this device',
		file_presence_needs_network: () => 'Needs network'
	})
);

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
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

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
	formatFileSize: (bytes: number) =>
		bytes === 1937 ? '1.9 KB' : bytes === 245678 ? '239.9 KB' : bytes === 2048 ? '2.0 KB' : `${bytes} B`
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({ getAppLabelStore: () => ({ putLabel: async () => {}, labelsFor: async () => new Map(), remove: async () => {} }) }));

import Page from './library/+page.svelte';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';

let fakeByteStore: FakeByteStore;

function setAuthedWithOneCollective() {
	signIn();
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

function mockBaselineLibrary() {
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listEditionsMock.mockResolvedValue(toListRead([
		{
			id: 'edition-1',
			name: 'Vocal score',
			publisher: 'Novello',
			externalLinks: [],
			files: [
				{ id: 'file-1', filename: 'spem-vocal.pdf', filesize: 1937, filetype: 'application/pdf' },
				{ id: 'file-2', filename: 'spem-rehearsal.mp3', filesize: 245678, filetype: 'audio/mpeg' }
			]
		},
		{
			id: 'edition-2',
			name: 'Full score',
			publisher: 'Carus',
			externalLinks: [],
			files: []
		}
	]));
	listCopiesMock.mockResolvedValue(toListRead([]));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
}

function mockLibrarian() {
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
}

function stubByteFetch() {
	const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
		new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]).slice(), {
			status: 200,
			headers: { 'content-type': 'application/pdf' }
		})
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
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
	gotoMock.mockReset();
	vi.unstubAllGlobals();
	resetAppState();
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

async function renderWithEditionOpen(editionId: string): Promise<HTMLElement> {
	const container = await renderReady();
	await expandWork(container, 'work-1');
	await expandEdition(container, editionId);
	return container;
}

function attachInput(container: HTMLElement, editionId: string): HTMLInputElement {
	return container.querySelector(
		`[data-testid="library-attach-file-${editionId}"]`
	) as HTMLInputElement;
}

async function selectFiles(input: HTMLInputElement, files: File[]): Promise<void> {
	await fireEvent.change(input, { target: { files } });
}

function makeFile(name: string, bytes: number, type: string): File {
	return new File([new Uint8Array(bytes)], name, { type });
}

describe('#275 — the files list renders inside the expanded edition (integration)', () => {
	it('an edition WITH files shows one row per file — filename AND human filesize (via the shared formatFileSize) — inside the expanded edition block', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-edition-1"]')
			).not.toBeNull();
		});
		const editionBlock = container.querySelector(
			'[data-testid="library-edition-edition-1"]'
		) as HTMLElement;
		const list = editionBlock.querySelector(
			'[data-testid="library-edition-files-edition-1"]'
		) as HTMLElement;
		expect(list).not.toBeNull();

		const row1 = list.querySelector('[data-testid="library-edition-file-file-1"]') as HTMLElement;
		const row2 = list.querySelector('[data-testid="library-edition-file-file-2"]') as HTMLElement;
		expect(row1).not.toBeNull();
		expect(row2).not.toBeNull();
		expect(row1.textContent).toContain('spem-vocal.pdf');
		expect(row1.textContent).toContain('1.9 KB');
		expect(row2.textContent).toContain('spem-rehearsal.mp3');
		expect(row2.textContent).toContain('239.9 KB');
	});

	it('the list renders only in the EXPANDED edition — present after expanding, gone again after collapsing', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderReady();
		await expandWork(container, 'work-1');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="library-edition-files-edition-1"]')).toBeNull();

		await expandEdition(container, 'edition-1');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-edition-1"]')
			).not.toBeNull();
		});

		await fireEvent.click(
			container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-files-edition-1"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="library-edition-file-file-1"]')).toBeNull();
	});

	it('zero files is normal and UNREMARKABLE: the zero-files edition renders NO files list, NO empty-state message — for a non-librarian, exactly as today (no #275 testid exists under it at all), while the SIBLING edition with files shows its list (the absence is not vacuous)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');
		await expandEdition(container, 'edition-2');

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-edition-1"]')
			).not.toBeNull();
		});

		const editionBlock = container.querySelector(
			'[data-testid="library-edition-edition-2"]'
		) as HTMLElement;
		expect(editionBlock.querySelector('[data-testid^="library-edition-files-"]')).toBeNull();
		expect(editionBlock.querySelector('[data-testid^="library-edition-file-"]')).toBeNull();
		expect(editionBlock.querySelector('[data-testid^="library-attach-file-"]')).toBeNull();
		expect(editionBlock.textContent).toContain('No copies yet.');
	});

	it('the files list is a READ path — it renders for the non-librarian member too', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-file-file-1"]')
			).not.toBeNull();
		});
	});

	it('LAYOUT sanity at phone width (class contract; happy-dom computes no layout): the files container adds NO third ml-4 indent level, and filenames WRAP — break-words/break-all present, truncate/whitespace-nowrap absent throughout the rows', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		const list = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-files-edition-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(Array.from(list.classList)).not.toContain('ml-4');

		const row = list.querySelector('[data-testid="library-edition-file-file-1"]') as HTMLElement;
		const everything = [row, ...Array.from(row.querySelectorAll<HTMLElement>('*'))];
		for (const el of everything) {
			const classes = Array.from(el.classList);
			expect(classes, 'filenames must never truncate').not.toContain('truncate');
			expect(classes, 'filenames must wrap, not overflow').not.toContain('whitespace-nowrap');
		}
		expect(
			everything.some((el) => el.classList.contains('break-words') || el.classList.contains('break-all')),
			'a long filename needs an explicit wrap class somewhere in its row'
		).toBe(true);
	});
});

describe('#275/#427 — the Open affordance: nothing pre-signed, nothing pre-rendered; the click navigates', () => {
	it('no URL is rendered or pre-signed: at render, signFileUrl has NOT been called, the row holds no <a href>, and the open control is a BUTTON', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		const row = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(row.querySelector('a[href]')).toBeNull();
		const open = row.querySelector(
			'[data-testid="library-edition-file-open-file-1"]'
		) as HTMLElement;
		expect(open).not.toBeNull();
		expect(open.tagName).toBe('BUTTON');
	});

	it('clicking Open NAVIGATES — goto(/part/<file property id>?db=<db>) with the part LABEL in the navigation state, full shape, and NO tab opens (#427)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		const openMock = vi.fn(() => null);
		vi.stubGlobal('open', openMock);
		stubByteFetch(); // a live wire, to prove the click needs none of it
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');

		const container = await renderWithEditionOpen('edition-1');
		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		const before = gotoMock.mock.calls.length;
		await fireEvent.click(open);

		await waitFor(() => expect(gotoMock.mock.calls.length).toBeGreaterThan(before));
		expect(gotoMock.mock.calls.slice(before)).toEqual([
			[
				'/part/file-1?db=sampledb',
				{
					state: {
						partLabel: {
							work: 'Spem in alium',
							composer: 'Thomas Tallis',
							edition: 'Vocal score',
							filename: 'spem-vocal.pdf'
						}
					}
				}
			]
		]);
		expect(openMock).not.toHaveBeenCalled();
	});

	it('the click signs NOTHING, fetches NOTHING, stores NOTHING and raises NO per-file error — the /part viewer owns the read (#427)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		vi.stubGlobal('open', vi.fn(() => null));
		const fetchMock = stubByteFetch();
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');

		const container = await renderWithEditionOpen('edition-1');
		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		const before = gotoMock.mock.calls.length;
		await fireEvent.click(open);
		await waitFor(() => expect(gotoMock.mock.calls.length).toBeGreaterThan(before));

		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(fakeByteStore.heldFor('sampledb', 'person-p')).toEqual([]);
		expect(
			container.querySelector('[data-testid="library-edition-file-open-error-file-1"]')
		).toBeNull();
	});
});

describe('#427 — a part already on the device navigates the same way', () => {
	it('with every network path dead and the file in the store, the click still just navigates — same URL, no signing, no fetch, no error', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		vi.stubGlobal('open', vi.fn(() => null));
		const fetchMock = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', fetchMock);
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-p' }, 'file-1', {
			bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
			filetype: 'application/pdf',
			sha256: 'sha-cached'
		});

		const container = await renderWithEditionOpen('edition-1');
		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		const before = gotoMock.mock.calls.length;
		await fireEvent.click(open);

		await waitFor(() => expect(gotoMock.mock.calls.length).toBeGreaterThan(before));
		expect(gotoMock.mock.calls.slice(before)).toEqual([
			[
				'/part/file-1?db=sampledb',
				{
					state: {
						partLabel: {
							work: 'Spem in alium',
							composer: 'Thomas Tallis',
							edition: 'Vocal score',
							filename: 'spem-vocal.pdf'
						}
					}
				}
			]
		]);
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-error-file-1"]')
		).toBeNull();
	});
});

describe('#275 — the attach control: librarian-only native <input type=file multiple>', () => {
	it('for the librarian it renders inside the expanded edition — a NATIVE file input, multiple, labelled — on the zero-files edition too (attach is how files ever appear)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const container = await renderWithEditionOpen('edition-2');

		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		expect(input.tagName).toBe('INPUT');
		expect(input.type).toBe('file');
		expect(input.multiple).toBe(true);
		expect(input.getAttribute('aria-label') || input.labels?.length).toBeTruthy();
		const editionBlock = container.querySelector(
			'[data-testid="library-edition-edition-2"]'
		) as HTMLElement;
		expect(editionBlock.querySelector('[data-testid="library-attach-file-edition-2"]')).not.toBeNull();
	});

	it('ABSENT — not disabled — for the non-librarian: no attach control exists anywhere, while the files list still renders', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-file-file-1"]')).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid^="library-attach-file-"]')).toHaveLength(0);
	});

	it('hidden while resolveLibrarian is still pending (hidden-if-undeterminable)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockReturnValue(new Promise(() => {}));

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-file-file-1"]')).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid^="library-attach-file-"]')).toHaveLength(0);
	});
});

describe('#275 — selecting files uploads them through uploadEditionFiles', () => {
	it('a change with two Files calls uploadEditionFiles ONCE with (cfg, the edition id, the Files) — and no listEditions refetch afterwards; the new rows appear LOCALLY with the sr-only announcement naming exactly what landed', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' },
				{ propertyId: 'prop-new-2', filename: 'new-b.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: []
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		const editionReadsBefore = listEditionsMock.mock.calls.length;

		const fileA = makeFile('new-a.pdf', 2048, 'application/pdf');
		const fileB = makeFile('new-b.pdf', 2048, 'application/pdf');
		await selectFiles(input, [fileA, fileB]);

		await waitFor(() => expect(uploadEditionFilesMock).toHaveBeenCalledTimes(1));
		const call = uploadEditionFilesMock.mock.calls[0];
		expect(call[0]).toEqual({ db: 'sampledb', token: 'jwt-abc' });
		expect(call[1]).toBe('edition-2');
		const sent = call[2] as File[];
		expect(sent.map((f) => f.name)).toEqual(['new-a.pdf', 'new-b.pdf']);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-1"]')
			).not.toBeNull();
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-2"]')
			).not.toBeNull();
		});
		const row = container.querySelector(
			'[data-testid="library-edition-file-prop-new-1"]'
		) as HTMLElement;
		expect(row.textContent).toContain('new-a.pdf');
		expect(row.textContent).toContain('2.0 KB');
		expect(listEditionsMock.mock.calls.length).toBe(editionReadsBefore);

		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent?.trim()).toBe('new-a.pdf, new-b.pdf attached.');
	});

	it('a JUST-uploaded file opens the same way as an existing one — its Open navigates to /part/<NEW property id> (#427)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		vi.stubGlobal('open', vi.fn(() => null));
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-new');
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: []
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-prop-new-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(signFileUrlMock).not.toHaveBeenCalled();

		const before = gotoMock.mock.calls.length;
		await fireEvent.click(open);

		await waitFor(() => expect(gotoMock.mock.calls.length).toBeGreaterThan(before));
		expect(gotoMock.mock.calls.slice(before)).toEqual([
			[
				'/part/prop-new-1?db=sampledb',
				{
					state: {
						partLabel: {
							work: 'Spem in alium',
							composer: 'Thomas Tallis',
							edition: 'Full score',
							filename: 'new-a.pdf'
						}
					}
				}
			]
		]);
		expect(signFileUrlMock).not.toHaveBeenCalled();
	});
});

describe('#275 — in-flight state is keyed PER EDITION (per-batch, the stated choice)', () => {
	it("while edition-2's batch uploads: ITS attach input is disabled and an uploading indicator shows — edition-1's attach input stays enabled; on settle the indicator clears and the input re-enables", async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		let resolveUpload: (r: unknown) => void = () => {};
		uploadEditionFilesMock.mockReturnValue(
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
		);

		const container = await renderWithEditionOpen('edition-1');
		await expandEdition(container, 'edition-2');
		const input2 = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		const input1 = attachInput(container, 'edition-1');
		expect(input1).not.toBeNull();

		await selectFiles(input2, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		await waitFor(() => {
			expect(attachInput(container, 'edition-2').disabled).toBe(true);
			expect(
				container.querySelector('[data-testid="library-edition-files-uploading-edition-2"]')
			).not.toBeNull();
		});
		expect(attachInput(container, 'edition-1').disabled).toBe(false);
		expect(
			container.querySelector('[data-testid="library-edition-files-uploading-edition-1"]')
		).toBeNull();
		expect(
			container.querySelector('[data-testid="library-edition-files-uploading-edition-2"]')
				?.textContent
		).toContain('Uploading…');

		resolveUpload({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: []
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-uploading-edition-2"]')
			).toBeNull();
			expect(attachInput(container, 'edition-2').disabled).toBe(false);
		});
	});
});

describe('#275 — a failed file is reported by NAME and never renders as an attachment', () => {
	it('file 2 of 3 fails (cleaned up): rows for 1 and 3 render, NO row for 2, and a visible per-file failure names it — while the announcement names what DID land', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' },
				{ propertyId: 'prop-new-3', filename: 'new-c.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: 'prop-new-2', filename: 'new-b.pdf', cleanup: 'deleted' }]
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [
			makeFile('new-a.pdf', 2048, 'application/pdf'),
			makeFile('new-b.pdf', 2048, 'application/pdf'),
			makeFile('new-c.pdf', 2048, 'application/pdf')
		]);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-1"]')
			).not.toBeNull();
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-3"]')
			).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-2"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-prop-new-2"]')
		).toBeNull();

		const err = await waitFor(() => {
			const el = container.querySelector(
				'[data-testid="library-edition-files-error-edition-2"]'
			);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(err.getAttribute('role')).toBe('alert');
		expect(err.textContent).toContain('Could not attach new-b.pdf.');

		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement;
		expect(status.textContent?.trim()).toBe('new-a.pdf, new-c.pdf attached.');
	});

	it('a "not-created" file is named in the visible error with its OWN message — distinct from the created-then-cleaned-up wording, and no row for it', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: null, filename: 'new-b.pdf', cleanup: 'not-created' }]
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [
			makeFile('new-a.pdf', 2048, 'application/pdf'),
			makeFile('new-b.pdf', 2048, 'application/pdf')
		]);

		const err = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-files-error-edition-2"]');
			expect(el, 'a file nothing came back for must still be reported').not.toBeNull();
			return el as HTMLElement;
		});
		expect(err.getAttribute('role')).toBe('alert');
		expect(err.textContent).toContain(
			'new-b.pdf was not attached — the server returned nothing for it.'
		);
		expect(err.textContent).not.toContain('Could not attach new-b.pdf.');
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-2"]')).toBeNull();
		expect(container.querySelector('[data-testid^="library-edition-file-broken-"]')).toBeNull();
		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement;
		expect(status.textContent?.trim()).toBe('new-a.pdf attached.');
	});

	it('a delete-failed phantom renders as a BROKEN row — visibly failed, no Open control, never a normal attachment', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [],
			failed: [{ propertyId: 'prop-new-1', filename: 'new-a.pdf', cleanup: 'delete-failed' }]
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		const broken = await waitFor(() => {
			const el = container.querySelector(
				'[data-testid="library-edition-file-broken-prop-new-1"]'
			);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(broken.textContent).toContain('new-a.pdf failed and could not be cleaned up.');
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-1"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-prop-new-1"]')
		).toBeNull();
		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement | null;
		expect(status?.textContent?.trim() ?? '').toBe('');
	});

	it('a REJECTED upload (step-1 transport failure — nothing created) shows the batch error, inserts nothing, and re-enables the attach control for a retry', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockRejectedValue(new Error('HTTP 403'));

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		const err = await waitFor(() => {
			const el = container.querySelector(
				'[data-testid="library-edition-files-error-edition-2"]'
			);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(err.getAttribute('role')).toBe('alert');
		expect(err.textContent).toContain('Could not attach files.');
		expect(container.querySelector('[data-testid^="library-edition-file-prop-"]')).toBeNull();
		expect(attachInput(container, 'edition-2').disabled).toBe(false);
	});
});

describe('#275 — success-apply AND failure-apply are generation-guarded', () => {
	it('an upload that settles AFTER the collective switched applies NOTHING — no rows, no announcement, no error (a stale mixed result must not leak either half into the new collective)', async () => {
		signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'secondchoir', name: 'Second Choir', personId: 'person-s' }] });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		findMyMemberIdMock.mockResolvedValue(null);
		resolveCopyNamesMock.mockResolvedValue(new Map());
		resolveCopyChainsMock.mockResolvedValue(new Map());
		listAllEditionsMock.mockResolvedValue(toListRead([]));
		listAllCopiesMock.mockResolvedValue(toListRead([]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));
		listSeasonsMock.mockResolvedValue([]);
		listRepertoireItemsMock.mockResolvedValue([]);
		listWorksMock.mockImplementation(async (cfg: { db: string }) =>
			toListRead([
				{ id: 'work-1', name: cfg.db === 'sampledb' ? 'Erste Messe' : 'Zweite Messe', composer: '' }
			])
		);
		listEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Vocal score', publisher: 'Novello', externalLinks: [], files: [] }
		]));
		listCopiesMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')?.textContent).toContain(
				'Erste Messe'
			);
		});
		await expandWork(container, 'work-1');
		await expandEdition(container, 'edition-1');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-1');
			expect(el).not.toBeNull();
			return el;
		});

		let resolveUpload: (r: unknown) => void = () => {};
		uploadEditionFilesMock.mockReturnValue(
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
		);
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);
		await waitFor(() => expect(uploadEditionFilesMock).toHaveBeenCalledTimes(1));
		expect(uploadEditionFilesMock.mock.calls[0][0]).toEqual({ db: 'sampledb', token: 'jwt-abc' });

		selectedCollectiveDbStore.set('secondchoir');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')?.textContent).toContain(
				'Zweite Messe'
			);
		});

		resolveUpload({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: 'prop-new-2', filename: 'new-b.pdf', cleanup: 'deleted' }]
		});
		await new Promise((r) => setTimeout(r, 0));

		await expandWork(container, 'work-1');
		await expandEdition(container, 'edition-1');
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-1"]')).toBeNull();
		expect(container.textContent).not.toContain('attached.');
		expect(container.querySelectorAll('[data-testid^="library-edition-files-error-"]')).toHaveLength(
			0
		);
		expect(container.textContent).not.toContain('Could not attach');
	});
});

// (*MVOX:Tallis* — #275 RED)
