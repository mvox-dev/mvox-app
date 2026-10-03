// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
		library_available_summary: (p: { count: number }) =>
			`${p.count} copies available for lending`
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
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
}

type Fixture = {
	lent: string[];
	available: string[];
};

function setFixture({ lent, available }: Fixture) {
	const all = [...lent, ...available];
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listEditionsMock.mockResolvedValue(toListRead([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]));
	listCopiesMock.mockResolvedValue(toListRead(
		all.map((id, i) => ({
			id,
			name: `Copy #${i + 1}`,
			copyNumber: i + 1,
			editionId: 'edition-1'
		}))
	));
	const borrowers = ['Adam Aber', 'Beata Berg', 'Carl Corno', 'Dora Dux', 'Enn Erg'];
	listLendingsMock.mockResolvedValue(toListRead(
		lent.map((copyId, i) => ({
			id: `lend-${copyId}`,
			copyId,
			memberId: `member-${i}`,
			assignedAt: `2026-07-0${i + 1}`,
			assignedUntil: '',
			returnedAt: ''
		}))
	));
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map(lent.map((_, i) => [`member-${i}`, borrowers[i]]))
	);
	setAuthedWithOneCollective();
}

const SUMMARY = '[data-testid="library-available-summary-edition-1"]';

function copyRows(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid="library-edition-edition-1"] [data-testid^="library-copy-"]'
		)
	].map((el) => el.getAttribute('data-testid')!.replace('library-copy-', ''));
}

async function renderWithEditionUnfolded() {
	const { container } = render(Page);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull()
	);
	await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]')!);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull()
	);
	await fireEvent.click(
		container.querySelector('[data-testid="library-edition-toggle-edition-1"]')!
	);
	return container;
}

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

describe('/library — member view collapses available copies (#128)', () => {
	it('member view: lent copies render individually, available copies collapse into ONE summary line with the count', async () => {
		setFixture({ lent: ['copy-b', 'copy-c'], available: ['copy-a', 'copy-d', 'copy-e'] });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-b"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="library-copy-copy-c"]')).not.toBeNull();

		expect(copyRows(container).sort()).toEqual(['copy-b', 'copy-c']);
		for (const id of ['copy-a', 'copy-d', 'copy-e']) {
			expect(
				container.querySelector(`[data-testid="library-copy-${id}"]`),
				`individual row for available ${id}`
			).toBeNull();
		}

		const summaries = container.querySelectorAll(SUMMARY);
		expect(summaries.length, 'summary line count').toBe(1);
		expect(summaries[0].textContent).toContain('3 copies available for lending');
	});

	it('librarian view: NO collapse — every copy renders individually and no summary line appears', async () => {
		setFixture({ lent: ['copy-b', 'copy-c'], available: ['copy-a', 'copy-d', 'copy-e'] });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull()
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
		);

		expect(copyRows(container).sort()).toEqual([
			'copy-a',
			'copy-b',
			'copy-c',
			'copy-d',
			'copy-e'
		]);
		expect(container.querySelector(SUMMARY)).toBeNull();
	});

	it('member view, ALL copies available: only the summary line renders — zero individual rows', async () => {
		setFixture({ lent: [], available: ['copy-a', 'copy-b', 'copy-c'] });
		const container = await renderWithEditionUnfolded();

		await waitFor(() => expect(container.querySelector(SUMMARY)).not.toBeNull());
		expect(container.querySelector(SUMMARY)!.textContent).toContain(
			'3 copies available for lending'
		);
		expect(copyRows(container)).toEqual([]);
	});

	it('librarian view, ALL copies available: all rows render individually, no summary line', async () => {
		setFixture({ lent: [], available: ['copy-a', 'copy-b', 'copy-c'] });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull()
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
		);

		expect(copyRows(container).sort()).toEqual(['copy-a', 'copy-b', 'copy-c']);
		expect(container.querySelector(SUMMARY)).toBeNull();
	});

	it('member view, ALL copies lent: every row renders individually and NO summary line appears (count 0 is noise)', async () => {
		setFixture({ lent: ['copy-a', 'copy-b', 'copy-c'], available: [] });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
		);

		expect(copyRows(container).sort()).toEqual(['copy-a', 'copy-b', 'copy-c']);
		expect(container.querySelector(SUMMARY)).toBeNull();
	});
});

// (*MVOX:Tallis*)
