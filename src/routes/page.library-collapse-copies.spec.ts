// @vitest-environment happy-dom
//
// #128 RED — member (non-librarian) view collapses AVAILABLE copies into one
// summary line; lent-out copies keep rendering individually.
//
// Today the copy list inside an unfolded edition renders EVERY copy as its own
// row for everyone. Per #126 the list is partitioned lent-first / available-
// second; #128 collapses the available block for members. The contract pinned
// here:
//
//   - member view: lent copies render individually (unchanged); available
//     copies do NOT get individual rows — instead ONE summary line with the
//     available count renders where the available block was;
//   - the summary line carries data-testid="library-available-summary-<editionId>"
//     (per edition — each unfolded edition's copy list collapses independently)
//     and its text comes from a message key, mocked here as
//     library_available_summary → "<count> copies available for lending";
//   - librarian view: NO collapse — every copy renders individually (the
//     available rows carry the inline-checkout affordance) and no summary line
//     appears;
//   - all-available edge (member): only the summary line, zero individual rows;
//   - all-lent edge: no summary line (a "0 copies available" line is noise).
//
// Route-level integration tests on the REAL /library +page.svelte (same
// composition page.library.spec.ts and page.library-copy-sort.spec.ts drive):
// render the route, expand the real work → edition nodes, assert on the DOM —
// so a helper-only implementation cannot go green here.
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
		library_librarian_load_error: () => 'Could not check librarian access.',
		library_librarian_retry: () => 'Retry',
		library_my_loans_title: (p: { count: number }) => `My loans (${p.count})`,
		library_my_loans_copy_label: (p: { copyName: string }) => `${p.copyName}`,
		library_my_loans_overdue: () => 'Overdue',
		library_checkout_copy_placeholder: () => 'Select copy',
		library_checkout_member_placeholder: () => 'Select member',
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
		// #128 — the collapsed-available summary line (GREEN adds the real key to
		// messages/*.json; the mock pins the key NAME and the count param).
		library_available_summary: (p: { count: number }) =>
			`${p.count} copies available for lending`
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
// vi.importActual for $lib/library/libraryData pulls entuFetch -> $lib/entu-config,
// which reads $env/dynamic/public — unavailable outside a SvelteKit request
// context under happy-dom. Same fix as page.library.spec.ts.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

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
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

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
	listAllEditionsMock.mockResolvedValue([]);
	listAllCopiesMock.mockResolvedValue([]);
	listActiveMembersMock.mockResolvedValue([]);
}

type Fixture = {
	/** copy ids that carry an active lending */
	lent: string[];
	/** copy ids with no active lending */
	available: string[];
};

/**
 * One work, one edition, five copies. Which are lent vs available is chosen
 * per test:
 *
 *   copy-a (nr 1) … copy-e (nr 5)
 *
 * Lendings are generated for the requested `lent` ids (distinct borrowers,
 * distinct dates) so the lent rows are real, individually-rendered rows.
 */
function setFixture({ lent, available }: Fixture) {
	const all = [...lent, ...available];
	listWorksMock.mockResolvedValue([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]);
	listEditionsMock.mockResolvedValue([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]);
	listCopiesMock.mockResolvedValue(
		all.map((id, i) => ({
			id,
			name: `Copy #${i + 1}`,
			copyNumber: i + 1,
			editionId: 'edition-1'
		}))
	);
	const borrowers = ['Adam Aber', 'Beata Berg', 'Carl Corno', 'Dora Dux', 'Enn Erg'];
	listLendingsMock.mockResolvedValue(
		lent.map((copyId, i) => ({
			id: `lend-${copyId}`,
			copyId,
			memberId: `member-${i}`,
			assignedAt: `2026-07-0${i + 1}`,
			assignedUntil: '',
			returnedAt: ''
		}))
	);
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map(lent.map((_, i) => [`member-${i}`, borrowers[i]]))
	);
	setAuthedWithOneCollective();
}

const SUMMARY = '[data-testid="library-available-summary-edition-1"]';

/** The copy rows of edition-1, as copy ids, in DOM order. */
function copyRows(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid="library-edition-edition-1"] [data-testid^="library-copy-"]'
		)
	].map((el) => el.getAttribute('data-testid')!.replace('library-copy-', ''));
}

/** Render /library and unfold work-1 → edition-1 (does NOT wait for copies —
 *  which nodes exist after copy load differs per scenario, so each test waits
 *  for its own anchor). */
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/library — member view collapses available copies (#128)', () => {
	it('member view: lent copies render individually, available copies collapse into ONE summary line with the count', async () => {
		setFixture({ lent: ['copy-b', 'copy-c'], available: ['copy-a', 'copy-d', 'copy-e'] });
		const container = await renderWithEditionUnfolded();

		// Lent rows are still individual rows (unchanged by #128).
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-b"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="library-copy-copy-c"]')).not.toBeNull();

		// The available copies do NOT render as individual rows…
		expect(copyRows(container).sort()).toEqual(['copy-b', 'copy-c']);
		for (const id of ['copy-a', 'copy-d', 'copy-e']) {
			expect(
				container.querySelector(`[data-testid="library-copy-${id}"]`),
				`individual row for available ${id}`
			).toBeNull();
		}

		// …instead exactly ONE summary line appears, with the correct count.
		const summaries = container.querySelectorAll(SUMMARY);
		expect(summaries.length, 'summary line count').toBe(1);
		expect(summaries[0].textContent).toContain('3 copies available for lending');
	});

	it('librarian view: NO collapse — every copy renders individually and no summary line appears', async () => {
		setFixture({ lent: ['copy-b', 'copy-c'], available: ['copy-a', 'copy-d', 'copy-e'] });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		const container = await renderWithEditionUnfolded();

		// Librarian state settled (tools revealed) before asserting rows — GREEN
		// must not collapse for librarians even transiently once resolved.
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
