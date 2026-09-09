// @vitest-environment happy-dom
//
// #300 RED — the /library bulk-checkout selection must belong to the
// collective it was made in. On `main`, `bulkCheckoutWorkId`,
// `bulkCheckoutEditionId`, `bulkCheckoutCheckedMembers` and
// `bulkCheckoutDueDate` all survive a collective switch: the route-load
// `reset` callback clears five node caches but none of these, and the two
// #74 `$effect` resets fire only when the work/edition id *changes* — a
// switch does not change either value, so neither effect runs.
//
// WHAT THESE SPECS DELIBERATELY DO NOT PIN: "submit is unreachable". At
// HEAD that is ALREADY true, unfixed — the whole panel is unrendered while
// `librarianStore` is 'loading', and `deriveEditionAvailability` returns
// `{available: 0}` for a foreign edition id, disabling the button for every
// selection size (research on #300 traced the race and found no live
// window). A spec asserting only that the button is disabled/absent-of-
// effect would pass on `main` and pin nothing. So every spec here pins the
// CLEARED STATE itself, through its DOM manifestation, and each assertion
// is annotated with what it does on `main` (fails) and which variable it
// pins.
//
// No library-scoped collective-switch spec exists on `main` at all (the
// three collective-switch specs are all roster; research #300 finding 5),
// so this file is the first coverage of the path in either direction.
//
// Fixture note: BOTH collectives carry TWO works, deliberately — the #74
// auto-select `$effect` (`if (works.length === 1) bulkCheckoutWorkId =
// works[0].id`) would otherwise legitimately repopulate the work id after
// a switch-time clear, and these pins are about the clear, not about that
// (pre-existing, correct) auto-select behavior.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	}
}));

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
		...actual, // keep the REAL deriveEditionAvailability — mocking it would fake exactly the arithmetic this issue says must stay incidental
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
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>('$lib/library/librarianStore');
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
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

// ── two collectives, two disjoint fixtures ──────────────────────────────────
// TWO works per collective on purpose — see the header note on the #74
// auto-select effect.

const DB_A = 'polyphony';
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
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB_A]: 'person-p', [DB_B]: 'person-q' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: DB_A, name: 'Polyphony', personId: 'person-p' },
			{ db: DB_B, name: 'Other Choir', personId: 'person-q' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(DB_A);
}

beforeEach(() => {
	// Every data mock keyed on cfg.db, so both the initial load and every
	// post-switch reload serve the CURRENT collective's fixture.
	listWorksMock.mockImplementation((cfg: { db: string }) => Promise.resolve(worksFor(cfg.db)));
	listLendingsMock.mockResolvedValue([]);
	resolveBorrowerNamesMock.mockImplementation((cfg: { db: string }) => Promise.resolve(borrowerNamesFor(cfg.db)));
	listAllEditionsMock.mockImplementation((cfg: { db: string }) => Promise.resolve(editionsFor(cfg.db)));
	listAllCopiesMock.mockImplementation((cfg: { db: string }) => Promise.resolve(copiesFor(cfg.db)));
	listActiveMembersMock.mockImplementation((cfg: { db: string }) => Promise.resolve(membersFor(cfg.db)));
	resolveLibrarianMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve({ state: 'librarian', libraryId: cfg.db === DB_A ? 'lib-a' : 'lib-b' })
	);
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Render as a librarian of collective A and drive a FULL bulk-checkout
 * selection through the real UI: work-a1 → edition-a1 → check member-a1 →
 * due date. Sanity-asserts every step so the switch pins below cannot pass
 * vacuously because the selection never existed. */
async function renderWithFullSelectionInA(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);

	await waitFor(() => {
		expect(q(container, 'bulk-checkout-work-select')).not.toBeNull();
	});
	const workSelect = q(container, 'bulk-checkout-work-select') as HTMLSelectElement;
	expect(workSelect.textContent).toContain('Spem in alium');
	await fireEvent.change(workSelect, { target: { value: 'work-a1' } });

	await waitFor(() => {
		expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
	});
	await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
		target: { value: 'edition-a1' }
	});

	await waitFor(() => {
		expect(q(container, 'bulk-checkout-member-list')).not.toBeNull();
	});
	const checkboxes = container.querySelectorAll(
		'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]'
	);
	expect(checkboxes.length).toBe(2);
	await fireEvent.click(checkboxes[0]); // member-a1
	expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);

	const dueDate = q(container, 'bulk-checkout-due-date') as HTMLInputElement;
	expect(dueDate).not.toBeNull();
	await fireEvent.input(dueDate, { target: { value: '2027-01-15' } });
	expect(dueDate.value).toBe('2027-01-15');

	return container;
}

/** Switch collectives and wait until the new collective's librarian panel is
 * back on screen (the whole section unmounts while librarianStore is
 * 'loading', so waiting for the work select to carry the new collective's
 * works proves the reload completed). */
async function switchTo(container: HTMLElement, db: string, expectedWorkName: string) {
	selectedCollectiveDbStore.set(db);
	await waitFor(() => {
		const sel = q(container, 'bulk-checkout-work-select');
		expect(sel).not.toBeNull();
		expect(sel?.textContent).toContain(expectedWorkName);
	});
}

// ── the pins ────────────────────────────────────────────────────────────────

describe('/library — #300 bulk-checkout selection across a collective switch', () => {
	// Pins bulkCheckoutWorkId AND bulkCheckoutEditionId cleared, each
	// independently. On `main` this test FAILS on every assertion: the
	// retained work id ('work-a1') renders the edition select
	// (`{#if bulkCheckoutWorkId}`), and the retained edition id
	// ('edition-a1') renders the member list, due-date input and submit
	// button (`{#if bulkCheckoutEditionId}` — a SEPARATE gate, so it also
	// catches a partial fix that clears only the work id). With the state
	// cleared, neither gate is truthy in collective B and none of these
	// elements exist.
	it('a switch clears the work and edition selection: no edition select and no edition-gated panel render in the new collective', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');

		// bulkCheckoutWorkId cleared → the {#if bulkCheckoutWorkId} gate is off.
		expect(q(container, 'bulk-checkout-edition-select')).toBeNull();
		// bulkCheckoutEditionId cleared → the {#if bulkCheckoutEditionId} gate
		// is off (this half fails on `main` even if the work id alone were fixed).
		expect(q(container, 'bulk-checkout-member-list')).toBeNull();
		expect(q(container, 'bulk-checkout-due-date')).toBeNull();
		expect(q(container, 'bulk-checkout-submit')).toBeNull();
	});

	// Pins bulkCheckoutCheckedMembers — the piece whose member ids
	// handleBulkCheckout posts, and the one #300 names as the uncomfortable
	// half. The retained Set is invisible in collective B (its `has()` probes
	// miss B's member ids), so the pin switches BACK: on `main`, the
	// librarian section remounts in A with all three variables intact —
	// the work select re-shows 'work-a1', the gated panel re-renders, and
	// member-a1's checkbox renders CHECKED straight from the retained Set.
	// After the fix the selection is simply gone.
	//
	// Stated limitation: through the DOM the Set is only visible behind the
	// edition gate, so a hypothetical fix that cleared both ids but forgot
	// the Set would pass this pin. That variant cannot reach the wire either
	// — with the edition id cleared, every path that re-establishes one goes
	// through the (fenced, pre-existing) #74 edition-change $effect, which
	// wipes the Set before submit is reachable — but the honest statement is
	// that this pin proves the SELECTION does not resurrect, and pins the
	// Set directly only in the everything-retained state `main` is in.
	it('switching away and back does not resurrect the selection: the checked-member set is gone', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');
		await switchTo(container, DB_A, 'Spem in alium');

		// The Set pin comes FIRST so it is the assertion that demonstrably
		// fails on `main`: member-a1's checkbox renders checked straight from
		// the retained bulkCheckoutCheckedMembers.
		const checked = Array.from(
			container.querySelectorAll('[data-testid="bulk-checkout"] input[type="checkbox"]')
		).filter((cb) => (cb as HTMLInputElement).checked);
		expect(checked).toEqual([]);
		// bulkCheckoutWorkId stayed cleared — on `main` this reads 'work-a1',
		// because A's options match the retained id again after the remount.
		expect((q(container, 'bulk-checkout-work-select') as HTMLSelectElement).value).toBe('');
		// The edition-gated panel did not resurrect.
		expect(q(container, 'bulk-checkout-member-list')).toBeNull();
	});

	// Pins bulkCheckoutDueDate — decided EXPLICITLY per #300: the due date is
	// cleared on a switch. It is per-transaction state (handleBulkCheckout
	// already resets it after a successful submit); a switch abandons the
	// transaction, and a retained date silently rides into the next
	// collective's checkout as `assignedUntil` (see the wire-shape test
	// below, where exactly that happens on `main`). On `main` THIS test
	// fails because nothing clears the date on a switch: after re-picking a
	// work and edition in B, the due-date input renders the stale
	// '2027-01-15'. It also stays RED against a partial fix that clears the
	// three ids but skips the date — this assertion is specifically about
	// the date variable.
	it('the due date is cleared by the switch (explicit #300 decision: due date is per-transaction state)', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');

		// Re-pick in B through the real UI to bring the due-date input back.
		await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
			target: { value: 'work-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
		});
		await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
			target: { value: 'edition-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-due-date')).not.toBeNull();
		});

		expect((q(container, 'bulk-checkout-due-date') as HTMLInputElement).value).toBe('');
	});

	// The wire shape: after a switch, a FRESH selection in B posts exactly
	// B's ids and nothing of A's. The full-shape toEqual is load-bearing
	// twice over: (1) on `main` this FAILS — the retained '2027-01-15' due
	// date from collective A rides into the payload as `assignedUntil`
	// (`...(bulkCheckoutDueDate ? { assignedUntil: ... } : {})`), which is
	// the retained state actually REACHING THE WIRE; (2) post-fix it is the
	// integration guard that the cleared panel still supports a complete
	// checkout flow in the new collective (partial assertions hide bugs —
	// team rule; an objectContaining here would go green on `main`).
	it('after a switch, a fresh selection in the new collective posts ONLY the new collective ids — no stale assignedUntil from the old one', async () => {
		const container = await renderWithFullSelectionInA();

		await switchTo(container, DB_B, 'Cantique de Jean Racine');

		await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
			target: { value: 'work-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
		});
		await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
			target: { value: 'edition-b1' }
		});
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-member-list')).not.toBeNull();
		});
		const checkboxes = container.querySelectorAll(
			'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]'
		);
		expect(checkboxes.length).toBe(1); // member-b1 only — B's roster
		await fireEvent.click(checkboxes[0]);

		bulkCheckoutMock.mockResolvedValue({ succeeded: [], failed: [] });
		const submitBtn = q(container, 'bulk-checkout-submit') as HTMLButtonElement;
		expect(submitBtn.disabled).toBe(false); // copy-b1 available → 1 ≥ 1
		await fireEvent.click(submitBtn);

		await waitFor(() => {
			expect(bulkCheckoutMock).toHaveBeenCalledTimes(1);
		});
		const [cfg, libraryId, payload] = bulkCheckoutMock.mock.calls[0];
		expect(cfg.db).toBe(DB_B);
		expect(libraryId).toBe('lib-b');
		// FULL shape — no assignedUntil key at all: the user set no due date
		// in B, and A's date must not survive the switch to supply one.
		expect(payload).toEqual({
			editionId: 'edition-b1',
			memberIds: ['member-b1'],
			assignedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
		});
	});
});

// (*MVOX:Tallis*)
