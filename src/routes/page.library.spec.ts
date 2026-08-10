// @vitest-environment happy-dom
//
// T6.3/#63 — the /library page. Renders the expandable works -> editions ->
// copies accordion, lazily fetching each level and deriving per-copy
// availability from pre-loaded lendings. Read-only throughout — no write
// path anywhere in the library surfaces (structural guard at the bottom of
// this file).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
		library_bulk_checkout_availability: (p: { available: number; total: number }) => `${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_bulk_return_title: () => 'Bulk return',
		library_bulk_return_edition_placeholder: () => 'Select edition',
		library_bulk_return_lent_count: (p: { count: number }) => `${p.count} lent`,
		library_work_availability: (p: { available: number; total: number }) => `${p.available}/${p.total}`,
		// #76 — inline checkout on browse tree
		library_inline_checkout_placeholder: () => 'Select member',
		library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_inline_checkout_error: () => 'Checkout failed'
	}
}));

const { listWorksMock, listEditionsMock, listCopiesMock, listAllEditionsMock, listAllCopiesMock, listLendingsMock, resolveBorrowerNamesMock, resolveCopyNamesMock } =
	vi.hoisted(() => ({
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
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual, // keep the real, pure deriveCopyAvailability / deriveWorkAvailability
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
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// vi.importActual for $lib/library/libraryData (kept above, to preserve the real
// deriveCopyAvailability) pulls entuFetch -> $lib/entu-config, which reads
// $env/dynamic/public — unavailable outside a SvelteKit request context under
// happy-dom. Same fix as page.profile.spec.ts.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

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

// T6.4/#73 — "my loans" resolves the viewer's own active member the same way
// RSVP already does (rsvpData.ts's findMyMemberId: person + status=active, no
// org scoping in single-collective polyphony). Reused rather than re-derived.
const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

// #74 — mock lendingActions to verify submit triggers the action layer
const { createLendingMock, returnLendingMock, bulkCheckoutMock, bulkReturnMock } = vi.hoisted(() => ({
	createLendingMock: vi.fn(),
	returnLendingMock: vi.fn(),
	bulkCheckoutMock: vi.fn(),
	bulkReturnMock: vi.fn()
}));
vi.mock('$lib/library/lendingActions', () => ({
	createLending: createLendingMock,
	returnLending: returnLendingMock,
	bulkCheckout: bulkCheckoutMock,
	bulkReturn: bulkReturnMock
}));

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'person-p' }, expMs: Date.now() + 100_000 });
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	// Default: not-librarian, unless a test overrides resolveLibrarianMock afterward.
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	// Default: no active membership, unless a test overrides findMyMemberIdMock afterward.
	findMyMemberIdMock.mockResolvedValue(null);
	// Default: empty copy names, unless a test overrides.
	resolveCopyNamesMock.mockResolvedValue(new Map());
	// Default: empty checkout data, unless a test overrides.
	listAllEditionsMock.mockResolvedValue([]);
	listAllCopiesMock.mockResolvedValue([]);
	listActiveMembersMock.mockResolvedValue([]);
}

function setNoCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: {}, expMs: Date.now() + 100_000 });
	collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
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
	bulkReturnMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/library — loading state', () => {
	it('shows the skeleton while the initial load is in flight', async () => {
		listWorksMock.mockReturnValue(new Promise(() => {}));
		listLendingsMock.mockReturnValue(new Promise(() => {}));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-skeleton"]')).not.toBeNull();
		});
	});
});

describe('/library — ready state', () => {
	it('renders the work list with title and composer', async () => {
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
			{ id: 'work-2', name: 'Ave verum corpus', composer: '' }
		]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-list"]')).not.toBeNull();
		});
		const row1 = container.querySelector('[data-testid="library-work-work-1"]');
		expect(row1?.textContent).toContain('Spem in alium');
		expect(row1?.textContent).toContain('Thomas Tallis');

		// No composer -> fallback label, never blank
		const row2 = container.querySelector('[data-testid="library-work-work-2"]');
		expect(row2?.textContent).toContain('Ave verum corpus');
		expect(row2?.textContent).toContain('Unknown composer');
	});
});

describe('/library — empty state', () => {
	it('shows library-empty and no work list when listWorks resolves []', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="library-work-list"]')).toBeNull();
	});
});

describe('/library — load-error state', () => {
	it('shows a generic localized error (not the raw thrown message); logs detail to console.error; retry reloads', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listWorksMock.mockRejectedValue(new Error('boom 500'));
		listLendingsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-load-error"]')).not.toBeNull();
		});
		expect(container.textContent).toContain('Something went wrong loading the library.');
		expect(container.textContent).not.toContain('boom 500');
		expect(consoleSpy).toHaveBeenCalled();

		listWorksMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		const retryBtn = container.querySelector('[data-testid="library-retry-load"]') as HTMLButtonElement;
		expect(retryBtn).not.toBeNull();
		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		consoleSpy.mockRestore();
	});
});

describe('/library — no-collective state', () => {
	it('shows library-no-collective and never calls listWorks', async () => {
		setNoCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-no-collective"]')).not.toBeNull();
		});
		expect(listWorksMock).not.toHaveBeenCalled();
	});
});

describe('/library — work expand -> edition expand -> copy availability', () => {
	it('expanding a work lazily loads its editions; expanding an edition lazily loads its copies; availability reflects an active lending', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{
				id: 'lend-1',
				copyId: 'copy-2',
				memberId: 'member-a',
				assignedAt: '2026-07-01',
				assignedUntil: '2026-08-01',
				returnedAt: ''
			}
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]);
		listCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});
		expect(listEditionsMock).not.toHaveBeenCalled();

		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(listEditionsMock).toHaveBeenCalledWith(expect.anything(), 'work-1'));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		});
		expect(listCopiesMock).not.toHaveBeenCalled();

		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);
		await waitFor(() => expect(listCopiesMock).toHaveBeenCalledWith(expect.anything(), 'edition-1'));

		await waitFor(() => {
			const copy1 = container.querySelector('[data-testid="library-copy-copy-1"]');
			const copy2 = container.querySelector('[data-testid="library-copy-copy-2"]');
			expect(copy1?.textContent).toContain('Available');
			expect(copy2?.textContent).toContain('Out');
			expect(copy2?.textContent).toContain('Ada Lovelace');
		});
	});

	it('re-collapsing then re-expanding a work does not re-fetch its editions (cached)', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());

		const toggle = container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element;
		await fireEvent.click(toggle); // expand
		await waitFor(() => expect(listEditionsMock).toHaveBeenCalledTimes(1));
		await fireEvent.click(toggle); // collapse
		await fireEvent.click(toggle); // expand again

		expect(listEditionsMock).toHaveBeenCalledTimes(1);
	});
});

describe('/library — unresolved borrower name', () => {
	it('an active lending with no resolvable name shows the fallback label, never a blank', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{
				id: 'lend-1',
				copyId: 'copy-1',
				memberId: 'member-x',
				assignedAt: '2026-07-01',
				assignedUntil: '',
				returnedAt: ''
			}
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-x', '']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: 'Ed', publisher: 'Pub' }]);
		listCopiesMock.mockResolvedValue([{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-copy-copy-1"]')?.textContent).toContain(
				'an unnamed member'
			);
		});
	});
});

describe('#72 — librarian tools composition', () => {
	it('hides librarian tools while resolveLibrarian is loading (hidden-if-undeterminable)', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockReturnValue(new Promise(() => {}));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')).toBeNull();
		expect(container.querySelector('[data-testid="librarian-load-error"]')).toBeNull();
	});

	it('shows the librarian placeholder section when resolveLibrarian resolves librarian', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')?.textContent).toContain('Librarian tools');
	});

	it('hides librarian tools when resolveLibrarian resolves not-librarian (fail-closed)', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')).toBeNull();
	});

	it('shows a retry action when resolveLibrarian errors; retry re-resolves and reveals tools', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'error', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')).toBeNull();

		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		const retryBtn = container.querySelector('[data-testid="librarian-retry-load"]') as HTMLButtonElement;
		expect(retryBtn).not.toBeNull();
		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
	});
});

describe('#73 — my loans', () => {
	it('renders the my-loans section when the current member has an active loan (returnedAt === "")', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});
	});

	it('does NOT render my-loans when the current member has no active loans', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-other', copyId: 'copy-1', memberId: 'member-other', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-returned', copyId: 'copy-2', memberId: 'member-mine', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '2026-07-15' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="my-loans"]')).toBeNull();
	});

	it('shows an overdue indicator when assigned_until is in the past and the loan is still active', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2020-01-01', assignedUntil: '2020-02-01', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});
		// my-loans starts collapsed (see below) — expand it to reach the row.
		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans-overdue-lend-mine"]')).not.toBeNull();
		});
	});

	it.each([
		['empty assigned_until', ''],
		['future assigned_until', '2099-01-01']
	])('does NOT show an overdue indicator when %s', async (_label, assignedUntil) => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2020-01-01', assignedUntil, returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans-item-lend-mine"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="my-loans-overdue-lend-mine"]')).toBeNull();
	});

	it('the my-loans section is collapsed by default — no loan rows until toggled', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="my-loans-item-lend-mine"]')).toBeNull();

		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans-item-lend-mine"]')).not.toBeNull();
		});
	});
});

describe('#73 — librarian return', () => {
	// The standalone single-checkout form that used to live here is REMOVED by
	// the #76 PO ruling — single checkout now happens inline on the browse tree
	// (see '#76 — inline checkout on browse tree' below). Return stays as-is.
	it('a return button is visible on an active lending for a librarian', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]);
		listCopiesMock.mockResolvedValue([{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }]);
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-return-copy-2"]')).not.toBeNull();
		});
	});

	it('the return button is hidden from a non-librarian', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]);
		listCopiesMock.mockResolvedValue([{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }]);
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-copy-copy-2"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="library-return-copy-2"]')).toBeNull();
	});
});

describe('#76 — inline checkout on browse tree', () => {
	// PO ruling: the standalone checkout form (copy picker + member picker +
	// date + submit) is replaced by an inline "Select member" dropdown
	// [data-testid="inline-checkout-{copyId}"] on each AVAILABLE copy row in
	// the librarian view. Picking a member checks the copy out immediately
	// (server-confirmed: createLending resolves, then lendings are re-fetched).
	// Members who already hold an active lending for that EDITION are disabled
	// in the picker and show the lending date (double-lending guard).

	// One work -> one edition -> two copies; copy-2 is out to member-a since
	// 2026-07-01, copy-1 is available. Two active members: Ada (member-a,
	// already borrowing) and Ben (member-b, free).
	function mockTreeWithOneLending() {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(
			new Map([
				['member-a', 'Ada Lovelace'],
				['member-b', 'Ben Jonson']
			])
		);
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]);
		listCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]);
	}

	function mockLibrarianCheckoutData() {
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-a', personId: 'p-a', currentSection: '' },
			{ memberId: 'member-b', personId: 'p-b', currentSection: '' }
		]);
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
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
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
		setAuthedWithOneCollective();
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
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);
		await expandToCopies(container);

		const copyRow = container.querySelector('[data-testid="library-copy-copy-1"]');
		expect(copyRow?.textContent).toContain('Available');
		expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).toBeNull();
		expect(container.querySelector('[data-testid="inline-checkout-copy-2"]')).toBeNull();
	});

	// ── 4. double-lending guard: borrower disabled, lending date shown ──────
	it('a member with an active lending for the same edition is disabled in the picker and shows the lending date', async () => {
		mockTreeWithOneLending();
		setAuthedWithOneCollective();
		mockLibrarianCheckoutData();

		const { container } = render(Page);
		await expandToCopies(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="inline-checkout-copy-1"]') as HTMLSelectElement;
		// member-a already holds copy-2 of edition-1 → disabled, with the
		// lending date visible in the option text.
		await waitFor(() => {
			const optA = select.querySelector('option[value="member-a"]') as HTMLOptionElement | null;
			expect(optA).not.toBeNull();
			expect(optA!.disabled).toBe(true);
			expect(optA!.textContent).toContain('2026-07-01');
		});
	});

	// ── 5. free members are selectable ──────────────────────────────────────
	it('a member without an active lending for the edition is a selectable (enabled) option', async () => {
		mockTreeWithOneLending();
		setAuthedWithOneCollective();
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
		setAuthedWithOneCollective();
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
			.mockResolvedValueOnce([
				{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
			])
			.mockResolvedValue([
				{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' },
				newLending
			]);

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
});

describe('#74 — bulk checkout + return', () => {
	// ── visibility gating (existing) ──────────────────────────────────────────
	it('bulk checkout surface (button or section) visible to librarian', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="bulk-checkout"]')).not.toBeNull();
	});

	it('bulk checkout surface hidden from non-librarian', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="bulk-checkout"]')).toBeNull();
	});

	it('bulk return surface visible to librarian', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="bulk-return"]')).not.toBeNull();
	});

	it('bulk return surface hidden from non-librarian', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="bulk-return"]')).toBeNull();
	});

	// ── shape tests: two-step bulk checkout (edition-first) ───────────────────
	it('bulk checkout renders an edition picker, not a flat copy list', async () => {
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-1', personId: 'person-1', currentSection: '' }
		]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout"]')).not.toBeNull();
		});
		// Must have an edition picker (dropdown / select)
		expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
	});

	it('bulk checkout does NOT render a flat list of all copies', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]);
		listActiveMembersMock.mockResolvedValue([]);

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
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Bärenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-1', personId: 'person-1', currentSection: '' },
			{ memberId: 'member-2', personId: 'person-2', currentSection: '' }
		]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		// Select an edition from the picker
		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		expect(select).not.toBeNull();
		// After selecting an edition, the member roster should appear
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});
	});

	// ── shape tests: grouped bulk return (edition-grouped) ────────────────────
	it('bulk return renders an edition picker (grouped by edition), not a flat loan list', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-2', copyId: 'copy-2', memberId: 'member-2', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada'], ['member-2', 'Bob']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllCopiesMock.mockResolvedValue([]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return"]')).not.toBeNull();
		});
		// Must have an edition picker / grouping selector
		expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
	});

	it('bulk return does NOT render a flat list of all active loans', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-2', copyId: 'copy-2', memberId: 'member-2', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada'], ['member-2', 'Bob']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllCopiesMock.mockResolvedValue([]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return"]')).not.toBeNull();
		});
		// The bulk return section must NOT contain flat loan checkboxes before
		// an edition is selected. The old shape dumps every active loan with a
		// checkbox — the new shape groups by edition first.
		const checkboxes = container.querySelectorAll('[data-testid="bulk-return"] input[type="checkbox"]');
		expect(checkboxes.length).toBe(0);
	});

	it('after picking an edition in bulk return, shows members with copies out', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		setAuthedWithOneCollective();
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Bärenreiter' }
		]);
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		// Select an edition from the return picker
		const select = container.querySelector('[data-testid="bulk-return-edition-select"]') as HTMLSelectElement;
		expect(select).not.toBeNull();
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-loan-list"]')).not.toBeNull();
		});
	});

	// ── action-layer wiring (submit triggers the function, not just DOM) ──────
	it('bulk checkout submit calls bulkCheckout with the selected edition, checked members, and due date', async () => {
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-1', personId: 'person-1', currentSection: '' },
			{ memberId: 'member-2', personId: 'person-2', currentSection: '' }
		]);
		bulkCheckoutMock.mockResolvedValue({ succeeded: [], failed: [] });
		// After bulk checkout, the page refreshes lendings
		listLendingsMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		// Step 1: select edition
		const editionSelect = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(editionSelect, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});

		// Step 2: check a member
		const checkboxes = container.querySelectorAll('[data-testid="bulk-checkout-member-list"] input[type="checkbox"]');
		expect(checkboxes.length).toBeGreaterThan(0);
		await fireEvent.click(checkboxes[0]);

		// Step 3: click submit
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

	it('bulk return submit calls bulkReturn with the checked loan IDs', async () => {
		listWorksMock.mockResolvedValue([]);
		// First call returns the active lending; subsequent calls (refresh after
		// bulk return) return empty to simulate successful returns.
		listLendingsMock.mockResolvedValueOnce([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]).mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);
		bulkReturnMock.mockResolvedValue({ succeeded: ['lend-1'], failed: [] });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		// Step 1: select edition
		const editionSelect = container.querySelector('[data-testid="bulk-return-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(editionSelect, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-loan-list"]')).not.toBeNull();
		});

		// Step 2: check a loan
		const checkboxes = container.querySelectorAll('[data-testid="bulk-return-loan-list"] input[type="checkbox"]');
		expect(checkboxes.length).toBeGreaterThan(0);
		await fireEvent.click(checkboxes[0]);

		// Step 3: click submit
		const submitBtn = container.querySelector('[data-testid="bulk-return-submit"]') as HTMLButtonElement;
		await fireEvent.click(submitBtn);

		await waitFor(() => {
			expect(bulkReturnMock).toHaveBeenCalledTimes(1);
		});
		const callArgs = bulkReturnMock.mock.calls[0];
		// callArgs: [cfg, lendingIds]
		expect(callArgs[1]).toContain('lend-1');
	});

	// ── edition-scoped return filtering ──────────────────────────────────────
	it('bulk return only shows loans whose copy belongs to the selected edition, not all active loans', async () => {
		listWorksMock.mockResolvedValue([]);
		// Two active loans: one for edition-1's copy, one for edition-2's copy
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-e1', copyId: 'copy-e1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-e2', copyId: 'copy-e2', memberId: 'member-2', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada'], ['member-2', 'Bob']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter' },
			{ id: 'edition-2', name: 'Peters', publisher: 'Peters' }
		]);
		// copy-e1 belongs to edition-1, copy-e2 belongs to edition-2
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-e1', name: 'Copy E1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-e2', name: 'Copy E2', copyNumber: 1, editionId: 'edition-2' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		// Select edition-1
		const select = container.querySelector('[data-testid="bulk-return-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-loan-list"]')).not.toBeNull();
		});

		// Should only show 1 loan (lend-e1 for copy-e1/edition-1), not lend-e2
		const checkboxes = container.querySelectorAll('[data-testid="bulk-return-loan-list"] input[type="checkbox"]');
		expect(checkboxes.length).toBe(1);
		// The visible loan text should show Ada (member-1), not Bob (member-2)
		const loanList = container.querySelector('[data-testid="bulk-return-loan-list"]');
		expect(loanList?.textContent).toContain('Ada');
		expect(loanList?.textContent).not.toContain('Bob');
	});
});

// ---------------------------------------------------------------------------
// #74 — bulk checkout refinements: work→edition two-level picker, available/total
// counter, already-lending guard, and checked≤available validation.
// ---------------------------------------------------------------------------
describe('#74 — bulk checkout refinements', () => {
	// ── Refinement 1: work → edition two-level picker ────────────────────────
	it('renders a work-select dropdown; edition-select only appears after picking a work; editions are filtered to the selected work', async () => {
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
			{ id: 'work-2', name: 'Ave verum corpus', composer: 'Mozart' }
		]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		// Editions carry workId so the picker can filter by selected work
		listAllEditionsMock.mockResolvedValue([
			{ id: 'ed-w1a', name: 'Baerenreiter ed.', publisher: 'Baerenreiter', workId: 'work-1' },
			{ id: 'ed-w1b', name: 'Peters ed.', publisher: 'Peters', workId: 'work-1' },
			{ id: 'ed-w2a', name: 'Eulenburg ed.', publisher: 'Eulenburg', workId: 'work-2' }
		]);
		listAllCopiesMock.mockResolvedValue([]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		// 1. Work-select must exist
		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-work-select"]')).not.toBeNull();
		});

		// 2. Edition-select must be hidden or disabled until a work is selected
		const editionSelectBefore = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement | null;
		expect(editionSelectBefore === null || editionSelectBefore.disabled).toBe(true);

		// 3. Select work-1
		const workSelect = container.querySelector('[data-testid="bulk-checkout-work-select"]') as HTMLSelectElement;
		await fireEvent.change(workSelect, { target: { value: 'work-1' } });

		// 4. Edition-select should now be visible and enabled
		await waitFor(() => {
			const es = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
			expect(es).not.toBeNull();
			expect(es.disabled).not.toBe(true);
		});

		// 5. Only work-1's editions appear as options
		const editionOptions = container.querySelectorAll('[data-testid="bulk-checkout-edition-select"] option');
		const values = Array.from(editionOptions).map(o => (o as HTMLOptionElement).value).filter(v => v !== '');
		expect(values).toContain('ed-w1a');
		expect(values).toContain('ed-w1b');
		expect(values).not.toContain('ed-w2a');
	});

	// ── Refinement 2: available/total counter ────────────────────────────────
	it('shows "N/M available" counter when an edition is selected (available = copies not actively lent)', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		// copy-1 actively lent; copy-2 was returned (available); copy-3 never lent (available)
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-2', copyId: 'copy-2', memberId: 'member-b', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '2026-07-15' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
			{ id: 'copy-3', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

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
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		// member-a already has active lending for copy-1 (belongs to edition-1)
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-a', personId: 'person-a', currentSection: '' },
			{ memberId: 'member-b', personId: 'person-b', currentSection: '' }
		]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});

		// member-a already has active lending -> date label, NOT a checkbox
		const alreadyLent = container.querySelector('[data-testid="bulk-checkout-already-lent-member-a"]');
		expect(alreadyLent).not.toBeNull();
		expect(alreadyLent?.textContent).toContain('2026-07-01');

		// member-b has no active lending -> checkbox, no already-lent label
		expect(container.querySelector('[data-testid="bulk-checkout-already-lent-member-b"]')).toBeNull();
	});

	// ── Refinement 4: checked count <= available validation ──────────────────
	it('disables submit when checked member count exceeds available copy count; enables when within limit', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([]); // no active lendings -> all copies available
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		// Only 2 copies -> 2 available
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]);
		// 3 members
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-1', personId: 'person-1', currentSection: '' },
			{ memberId: 'member-2', personId: 'person-2', currentSection: '' },
			{ memberId: 'member-3', personId: 'person-3', currentSection: '' }
		]);

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

// ---------------------------------------------------------------------------
// #76 — consolidated corrections: return filter, count, tree counters,
// nameless guard.
// ---------------------------------------------------------------------------
describe('#76 — consolidated corrections', () => {
	// ── Correction 2: Bulk return edition filter ────────────────────────────
	// The bulk return edition dropdown must only show editions that have at
	// least one active lending (returnedAt === '' for a lending whose copyId
	// belongs to a copy of that edition).
	it('bulk return edition picker only lists editions with at least one active lending', async () => {
		listWorksMock.mockResolvedValue([]);
		// copy-e1 belongs to edition-1 and has an active lending;
		// copy-e2 belongs to edition-2 and has NO active lending.
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-e1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter', workId: 'work-1' },
			{ id: 'edition-2', name: 'Peters arrangement', publisher: 'Peters', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-e1', name: 'Copy E1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-e2', name: 'Copy E2', copyNumber: 1, editionId: 'edition-2' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		const options = container.querySelectorAll('[data-testid="bulk-return-edition-select"] option');
		const values = Array.from(options).map(o => (o as HTMLOptionElement).value).filter(v => v !== '');
		expect(values).toContain('edition-1');
		expect(values).not.toContain('edition-2');
	});

	it('bulk return edition picker has no edition options when there are no active lendings', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-e1', name: 'Copy E1', copyNumber: 1, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		const options = container.querySelectorAll('[data-testid="bulk-return-edition-select"] option');
		const values = Array.from(options).map(o => (o as HTMLOptionElement).value).filter(v => v !== '');
		// Only the placeholder option should remain — no editions with active lendings
		expect(values).toEqual([]);
	});

	// ── Correction 3: Bulk return lending count per edition ─────────────────
	// Each edition in the bulk return dropdown should show its active lending
	// count, e.g. "40-part original (3 lent)".
	it('bulk return edition option text includes the active lending count', async () => {
		listWorksMock.mockResolvedValue([]);
		// 3 active lendings for copies belonging to edition-1
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-2', copyId: 'copy-2', memberId: 'member-2', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-3', copyId: 'copy-3', memberId: 'member-3', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada'], ['member-2', 'Bob'], ['member-3', 'Carol']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
			{ id: 'copy-3', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		const options = container.querySelectorAll('[data-testid="bulk-return-edition-select"] option');
		const editionOption = Array.from(options).find(o => (o as HTMLOptionElement).value === 'edition-1');
		expect(editionOption).not.toBeNull();
		// Must include the count (3 active lendings) in the option text
		expect(editionOption?.textContent).toContain('(3');
	});

	// ── Correction 4: Works tree available/total counters (librarian) ──────
	// When the user is a librarian, show available/total copy counts behind
	// each work name in the browse tree, e.g. "Spem in alium (8/12)".
	it('librarian view shows available/total counter behind each work name in the browse tree', async () => {
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]);
		// 1 active lending for copy-1 (of edition-1, of work-1)
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		// 3 copies total for edition-1 (which belongs to work-1), 1 actively lent -> 2 available
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
			{ id: 'copy-3', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		// Wait for both the work list and librarian tools to render (allCopies
		// and allEditions are loaded before librarianStore is set)
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});

		const workRow = container.querySelector('[data-testid="library-work-work-1"]');
		// 3 copies, 1 lent => 2 available => "2/3" should appear in the work row
		expect(workRow?.textContent).toContain('2/3');
	});

	it('non-librarian view does NOT show an availability counter behind work names', async () => {
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		// Explicitly non-librarian
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});

		const workRow = container.querySelector('[data-testid="library-work-work-1"]');
		// No fraction pattern like "N/M" should appear for non-librarians
		expect(workRow?.textContent).not.toMatch(/\d+\/\d+/);
	});

	// ── Correction 5: Raw entity ID in member list ─────────────────────────
	// If a member's name resolves to '' (empty), the UI must show a
	// human-readable placeholder — never a raw hex entity ID like
	// "6a785fd523dc1d97bb8f1687".
	// #76 migration: the standalone checkout member-select is gone — the same
	// guard now applies to the inline checkout picker on the browse tree.
	it('member with empty resolved name shows a placeholder in the inline picker, never a raw 24-char hex entity ID', async () => {
		const hexId = '6a785fd523dc1d97bb8f1687';
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
		// The name resolves to empty string for the member
		resolveBorrowerNamesMock.mockResolvedValue(new Map([[hexId, '']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter' }]);
		listCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]);
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: hexId, personId: 'person-1', currentSection: '' }
		]);

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-toggle-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		// Wait for the inline picker with member options rendered
		await waitFor(() => {
			const options = container.querySelectorAll('[data-testid="inline-checkout-copy-1"] option');
			expect(options.length).toBeGreaterThan(1);
		});

		// The inline picker must NOT contain the raw hex ID anywhere
		const memberSelect = container.querySelector('[data-testid="inline-checkout-copy-1"]');
		expect(memberSelect?.textContent).not.toMatch(/[0-9a-f]{24}/);
	});

	// ── Correction 7: Stale bulkReturnEditionId after last loan returned ────
	it('clears bulk return edition selection when the selected edition drops out of the filtered list', async () => {
		// Start with one active lending for edition-1
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValueOnce([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);
		bulkReturnMock.mockResolvedValue({ succeeded: ['lend-1'], failed: [] });
		// After return, lendings list is empty (all returned)
		listLendingsMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		// Select edition-1
		const select = container.querySelector('[data-testid="bulk-return-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-loan-list"]')).not.toBeNull();
		});

		// Check the loan and submit bulk return
		const checkboxes = container.querySelectorAll('[data-testid="bulk-return-loan-list"] input[type="checkbox"]');
		await fireEvent.click(checkboxes[0]);
		const submitBtn = container.querySelector('[data-testid="bulk-return-submit"]') as HTMLButtonElement;
		await fireEvent.click(submitBtn);

		// After return completes, the loan list panel should disappear because
		// edition-1 no longer has active lendings and the selection should clear
		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-loan-list"]')).toBeNull();
		});
	});

	// ── Correction 8: My-loans copy name resolution (no raw entity IDs) ─────
	it('my-loans section shows resolved copy name, not raw entity ID', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-abc', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');
		resolveCopyNamesMock.mockResolvedValue(new Map([['copy-abc', 'Score #7']]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});

		// Expand to see loan rows
		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);

		await waitFor(() => {
			const item = container.querySelector('[data-testid="my-loans-item-lend-mine"]');
			expect(item).not.toBeNull();
			expect(item?.textContent).toContain('Score #7');
			// Must NOT contain the raw entity ID
			expect(item?.textContent).not.toContain('copy-abc');
		});
	});
});

// ---------------------------------------------------------------------------
// #75 — i18n key existence: every m.* call used in the component must exist in
// en.json. Guards against typos or stale keys that compile but render empty.
// ---------------------------------------------------------------------------
describe('#75 — i18n key existence', () => {
	it('every m.* key referenced in the library page component exists in en.json', () => {
		const componentSrc = readFileSync(resolve(process.cwd(), 'src/routes/library/+page.svelte'), 'utf-8');
		const messagesSrc = readFileSync(resolve(process.cwd(), 'messages/en.json'), 'utf-8');
		const messages = JSON.parse(messagesSrc) as Record<string, unknown>;

		// Extract all m.someKey( calls from the component
		const keyPattern = /\bm\.(\w+)\s*\(/g;
		const usedKeys = new Set<string>();
		let match: RegExpExecArray | null;
		while ((match = keyPattern.exec(componentSrc)) !== null) {
			usedKeys.add(match[1]);
		}

		expect(usedKeys.size).toBeGreaterThan(0);

		const missingKeys: string[] = [];
		for (const key of usedKeys) {
			if (!(key in messages)) {
				missingKeys.push(key);
			}
		}

		expect(missingKeys).toEqual([]);
	});
});

// Strips `//` line comments before scanning — the data layer's own doc header
// deliberately documents the constraint using the literal phrase
// `{ method: 'POST' | 'DELETE' }`, which is exactly what a naive full-text grep
// (design spec §5.3's guard) would false-positive on. Real code, not commentary
// about the rule, is what must be absent.
function stripLineComments(src: string): string {
	return src
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n');
}

describe('/library — read-only structural guard', () => {
	it('the data layer module never contains a write-method call (no POST/PUT/DELETE)', () => {
		const src = readFileSync(resolve(process.cwd(), 'src/lib/library/libraryData.ts'), 'utf-8');
		expect(stripLineComments(src)).not.toMatch(/method:\s*['"](POST|PUT|DELETE)['"]/);
	});

	it('the library page component never contains a write-method call (no POST/PUT/DELETE)', () => {
		const src = readFileSync(resolve(process.cwd(), 'src/routes/library/+page.svelte'), 'utf-8');
		expect(stripLineComments(src)).not.toMatch(/method:\s*['"](POST|PUT|DELETE)['"]/);
	});
});

// (*MVOX:Tallis*)
