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
		library_lent_since: (p: { date: string }) => `since ${p.date}`,
		library_node_load_error: () => 'Could not load.',
		library_node_retry: () => 'Retry',
		library_librarian_tools: () => 'Librarian tools',
		library_librarian_load_error: () => 'Could not check librarian access.',
		library_librarian_retry: () => 'Retry',
		library_my_loans_title: (p: { count: number }) => `My loans (${p.count})`,
		library_my_loans_copy_label: (p: { copyId: string }) => `Copy: ${p.copyId}`,
		library_my_loans_overdue: () => 'Overdue',
		library_checkout_copy_placeholder: () => 'Select copy',
		library_checkout_member_placeholder: () => 'Select member',
		library_checkout_submit: () => 'Checkout',
		library_return: () => 'Return',
		library_bulk_checkout_title: () => 'Bulk checkout',
		library_bulk_return_title: () => 'Bulk return'
	}
}));

const { listWorksMock, listEditionsMock, listCopiesMock, listAllCopiesMock, listLendingsMock, resolveBorrowerNamesMock } =
	vi.hoisted(() => ({
		listWorksMock: vi.fn(),
		listEditionsMock: vi.fn(),
		listCopiesMock: vi.fn(),
		listAllCopiesMock: vi.fn(),
		listLendingsMock: vi.fn(),
		resolveBorrowerNamesMock: vi.fn()
	}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual, // keep the real, pure deriveCopyAvailability
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock
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
	// Default: empty checkout data, unless a test overrides.
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
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
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

describe('#73 — librarian checkout + return', () => {
	it('checkout form (copy picker + member picker + optional due date + submit) is visible to a librarian', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="checkout-form"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="checkout-copy-select"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="checkout-member-select"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="checkout-due-date"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="checkout-submit"]')).not.toBeNull();
	});

	it('checkout form is hidden from a non-librarian', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="checkout-form"]')).toBeNull();
	});

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

describe('#74 — bulk checkout + return', () => {
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
