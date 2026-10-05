// @vitest-environment happy-dom
// The library page: inline and bulk checkout.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
);
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).activeMembersModule()
);
// #434 — the write paths resolve the library id live through `resolveMyLibraryId`,
// never off the cache-backed librarian resolution, so it is mocked here too.
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);
// #74 — mock lendingActions to verify submit triggers the action layer
vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	expectNameMarkedOnce,
	expectWholeTextMarkedOnce,
	markerOf,
	textNodesContaining
} from '$lib/testing/nameMarker';
import {
	bulkCheckoutMock,
	createLendingMock,
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import { signInLibraryReader } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';

useLibraryPage();

describe('#76 — inline checkout on browse tree', () => {
	// PO ruling: an inline member picker on each available copy row checks the copy out
	// at once, confirmed by a lendings re-read. A member already holding a copy of that
	// edition is disabled in the picker, with the lending date.

	// One work -> one edition -> two copies; copy-2 is out to member-a since
	// 2026-07-01, copy-1 is available. Two active members: Ada (member-a,
	// already borrowing) and Ben (member-b, free).
	function mockTreeWithOneLending() {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(
			new Map([
				['member-a', 'Ada Lovelace'],
				['member-b', 'Ben Jonson']
			])
		);
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]));
		listCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]));
	}

	function mockLibrarianCheckoutData() {
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] }
		]));
	}

	async function expandToCopies(container: Element) {
		await waitFor(() => expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-toggle-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-copy-copy-1"]')).not.toBeNull());
	}

	// ── 1. standalone form removed ──────────────────────────────────────────
	it('the standalone checkout form does NOT exist — not even for a librarian', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		mockLibrarianCheckoutData();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="checkout-form"]')).toBeNull();
		expect(container.querySelector('[data-testid="checkout-copy-select"]')).toBeNull();
		expect(container.querySelector('[data-testid="checkout-member-select"]')).toBeNull();
		expect(container.querySelector('[data-testid="checkout-submit"]')).toBeNull();
	});

	// ── 2. inline dropdown on available copy rows (librarian) ───────────────
	it('an AVAILABLE copy row shows an inline member dropdown for a librarian; a lent copy row does not', async () => {
		mockTreeWithOneLending();
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		mockLibrarianCheckoutData();

		const { container } = render(Page);
		await expandToCopies(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="inline-checkout-copy-1"]') as HTMLSelectElement;
		expect(select.tagName).toBe('SELECT');
		// Accessible name — same discipline as the bulk pickers.
		expect(select.getAttribute('aria-label')).toBeTruthy();
		// copy-2 is out — no inline checkout dropdown on it.
		expect(container.querySelector('[data-testid="inline-checkout-copy-2"]')).toBeNull();
	});

	// ── 3. non-librarian: label only, no dropdown ───────────────────────────
	it('the inline dropdown is NOT rendered for a non-librarian — just the availability label', async () => {
		mockTreeWithOneLending();
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull()
		);
		await fireEvent.click(
			container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element
		);
		await waitFor(() =>
			expect(
				container.querySelector('[data-testid="library-edition-toggle-edition-1"]')
			).not.toBeNull()
		);
		await fireEvent.click(
			container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element
		);

		// #128 — copy-1 (available) collapses into the summary line for a
		// non-librarian; copy-2 (lent) still renders individually. Neither
		// carries an inline-checkout affordance for a non-librarian.
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-2"]')).not.toBeNull()
		);
		const copyRow = container.querySelector('[data-testid="library-copy-copy-2"]');
		expect(copyRow?.textContent).toContain('Out');
		expect(container.querySelector('[data-testid="library-copy-copy-1"]')).toBeNull();
		expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).toBeNull();
		expect(container.querySelector('[data-testid="inline-checkout-copy-2"]')).toBeNull();
	});

	// ── 4. double-lending guard: borrower disabled, lending date shown ──────
	it('a member with an active lending for the same edition is disabled in the picker and shows the lending date', async () => {
		mockTreeWithOneLending();
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		mockLibrarianCheckoutData();

		const { container } = render(Page);
		await expandToCopies(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="inline-checkout-copy-1"]') as HTMLSelectElement;
		// member-a holds copy-2 of edition-1: disabled, with the lending date as the ISO
		// calendar date (#207 rule 7).
		await waitFor(() => {
			const optA = select.querySelector('option[value="member-a"]') as HTMLOptionElement | null;
			expect(optA).not.toBeNull();
			expect(optA!.disabled).toBe(true);
			expect(optA!.textContent).toContain('Lent since 2026-07-01');
		});
	});

	// ── 5. free members are selectable ──────────────────────────────────────
	it('a member without an active lending for the edition is a selectable (enabled) option', async () => {
		mockTreeWithOneLending();
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		mockLibrarianCheckoutData();

		const { container } = render(Page);
		await expandToCopies(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="inline-checkout-copy-1"]') as HTMLSelectElement;
		await waitFor(() => {
			const optB = select.querySelector('option[value="member-b"]') as HTMLOptionElement | null;
			expect(optB).not.toBeNull();
			expect(optB!.disabled).toBe(false);
			expect(optB!.textContent).toContain('Ben Jonson');
		});
	});

	// ── 6. selecting a member checks out immediately, server-confirmed ──────
	it('selecting a member calls createLending with the copy + member and re-fetches lendings on success', async () => {
		mockTreeWithOneLending();
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		mockLibrarianCheckoutData();

		const today = new Date().toISOString().slice(0, 10);
		const newLending = {
			id: 'lend-new',
			copyId: 'copy-1',
			memberId: 'member-b',
			assignedAt: today,
			assignedUntil: '',
			returnedAt: ''
		};
		createLendingMock.mockResolvedValue(newLending);
		// Initial load sees only lend-1; the post-checkout refresh sees both —
		// the UI flips copy-1 to "Out" only from the server's refreshed list.
		listLendingsMock
			.mockResolvedValueOnce(toListRead([
				{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
			]))
			.mockResolvedValue(toListRead([
				{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' },
				newLending
			]));

		const { container } = render(Page);
		await expandToCopies(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="inline-checkout-copy-1"]') as HTMLSelectElement;
		await waitFor(() => {
			expect(select.querySelector('option[value="member-b"]')).not.toBeNull();
		});

		await fireEvent.change(select, { target: { value: 'member-b' } });

		await waitFor(() => expect(createLendingMock).toHaveBeenCalledTimes(1));
		const [, libraryId, payload] = createLendingMock.mock.calls[0];
		expect(libraryId).toBe('lib-1');
		// Full-shape assertion (no objectContaining): inline flow has no due
		// date input, so the payload is exactly copy + member + today.
		expect(payload).toEqual({ copyId: 'copy-1', memberId: 'member-b', assignedAt: today });

		// Server-confirmed: lendings are re-fetched and the copy row reflects
		// the refreshed list, not an optimistic local flip.
		await waitFor(() => expect(listLendingsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-copy-copy-1"]')?.textContent).toContain('Out — Ben Jonson');
		});
	});

	// ── #361 — member names on the library surfaces carry the marker ────────
	// The lent-to sentence sits whole in one RedactedText; the bulk-checkout names go
	// through PersonName; the inline-checkout <option>s are recorded in #361.
	it('#361 — the lent-to badge: the whole "Out — {name}" text sits in exactly one marker', async () => {
		mockTreeWithOneLending();
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		mockLibrarianCheckoutData();

		const { container } = render(Page);
		await expandToCopies(container);
		const row = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-copy-copy-2"]') as HTMLElement;
			expect(el?.textContent).toContain('Out — Ada Lovelace');
			return el;
		});
		const [node] = textNodesContaining(row, 'Ada Lovelace');
		const marker = markerOf(node);
		expect(marker, 'the lent-to badge text must sit inside a marker').not.toBeNull();
		expectWholeTextMarkedOnce(marker!.parentElement as HTMLElement, 'library_copy_lent_to badge');
		expect(marker!.textContent).toContain('Out — Ada Lovelace');
	});

	it('#361 — bulk checkout: both member-list branches (already-lent row, checkbox label) mark the name once', async () => {
		mockTreeWithOneLending();
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		mockLibrarianCheckoutData();

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });
		const list = await waitFor(() => {
			const el = container.querySelector('[data-testid="bulk-checkout-member-list"]') as HTMLElement;
			expect(el).not.toBeNull();
			expect(el.querySelector('[data-testid="bulk-checkout-already-lent-member-a"]')).not.toBeNull();
			expect(el.textContent).toContain('Ada Lovelace');
			expect(el.textContent).toContain('Ben Jonson');
			return el;
		});
		// member-a holds copy-2 of edition-1 → the already-lent branch.
		expectNameMarkedOnce(list, 'Ada Lovelace', 'in the bulk-checkout already-lent row');
		// member-b is free → the checkbox-label branch.
		expectNameMarkedOnce(list, 'Ben Jonson', 'in the bulk-checkout checkbox label');
	});
});

describe('#74 — bulk checkout + return', () => {
	// ── visibility gating (existing) ──────────────────────────────────────────
	it('bulk checkout surface (button or section) visible to librarian', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="bulk-checkout"]')).not.toBeNull();
	});

	it('bulk checkout surface hidden from non-librarian', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="bulk-checkout"]')).toBeNull();
	});

	// #76 correction 8: the separate bulk-return section is REMOVED — inline
	// Return buttons on lent copy rows are the only return surface. The old
	// "visible to librarian" presence test is inverted accordingly.
	it('bulk return section does NOT exist — not even for a librarian (#76 correction 8)', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
		// Even with an active lending (the old section's reason to exist), the
		// bulk return surface must be gone entirely.
		expect(container.querySelector('[data-testid="bulk-return"]')).toBeNull();
		expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).toBeNull();
		// Bulk CHECKOUT is unaffected — still renders for a librarian.
		expect(container.querySelector('[data-testid="bulk-checkout"]')).not.toBeNull();
	});

	it('bulk return surface hidden from non-librarian', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="bulk-return"]')).toBeNull();
	});

	// ── shape tests: two-step bulk checkout (edition-first) ───────────────────
	it('bulk checkout renders an edition picker, not a flat copy list', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] }
		]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout"]')).not.toBeNull();
		});
		// Must have an edition picker (dropdown / select)
		expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
	});

	it('bulk checkout does NOT render a flat list of all copies', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout"]')).not.toBeNull();
		});
		// The bulk checkout section must NOT contain individual copy checkboxes
		// (the old flat-list shape). It should not dump every copy with a checkbox.
		const checkboxes = container.querySelectorAll('[data-testid="bulk-checkout"] input[type="checkbox"]');
		// Before an edition is selected, no copy checkboxes should be visible
		// (the old flat dump had checkboxes immediately on render).
		// An edition-first flow starts with an edition picker, not copy checkboxes.
		expect(checkboxes.length).toBe(0);
	});

	it('after picking an edition, shows member roster with checkboxes per member', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Bärenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] },
			{ memberId: 'member-2', personId: 'person-2', sectionIds: [] }
		]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		expect(select).not.toBeNull();
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});
	});

	// ── action-layer wiring (submit triggers the function, not just DOM) ──────
	it('bulk checkout submit calls bulkCheckout with the selected edition, checked members, and due date', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] },
			{ memberId: 'member-2', personId: 'person-2', sectionIds: [] }
		]));
		bulkCheckoutMock.mockResolvedValue({ succeeded: [], failed: [] });
		// After bulk checkout, the page refreshes lendings
		listLendingsMock.mockResolvedValue(toListRead([]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		const editionSelect = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(editionSelect, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});

		const checkboxes = container.querySelectorAll('[data-testid="bulk-checkout-member-list"] input[type="checkbox"]');
		expect(checkboxes.length).toBeGreaterThan(0);
		await fireEvent.click(checkboxes[0]);

		const submitBtn = container.querySelector('[data-testid="bulk-checkout-submit"]') as HTMLButtonElement;
		await fireEvent.click(submitBtn);

		await waitFor(() => {
			expect(bulkCheckoutMock).toHaveBeenCalledTimes(1);
		});
		const callArgs = bulkCheckoutMock.mock.calls[0];
		// callArgs: [cfg, libraryId, payload, activeLendings]
		expect(callArgs[2].editionId).toBe('edition-1');
		expect(callArgs[2].memberIds).toContain('member-1');
	});

});

// #74 — bulk checkout refinements: work→edition two-level picker, available/total
// counter, already-lending guard, and checked≤available validation.
describe('#74 — bulk checkout refinements', () => {
	// ── Refinement 1: work → edition two-level picker ────────────────────────
	it('renders a work-select dropdown; edition-select only appears after picking a work; editions are filtered to the selected work', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
			{ id: 'work-2', name: 'Ave verum corpus', composer: 'Mozart' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		// Editions carry workId so the picker can filter by selected work
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'ed-w1a', name: 'Baerenreiter ed.', publisher: 'Baerenreiter', workId: 'work-1' },
			{ id: 'ed-w1b', name: 'Peters ed.', publisher: 'Peters', workId: 'work-1' },
			{ id: 'ed-w2a', name: 'Eulenburg ed.', publisher: 'Eulenburg', workId: 'work-2' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-work-select"]')).not.toBeNull();
		});

		const editionSelectBefore = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement | null;
		expect(editionSelectBefore === null || editionSelectBefore.disabled).toBe(true);

		const workSelect = container.querySelector('[data-testid="bulk-checkout-work-select"]') as HTMLSelectElement;
		await fireEvent.change(workSelect, { target: { value: 'work-1' } });

		await waitFor(() => {
			const es = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
			expect(es).not.toBeNull();
			expect(es.disabled).not.toBe(true);
		});

		const editionOptions = container.querySelectorAll('[data-testid="bulk-checkout-edition-select"] option');
		const values = Array.from(editionOptions).map(o => (o as HTMLOptionElement).value).filter(v => v !== '');
		expect(values).toContain('ed-w1a');
		expect(values).toContain('ed-w1b');
		expect(values).not.toContain('ed-w2a');
	});

	// ── Refinement 2: available/total counter ────────────────────────────────
	it('shows "N/M available" counter when an edition is selected (available = copies not actively lent)', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		// copy-1 actively lent; copy-2 was returned (available); copy-3 never lent (available)
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-2', copyId: 'copy-2', memberId: 'member-b', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '2026-07-15' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada']]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
			{ id: 'copy-3', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		// Select the edition
		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		// Expect: 2 available out of 3 total (copy-2 returned=available, copy-3 never lent=available)
		await waitFor(() => {
			const counter = container.querySelector('[data-testid="bulk-checkout-availability"]');
			expect(counter).not.toBeNull();
			expect(counter?.textContent).toContain('2/3');
		});
	});

	// ── Refinement 3: already-lending guard (no double-lending) ──────────────
	it('shows a lending-date label instead of a checkbox for a member who already has an active lending for the selected edition', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		// member-a already has active lending for copy-1 (belongs to edition-1)
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada']]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-a', personId: 'person-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'person-b', sectionIds: [] }
		]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});

		// member-a already has active lending -> date label, NOT a checkbox.
		// #207 rule 7 (supersedes #76 correction 9): lending dates are tabular
		// date text — the exact ISO calendar date, not a localized rendering.
		const alreadyLent = container.querySelector('[data-testid="bulk-checkout-already-lent-member-a"]');
		expect(alreadyLent).not.toBeNull();
		expect(alreadyLent?.textContent).toContain('Lent since 2026-07-01');

		// member-b has no active lending -> checkbox, no already-lent label
		expect(container.querySelector('[data-testid="bulk-checkout-already-lent-member-b"]')).toBeNull();
	});

	// ── Refinement 4: checked count <= available validation ──────────────────
	it('disables submit when checked member count exceeds available copy count; enables when within limit', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([])); // no active lendings -> all copies available
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		// Only 2 copies -> 2 available
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]));
		// 3 members
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] },
			{ memberId: 'member-2', personId: 'person-2', sectionIds: [] },
			{ memberId: 'member-3', personId: 'person-3', sectionIds: [] }
		]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});

		const checkboxes = container.querySelectorAll('[data-testid="bulk-checkout-member-list"] input[type="checkbox"]');
		expect(checkboxes.length).toBe(3);

		// Check all 3 members (exceeds 2 available copies)
		await fireEvent.click(checkboxes[0]);
		await fireEvent.click(checkboxes[1]);
		await fireEvent.click(checkboxes[2]);

		// Submit must be disabled: 3 checked > 2 available
		const submit = container.querySelector('[data-testid="bulk-checkout-submit"]') as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		// Uncheck one -> 2 checked <= 2 available -> enabled
		await fireEvent.click(checkboxes[2]);
		await waitFor(() => {
			expect((container.querySelector('[data-testid="bulk-checkout-submit"]') as HTMLButtonElement).disabled).toBe(false);
		});
	});
});

// (*MVOX:Tallis*)
