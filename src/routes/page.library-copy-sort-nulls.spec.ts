// @vitest-environment happy-dom
//
// #126 (#114 F6) RED — copy-list sort: nulls last under EVERY key and EVERY
// direction, for the null shapes the live gate actually surfaced.
//
// The #112 sort shipped with a nulls-last comparator, but the live walk
// (#114 Check 11) still saw null values intermixed. Two real shapes defeat it:
//
//   1. NAMELESS BORROWER — resolveBorrowerName (libraryData.ts) returns ''
//      (empty string, NOT null) when a member has no readable domain/public
//      profile name. The page's `?? null` fallback never fires on '', and
//      ''.localeCompare(anything) sorts it FIRST — an "Out — an unnamed
//      member" row lands ABOVE every real name under the member key.
//   2. UNDATED ACTIVE LENDING — live polyphony has active lendings with no
//      assigned_at (probed 2026-08-12: lendings …307ed5, …307ee7). Under the
//      since key that copy must sort with the nulls, at the bottom.
//
// And the direction contract: clicking the ACTIVE sort key toggles
// ascending ↔ descending. Nulls stay LAST in BOTH directions — a naive
// comparator reversal would flip them to the top. (No direction toggle
// exists today at all, so every descending test here is RED.)
//
// Route-level on the REAL /library +page.svelte, same composition as
// page.library-copy-sort.spec.ts — order is asserted on rendered DOM rows, so
// a helper-only fix that isn't wired into the page cannot go green.
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

/**
 * One work, one edition, FOUR copies — every null shape the live gate hit,
 * delivered deliberately OUT of order so stable-sort artifacts can't fake a
 * pass:
 *
 *   fetch order:  copy-three (nr 3, lent to Alpha Person, NO assigned_at)
 *                 copy-none  (no nr, unassigned)          ← null on EVERY key
 *                 copy-two   (nr 2, lent to Beta Person,  since 2026-07-01)
 *                 copy-one   (nr 1, lent to a NAMELESS member, since 2026-06-15)
 *
 * member-noname resolves to '' — the exact resolveBorrowerName contract for a
 * member with no readable domain/public profile name (libraryData.ts). The
 * page must treat that '' as "no value": nulls-LAST, not empty-string-first.
 *
 *   by nr   asc:  one(1), two(2), three(3) | none
 *   by nr   desc: three(3), two(2), one(1) | none               ← STILL last
 *   member  asc:  three(Alpha), two(Beta)  | {one(nameless), none}
 *   member  desc: two(Beta), three(Alpha)  | {one(nameless), none}
 *   since   asc:  one(06-15), two(07-01)   | {three(undated), none}
 *   since   desc: two(07-01), one(06-15)   | {three(undated), none}
 */
function setNullShapesFixture() {
	listWorksMock.mockResolvedValue([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]);
	listEditionsMock.mockResolvedValue([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]);
	listCopiesMock.mockResolvedValue([
		{ id: 'copy-three', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' },
		{ id: 'copy-none', name: '', copyNumber: 0, editionId: 'edition-1' },
		{ id: 'copy-two', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
		{ id: 'copy-one', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
	]);
	listLendingsMock.mockResolvedValue([
		{
			id: 'lend-three',
			copyId: 'copy-three',
			memberId: 'member-alpha',
			// live shape: active lending, assigned_at absent (e.g. lending …307ed5)
			assignedAt: '',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-two',
			copyId: 'copy-two',
			memberId: 'member-beta',
			assignedAt: '2026-07-01',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-one',
			copyId: 'copy-one',
			memberId: 'member-noname',
			assignedAt: '2026-06-15',
			assignedUntil: '',
			returnedAt: ''
		}
	]);
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map([
			['member-alpha', 'Alpha Person'],
			['member-beta', 'Beta Person'],
			// resolveBorrowerName's documented no-readable-name result: '' (NOT null)
			['member-noname', '']
		])
	);
	setAuthedWithOneCollective();
}

const sortBtn = (key: 'nr' | 'member' | 'since') =>
	`[data-testid="copy-sort-${key}-edition-1"]`;

/** The copy rows of edition-1, as copy ids, in DOM order. */
function copyOrder(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid="library-edition-edition-1"] [data-testid^="library-copy-"]'
		)
	].map((el) => el.getAttribute('data-testid')!.replace('library-copy-', ''));
}

async function renderWithEditionUnfolded() {
	setNullShapesFixture();
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
		expect(container.querySelector('[data-testid="library-copy-copy-one"]')).not.toBeNull()
	);
	return container;
}

/** Click a sort control and wait for it to become the active (pressed) key. */
async function activate(container: HTMLElement, key: 'nr' | 'member' | 'since') {
	await fireEvent.click(container.querySelector(sortBtn(key))!);
	await waitFor(() => {
		expect(container.querySelector(sortBtn(key))!.getAttribute('aria-pressed')).toBe('true');
	});
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

describe('/library — copy sort pushes nulls LAST, ascending (#126 / #114 F6)', () => {
	it('nr ascending: numbered copies in order, the number-less copy last', async () => {
		const container = await renderWithEditionUnfolded();
		// default key is nr, ascending — no click needed
		expect(copyOrder(container)).toEqual(['copy-one', 'copy-two', 'copy-three', 'copy-none']);
	});

	it("member ascending: a borrower whose name resolved to '' counts as NO value — that copy sorts LAST with the unassigned one, never above real names", async () => {
		const container = await renderWithEditionUnfolded();
		await activate(container, 'member');

		const order = copyOrder(container);
		// Real names first, A→Z: Alpha Person (copy-three), Beta Person (copy-two)…
		expect(order.slice(0, 2)).toEqual(['copy-three', 'copy-two']);
		// …then BOTH no-name copies — the nameless borrower's copy (copy-one) and
		// the unassigned copy — at the bottom. Today copy-one's '' localeCompares
		// BEFORE 'Alpha Person' and surfaces at the top: the F6 intermix.
		expect(new Set(order.slice(2))).toEqual(new Set(['copy-one', 'copy-none']));
	});

	it('since ascending: dated loans oldest-first, the undated active loan and the never-lent copy LAST', async () => {
		const container = await renderWithEditionUnfolded();
		await activate(container, 'since');

		const order = copyOrder(container);
		expect(order.slice(0, 2)).toEqual(['copy-one', 'copy-two']);
		expect(new Set(order.slice(2))).toEqual(new Set(['copy-three', 'copy-none']));
	});
});

// (*MVOX:Tallis chain — RED by red-126*)
