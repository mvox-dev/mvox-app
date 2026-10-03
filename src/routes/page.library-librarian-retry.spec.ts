// @vitest-environment happy-dom
// A late librarian answer from a retry must not overwrite a newer load (#546).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

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
		library_create_work_button: () => 'Add work',
		library_edition_file_attach: () => 'Attach files',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_error: () => 'Could not create the work.',
		library_create_edition_button: () => 'Add edition',
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
		library_bulk_checkout_availability: (p: { available: number; total: number }) => `${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_work_availability: (p: { available: number; total: number }) => `${p.available}/${p.total}`,
		library_inline_checkout_placeholder: () => 'Select member',
		library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_inline_checkout_error: () => 'Checkout failed',
		library_copy_sort_label: () => 'Sort copies by',
		library_copy_sort_nr: () => 'Nr',
		library_copy_sort_member: () => 'Member',
		library_copy_sort_since: () => 'Since',
		library_available_summary: (p: { count: number }) => `${p.count} copies available for lending`
	})
);

const { listWorksMock, listEditionsMock, listCopiesMock, listAllEditionsMock, listAllCopiesMock, listLendingsMock, resolveBorrowerNamesMock, resolveCopyNamesMock, resolveCopyChainsMock } =
	vi.hoisted(() => ({
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
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual,
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
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
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

const { resolveLibrarianMock, resolveMyLibraryIdMock } = vi.hoisted(() => ({
	resolveLibrarianMock: vi.fn(),
	resolveMyLibraryIdMock: vi.fn()
}));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>('$lib/library/librarianStore');
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock,
		resolveMyLibraryId: resolveMyLibraryIdMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

const { createLendingMock, returnLendingMock, bulkCheckoutMock } = vi.hoisted(() => ({
	createLendingMock: vi.fn(),
	returnLendingMock: vi.fn(),
	bulkCheckoutMock: vi.fn()
}));
vi.mock('$lib/library/lendingActions', () => ({
	createLending: createLendingMock,
	returnLending: returnLendingMock,
	bulkCheckout: bulkCheckoutMock
}));

import Page from './library/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { get } from 'svelte/store';
import { librarianStore } from '$lib/library/librarianStore';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const DB_A = 'sampledb';
const DB_B = 'other-choir';

function worksFor(db: string) {
	return db === DB_A
		? [
				{ id: 'work-a1', name: 'Spem in alium', composer: 'Thomas Tallis' },
				{ id: 'work-a2', name: 'Ave verum corpus', composer: 'William Byrd' }
			]
		: [
				{ id: 'work-b1', name: 'Cantique de Jean Racine', composer: 'Gabriel Fauré' },
				{ id: 'work-b2', name: 'Os justi', composer: 'Anton Bruckner' }
			];
}

function editionsFor(db: string) {
	return db === DB_A
		? [{ id: 'edition-a1', name: 'Urtext A', publisher: 'Bärenreiter', workId: 'work-a1', externalLinks: [], files: [] }]
		: [{ id: 'edition-b1', name: 'Urtext B', publisher: 'Carus', workId: 'work-b1', externalLinks: [], files: [] }];
}

function copiesFor(db: string) {
	return db === DB_A
		? [
				{ id: 'copy-a1', name: 'Copy A1', copyNumber: 1, editionId: 'edition-a1' },
				{ id: 'copy-a2', name: 'Copy A2', copyNumber: 2, editionId: 'edition-a1' }
			]
		: [{ id: 'copy-b1', name: 'Copy B1', copyNumber: 1, editionId: 'edition-b1' }];
}

function membersFor(db: string) {
	return db === DB_A
		? [
				{ memberId: 'member-a1', personId: 'person-a1', sectionIds: [] },
				{ memberId: 'member-a2', personId: 'person-a2', sectionIds: [] }
			]
		: [{ memberId: 'member-b1', personId: 'person-b1', sectionIds: [] }];
}

function borrowerNamesFor(db: string) {
	return db === DB_A
		? new Map([
				['member-a1', 'Ada Lovelace'],
				['member-a2', 'Bea Noe']
			])
		: new Map([['member-b1', 'Bob Bass']]);
}

function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: DB_A, name: 'Sampledb', personId: 'person-p' }, { db: DB_B, name: 'Other Choir', personId: 'person-q' }] });
}

beforeEach(() => {
	listWorksMock.mockImplementation((cfg: { db: string }) => Promise.resolve(toListRead(worksFor(cfg.db))));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockImplementation((cfg: { db: string }) => Promise.resolve(borrowerNamesFor(cfg.db)));
	listAllEditionsMock.mockImplementation((cfg: { db: string }) => Promise.resolve(toListRead(editionsFor(cfg.db))));
	listAllCopiesMock.mockImplementation((cfg: { db: string }) => Promise.resolve(toListRead(copiesFor(cfg.db))));
	listActiveMembersMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(membersFor(cfg.db)))
	);
	resolveLibrarianMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve({ state: 'librarian', libraryId: cfg.db === DB_A ? 'lib-a' : 'lib-b' })
	);
	resolveMyLibraryIdMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === DB_A ? 'lib-a' : 'lib-b')
	);
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
});

type Answer = { state: string; libraryId: string | null };

function answersForA(queue: Array<Promise<Answer>>) {
	resolveLibrarianMock.mockImplementation((cfg: { db: string }) =>
		cfg.db === DB_A
			? (queue.shift() ?? Promise.resolve({ state: 'librarian', libraryId: 'lib-a' }))
			: Promise.resolve({ state: 'librarian', libraryId: 'lib-b' })
	);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function renderWithLibrarianError(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'librarian-retry-load')).not.toBeNull());
	return container;
}

describe('/library — #546 the librarian retry ignores a late answer', () => {
	it('a retry for A that answers after a switch to B leaves B\'s pickers', async () => {
		const retryA = deferred<Answer>();
		answersForA([Promise.resolve({ state: 'error', libraryId: null }), retryA.promise]);
		const container = await renderWithLibrarianError();

		await fireEvent.click(q(container, 'librarian-retry-load') as HTMLButtonElement);
		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() =>
			expect(q(container, 'bulk-checkout-work-select')?.textContent).toContain(
				'Cantique de Jean Racine'
			)
		);

		retryA.resolve({ state: 'librarian', libraryId: 'lib-a' });
		await settle();

		await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
			target: { value: 'work-b1' }
		});
		await waitFor(() => expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull());
		const editionSelect = q(container, 'bulk-checkout-edition-select') as HTMLSelectElement;
		expect([...editionSelect.options].map((o) => o.value)).toEqual(['', 'edition-b1']);
		await fireEvent.change(editionSelect, { target: { value: 'edition-b1' } });
		await waitFor(() => expect(q(container, 'bulk-checkout-member-list')).not.toBeNull());
		const members = container.querySelectorAll(
			'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]'
		);
		expect(members.length).toBe(1);
		expect(get(librarianStore)).toBe('librarian');
	});

	it('of two retries, the first answering last is ignored', async () => {
		const first = deferred<Answer>();
		const second = deferred<Answer>();
		answersForA([
			Promise.resolve({ state: 'error', libraryId: null }),
			first.promise,
			second.promise
		]);
		const container = await renderWithLibrarianError();

		await fireEvent.click(q(container, 'librarian-retry-load') as HTMLButtonElement);
		await fireEvent.click(q(container, 'librarian-retry-load') as HTMLButtonElement);
		second.resolve({ state: 'librarian', libraryId: 'lib-a' });
		await waitFor(() => expect(q(container, 'librarian-tools')).not.toBeNull());

		first.resolve({ state: 'error', libraryId: null });
		await settle();

		expect(get(librarianStore)).toBe('librarian');
		expect(q(container, 'librarian-tools')).not.toBeNull();
		expect(q(container, 'librarian-retry-load')).toBeNull();
	});
});
