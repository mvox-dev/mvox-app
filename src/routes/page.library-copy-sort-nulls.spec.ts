// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
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
		library_copy_sort_since: () => 'Since'
	}
}));

const {
	listWorksMock,
	listEditionsMock,
	listCopiesMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listLendingsMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock
} = vi.hoisted(() => ({
	listWorksMock: vi.fn(),
	listEditionsMock: vi.fn(),
	listCopiesMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listLendingsMock: vi.fn(),
	resolveBorrowerNamesMock: vi.fn(),
	resolveCopyNamesMock: vi.fn()
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
		resolveCopyNames: resolveCopyNamesMock
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
		...actual, // keep the real writable store + resetLibrarian
		resolveLibrarian: resolveLibrarianMock
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
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function setAuthedWithOneCollective() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
}

function setPartitionFixture() {
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listEditionsMock.mockResolvedValue(toListRead([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]));
	listCopiesMock.mockResolvedValue(toListRead([
		{ id: 'lent-alpha', name: 'Copy #8', copyNumber: 8, editionId: 'edition-1' },
		{ id: 'avail-none', name: '', copyNumber: 0, editionId: 'edition-1' },
		{ id: 'avail-three', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' },
		{ id: 'lent-none', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
		{ id: 'avail-one', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
		{ id: 'lent-beta', name: 'Copy #5', copyNumber: 5, editionId: 'edition-1' }
	]));
	listLendingsMock.mockResolvedValue(toListRead([
		{
			id: 'lend-alpha',
			copyId: 'lent-alpha',
			memberId: 'member-alpha',
			assignedAt: '',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-beta',
			copyId: 'lent-beta',
			memberId: 'member-beta',
			assignedAt: '2026-07-01',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-none',
			copyId: 'lent-none',
			memberId: 'member-noname',
			assignedAt: '2026-06-15',
			assignedUntil: '',
			returnedAt: ''
		}
	]));
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map([
			['member-alpha', 'Alpha Person'],
			['member-beta', 'Beta Person'],
			['member-noname', '']
		])
	);
	setAuthedWithOneCollective();
}

const sortBtn = (key: 'nr' | 'member' | 'since') =>
	`[data-testid="copy-sort-${key}-edition-1"]`;

function copyOrder(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid="library-edition-edition-1"] [data-testid^="library-copy-"]'
		)
	].map((el) => el.getAttribute('data-testid')!.replace('library-copy-', ''));
}

async function renderWithEditionUnfolded() {
	setPartitionFixture();
	const { container } = render(Page);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull()
	);
	await fireEvent.click(
		container.querySelector('[data-testid="library-work-toggle-work-1"]')!
	);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull()
	);
	await fireEvent.click(
		container.querySelector('[data-testid="library-edition-toggle-edition-1"]')!
	);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-copy-lent-alpha"]')).not.toBeNull()
	);
	return container;
}

async function activate(container: HTMLElement, key: 'nr' | 'member' | 'since') {
	await fireEvent.click(container.querySelector(sortBtn(key))!);
	await waitFor(() => {
		expect(container.querySelector(sortBtn(key))!.getAttribute('aria-checked')).toBe('true');
	});
}

const LENT_IDS = new Set(['lent-alpha', 'lent-beta', 'lent-none']);

afterEach(() => {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveCopyNamesMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	createLendingMock.mockReset();
	returnLendingMock.mockReset();
	bulkCheckoutMock.mockReset();
	resetAppState();
});

describe('/library — copy sort is PARTITION-then-sort: lent group first, available group always nr-sorted (#126 / #114 F6)', () => {
	it('nr: lent copies sorted by nr, then available copies sorted by nr — partition boundary holds', async () => {
		const container = await renderWithEditionUnfolded();
		expect(copyOrder(container)).toEqual([
			'lent-none',
			'lent-beta',
			'lent-alpha',
			'avail-one',
			'avail-three',
			'avail-none'
		]);
	});

	it("member: lent copies sorted by borrower name (nameless sorts last WITHIN the lent group), then available copies sorted by nr", async () => {
		const container = await renderWithEditionUnfolded();
		await activate(container, 'member');

		const order = copyOrder(container);
		expect(order.slice(0, 3)).toEqual(['lent-alpha', 'lent-beta', 'lent-none']);
		expect(order.slice(3)).toEqual(['avail-one', 'avail-three', 'avail-none']);
	});

	it('since: lent copies sorted by lending date (undated active lending sorts last WITHIN the lent group), then available copies sorted by nr', async () => {
		const container = await renderWithEditionUnfolded();
		await activate(container, 'since');

		const order = copyOrder(container);
		expect(order.slice(0, 3)).toEqual(['lent-none', 'lent-beta', 'lent-alpha']);
		expect(order.slice(3)).toEqual(['avail-one', 'avail-three', 'avail-none']);
	});

	it('partition boundary holds under every key: no available copy ever appears before a lent copy', async () => {
		const container = await renderWithEditionUnfolded();

		for (const key of ['nr', 'member', 'since'] as const) {
			await activate(container, key);
			const order = copyOrder(container);
			const lastLentIndex = Math.max(...order.map((id, i) => (LENT_IDS.has(id) ? i : -1)));
			const firstAvailableIndex = order.findIndex((id) => !LENT_IDS.has(id));
			expect(firstAvailableIndex, `key=${key}`).toBeGreaterThan(lastLentIndex);
		}
	});
});

// (*MVOX:Tallis chain — RED by red-126, corrected to partition-then-sort by fix-f6*)
