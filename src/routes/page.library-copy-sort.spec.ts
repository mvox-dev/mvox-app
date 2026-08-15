// @vitest-environment happy-dom
//
// #112/#88 RED — the copy list inside an unfolded edition gets SORT controls:
// nr (copy number) / member (borrower name) / since (lending date).
//
// Today the copies render in whatever order listCopies delivered them — no
// controls, no ordering guarantee. The contract pinned here:
//
//   - three labeled sort controls per unfolded edition, testids
//     copy-sort-nr-<editionId> / copy-sort-member-<editionId> /
//     copy-sort-since-<editionId>, with aria-checked marking the active key;
//   - default sort is nr, ascending — REGARDLESS of fetch order;
//   - member sorts by borrower name (A→Z), since sorts by lending start date
//     (oldest loan first — longest-out copies surface for the librarian);
//   - null/undefined sorts LAST under EVERY key: a copy with no borrower and
//     no lending date (unassigned) lands at the bottom under member and since;
//     a copy with no copy number lands at the bottom under nr.
//
// Route-level integration tests on the REAL /library +page.svelte (same
// composition page.library.spec.ts drives): render the route, expand the real
// work → edition nodes, click the real controls, assert on DOM order — so an
// implementation that only makes a sort helper's unit test pass without wiring
// the controls into the page cannot go green here.
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/svelte';
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
		// #112/#88 — the copy-sort controls' labels (GREEN adds the real keys to
		// messages/*.json; the mock pins the key NAMES the page must use).
		library_copy_sort_label: () => 'Sort copies by',
		library_copy_sort_nr: () => 'Nr',
		library_copy_sort_member: () => 'Member',
		library_copy_sort_since: () => 'Since',
		// #128 — collapsed-available summary line
		library_available_summary: (p: { count: number }) => `${p.count} copies available for lending`
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
	// #128 collapses available copies into a summary for MEMBER view, which
	// would hide the individual rows this spec sorts. Sort mechanics
	// (sortCopies) are unaffected by librarian status, and #128 explicitly
	// leaves the librarian view unchanged, so render as librarian here to
	// keep every copy an individually-sortable row.
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue([]);
	listAllCopiesMock.mockResolvedValue([]);
	listActiveMembersMock.mockResolvedValue([]);
}

/**
 * One work, one edition, FOUR copies delivered deliberately OUT of nr order —
 * so the default-sort assertion can only pass if the page actually sorts:
 *
 *   fetch order:  copy-a (nr 3, unassigned)
 *                 copy-d (no nr, unassigned)      ← null on EVERY sort key
 *                 copy-b (nr 1, Zara Zilch,  since 2026-07-15)
 *                 copy-c (nr 2, Adam Aber,   since 2026-06-01)
 *
 *   by nr:      b(1), c(2), a(3), d(no nr → last)
 *   by member:  c(Adam), b(Zara), then the unassigned {a, d} last
 *   by since:   c(2026-06-01), b(2026-07-15), then the unassigned {a, d} last
 */
function setSortFixture() {
	listWorksMock.mockResolvedValue([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]);
	listEditionsMock.mockResolvedValue([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]);
	listCopiesMock.mockResolvedValue([
		{ id: 'copy-a', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' },
		{ id: 'copy-d', name: '', copyNumber: 0, editionId: 'edition-1' },
		{ id: 'copy-b', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
		{ id: 'copy-c', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
	]);
	listLendingsMock.mockResolvedValue([
		{
			id: 'lend-b',
			copyId: 'copy-b',
			memberId: 'member-z',
			assignedAt: '2026-07-15',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-c',
			copyId: 'copy-c',
			memberId: 'member-a',
			assignedAt: '2026-06-01',
			assignedUntil: '',
			returnedAt: ''
		}
	]);
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map([
			['member-z', 'Zara Zilch'],
			['member-a', 'Adam Aber']
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
	setSortFixture();
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
	// Librarian state settled (tools revealed) before asserting rows — matches
	// #128's own settling pattern, avoiding a transient not-librarian render.
	await waitFor(() =>
		expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull()
	);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
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

describe('/library — copy list sort controls (#112/#88)', () => {
	it('an unfolded edition shows three visible, labeled sort controls: nr / member / since', async () => {
		const container = await renderWithEditionUnfolded();

		const nr = container.querySelector(sortBtn('nr'));
		const member = container.querySelector(sortBtn('member'));
		const since = container.querySelector(sortBtn('since'));
		expect(nr).not.toBeNull();
		expect(member).not.toBeNull();
		expect(since).not.toBeNull();

		// Labeled — each control carries its human-readable label.
		expect(nr!.textContent).toContain('Nr');
		expect(member!.textContent).toContain('Member');
		expect(since!.textContent).toContain('Since');

		// And they live INSIDE the unfolded edition node, next to the list they
		// sort — not in some page-level toolbar.
		for (const el of [nr, member, since]) {
			expect(el!.closest('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		}
	});

	it('default sort is by nr, ascending — even though the fetch delivered the copies out of order', async () => {
		const container = await renderWithEditionUnfolded();

		// nr 1, 2, 3, then the number-less copy last (null sorts last under
		// EVERY key, including the default).
		expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);

		// The active key is marked — nr checked, the others not.
		expect(container.querySelector(sortBtn('nr'))!.getAttribute('aria-checked')).toBe('true');
		expect(container.querySelector(sortBtn('member'))!.getAttribute('aria-checked')).toBe(
			'false'
		);
		expect(container.querySelector(sortBtn('since'))!.getAttribute('aria-checked')).toBe(
			'false'
		);
	});

	it('sorting by member orders by borrower name A→Z; unassigned copies (no borrower) sort LAST', async () => {
		const container = await renderWithEditionUnfolded();

		await fireEvent.click(container.querySelector(sortBtn('member'))!);
		await waitFor(() => {
			expect(
				container.querySelector(sortBtn('member'))!.getAttribute('aria-checked')
			).toBe('true');
		});

		const order = copyOrder(container);
		// Adam Aber (copy-c) before Zara Zilch (copy-b)…
		expect(order.slice(0, 2)).toEqual(['copy-c', 'copy-b']);
		// …and BOTH unassigned copies after every assigned one (their relative
		// order among themselves is not pinned here).
		expect(new Set(order.slice(2))).toEqual(new Set(['copy-a', 'copy-d']));
	});

	it('sorting by since orders by lending start date, oldest loan first; copies with no lending date sort LAST', async () => {
		const container = await renderWithEditionUnfolded();

		await fireEvent.click(container.querySelector(sortBtn('since'))!);
		await waitFor(() => {
			expect(container.querySelector(sortBtn('since'))!.getAttribute('aria-checked')).toBe(
				'true'
			);
		});

		const order = copyOrder(container);
		// 2026-06-01 (copy-c) before 2026-07-15 (copy-b) — longest-out first…
		expect(order.slice(0, 2)).toEqual(['copy-c', 'copy-b']);
		// …and the never-lent copies land at the bottom.
		expect(new Set(order.slice(2))).toEqual(new Set(['copy-a', 'copy-d']));
	});

	it('switching sort keys re-orders the SAME list in place — member, then back to nr restores the default order', async () => {
		const container = await renderWithEditionUnfolded();
		expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);

		await fireEvent.click(container.querySelector(sortBtn('member'))!);
		await waitFor(() => {
			expect(copyOrder(container).slice(0, 2)).toEqual(['copy-c', 'copy-b']);
		});

		await fireEvent.click(container.querySelector(sortBtn('nr'))!);
		await waitFor(() => {
			expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);
		});
		// The checked marker followed the switch back.
		expect(container.querySelector(sortBtn('nr'))!.getAttribute('aria-checked')).toBe('true');
		expect(container.querySelector(sortBtn('member'))!.getAttribute('aria-checked')).toBe(
			'false'
		);

		// Re-sorting is a VIEW concern — no refetch of the copies.
		expect(listCopiesMock).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// #113 TU.5 — a11y pass over the sort controls: they must be a NAMED group of
// native (keyboard-operable) buttons, with aria-checked as the single source of
// "which key is active". Route-level, same composition as above.
//
// #156 — the group is a role="radiogroup" of role="radio" buttons, and the
// state pin moved off the old pressed-state, which is an invalid ARIA mix on
// role="radio" (the same trap page.sections-a11y.spec.ts caught on
// role="option"). The role is load-bearing rather than cosmetic: arrow keys
// here MOVE AND SELECT, which is radiogroup behaviour, whereas the app's other
// roving groups are role="toolbar" and only move focus.
// ---------------------------------------------------------------------------
describe('/library — copy-sort controls a11y (#113)', () => {
	it('the three controls live in a role="radiogroup" with an m.* accessible name, each a role="radio"', async () => {
		const container = await renderWithEditionUnfolded();
		const group = container.querySelector('[data-testid="copy-sort-edition-1"]');
		expect(group, 'the sort control group').not.toBeNull();
		expect(group!.getAttribute('role')).toBe('radiogroup');
		expect(group!.getAttribute('aria-label')).toBe('Sort copies by');
		for (const key of ['nr', 'member', 'since'] as const) {
			expect(container.querySelector(sortBtn(key))!.closest('[role="radiogroup"]')).toBe(group);
			expect(container.querySelector(sortBtn(key))!.getAttribute('role')).toBe('radio');
		}
	});

	it('every sort control is a native <button type="button"> — Enter/Space operability for free, and no accidental form submits', async () => {
		const container = await renderWithEditionUnfolded();
		for (const key of ['nr', 'member', 'since'] as const) {
			const btn = container.querySelector(sortBtn(key)) as HTMLElement;
			expect(btn.tagName, `copy-sort-${key}`).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
		}
	});

	it('exactly ONE control reports aria-checked="true" at any time, and the marker follows a key switch', async () => {
		const container = await renderWithEditionUnfolded();
		const pressed = () =>
			(['nr', 'member', 'since'] as const).filter(
				(key) => container.querySelector(sortBtn(key))!.getAttribute('aria-checked') === 'true'
			);
		expect(pressed()).toEqual(['nr']);
		await fireEvent.click(container.querySelector(sortBtn('since'))!);
		await waitFor(() => {
			expect(pressed()).toEqual(['since']);
		});
	});
});

// ---------------------------------------------------------------------------
// #156 — roving tabindex on the copy-sort chips. RADIOGROUP semantics: arrows
// MOVE focus AND SELECT, matching the role in the markup. (The app's other
// roving groups are role="toolbar" and only move focus — the two must stay
// distinguishable to assistive tech, which is why the roles are asserted.)
// ---------------------------------------------------------------------------
describe('/library — copy-sort chips: roving tabindex (#156)', () => {
	const KEYS = ['nr', 'member', 'since'] as const;

	function chips(container: HTMLElement): HTMLButtonElement[] {
		return KEYS.map((key) => container.querySelector(sortBtn(key)) as HTMLButtonElement);
	}
	function stops(container: HTMLElement): HTMLButtonElement[] {
		return chips(container).filter((c) => c.getAttribute('tabindex') === '0');
	}

	it('exactly ONE chip is the Tab stop, and it is the checked key', async () => {
		const container = await renderWithEditionUnfolded();
		expect(stops(container)).toEqual([chips(container)[0]]);
	});

	it('ArrowRight moves focus AND selects the next chip, wrapping at the end', async () => {
		const container = await renderWithEditionUnfolded();
		const [nr, member, since] = chips(container);

		nr.focus();
		await fireEvent.keyDown(nr, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(member.getAttribute('aria-checked')).toBe('true');
		});
		expect(document.activeElement).toBe(member);
		expect(stops(container)).toEqual([member]);

		await fireEvent.keyDown(member, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(since.getAttribute('aria-checked')).toBe('true');
		});

		await fireEvent.keyDown(since, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(nr.getAttribute('aria-checked')).toBe('true');
		});
	});

	it('ArrowLeft wraps backwards from the first chip to the last', async () => {
		const container = await renderWithEditionUnfolded();
		const [nr, , since] = chips(container);
		nr.focus();
		await fireEvent.keyDown(nr, { key: 'ArrowLeft' });
		await waitFor(() => {
			expect(since.getAttribute('aria-checked')).toBe('true');
		});
		expect(document.activeElement).toBe(since);
	});

	it('selecting by arrow re-sorts the list, exactly as a click does', async () => {
		const container = await renderWithEditionUnfolded();
		expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);
		const [nr] = chips(container);
		nr.focus();
		await fireEvent.keyDown(nr, { key: 'ArrowRight' }); // → member
		await waitFor(() => {
			expect(copyOrder(container).slice(0, 2)).toEqual(['copy-c', 'copy-b']);
		});
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus leaves the group and the chip still activates', async () => {
		const container = await renderWithEditionUnfolded();
		const chip = chips(container)[0];
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(chip, { key });
			fireEvent(chip, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});
});

// (*MVOX:Tallis*)
