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
		library_create_work_button: () => 'Add work',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_error: () => 'Could not create the work.',
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
		// #76 — inline checkout on browse tree
		library_inline_checkout_placeholder: () => 'Select member',
		library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_inline_checkout_error: () => 'Checkout failed',
		// #112/#88 — copy-list sort controls
		library_copy_sort_label: () => 'Sort copies by',
		library_copy_sort_nr: () => 'Nr',
		library_copy_sort_member: () => 'Member',
		library_copy_sort_since: () => 'Since',
		// #128 — collapsed-available summary line
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
		// #129 — loan → copy → edition → work chain resolver (network fallback
		// when the chain isn't already available from locally-loaded data).
		resolveCopyChainsMock: vi.fn()
	}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual, // keep the real, pure deriveCopyAvailability / deriveWorkAvailability / formatLoanChainLabel
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
// vi.importActual for $lib/library/libraryData (kept above, to preserve the real
// deriveCopyAvailability) pulls entuFetch -> $lib/entu-config, which reads
// $env/dynamic/public — unavailable outside a SvelteKit request context under
// happy-dom. Same fix as page.profile.spec.ts.
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

// T6.4/#73 — "my loans" resolves the viewer's own active member the same way
// RSVP already does (rsvpData.ts's findMyMemberId: person + status=active, no
// org scoping in single-collective polyphony). Reused rather than re-derived.
const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

// #74 — mock lendingActions to verify submit triggers the action layer
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
	// Default: empty loan chains, unless a test overrides. (#129)
	resolveCopyChainsMock.mockResolvedValue(new Map());
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
	resolveCopyChainsMock.mockReset();
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

	// #89 TR.1 regression guard — after the file/external_link sharing widen,
	// Edition rows carry externalLinks + files. The browse tree must keep
	// rendering name/publisher unchanged with the widened shape flowing through.
	it('edition rows still render name + publisher when editions carry files and externalLinks (#89)', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue([
			{
				id: 'edition-1',
				name: '40-part original',
				publisher: 'Bärenreiter',
				externalLinks: ['https://imslp.org/wiki/Spem_in_alium'],
				files: [{ id: 'file-1', filename: 'spem-vocal-score.pdf', filesize: 1937, filetype: 'application/pdf' }]
			}
		]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);

		await waitFor(() => {
			const edition = container.querySelector('[data-testid="library-edition-edition-1"]');
			expect(edition).not.toBeNull();
			expect(edition?.textContent).toContain('40-part original');
			expect(edition?.textContent).toContain('Bärenreiter');
		});
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

		// #128 — member view collapses the available copy (copy-1) into a
		// summary line instead of an individual row; the lent copy (copy-2)
		// still renders individually.
		await waitFor(() => {
			const summary = container.querySelector(
				'[data-testid="library-available-summary-edition-1"]'
			);
			const copy2 = container.querySelector('[data-testid="library-copy-copy-2"]');
			expect(container.querySelector('[data-testid="library-copy-copy-1"]')).toBeNull();
			expect(summary?.textContent).toContain('1 copies available for lending');
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

	it('clicking the return button calls returnLending with the lending ID and refreshes lendings', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock
			.mockResolvedValueOnce([
				{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
			])
			// After return, the refreshed lendings list shows the lending as returned
			.mockResolvedValue([
				{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '2026-08-10' }
			]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter' }]);
		listCopiesMock.mockResolvedValue([{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }]);
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] }
		]);
		returnLendingMock.mockResolvedValue(undefined);

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-return-copy-2"]')).not.toBeNull();
		});

		// Click the return button
		await fireEvent.click(container.querySelector('[data-testid="library-return-copy-2"]') as Element);

		// returnLending must be called with the lending ID
		await waitFor(() => expect(returnLendingMock).toHaveBeenCalledTimes(1));
		const callArgs = returnLendingMock.mock.calls[0];
		// callArgs: [cfg, lendingId, fetchImpl?]
		expect(callArgs[1]).toBe('lend-1');

		// Server-confirmed: lendings are re-fetched and the return button
		// disappears (copy is now available — for a librarian the inline
		// checkout dropdown replaces the return button).
		await waitFor(() => expect(listLendingsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-return-copy-2"]')).toBeNull();
			expect(container.querySelector('[data-testid="inline-checkout-copy-2"]')).not.toBeNull();
		});
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
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] }
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
		setAuthedWithOneCollective();
		mockLibrarianCheckoutData();

		const { container } = render(Page);
		await expandToCopies(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="inline-checkout-copy-1"]') as HTMLSelectElement;
		// member-a already holds copy-2 of edition-1 → disabled, with the
		// lending date visible in the option text. #207 rule 7 (supersedes #76
		// correction 9): lending dates are tabular date text and render as the
		// ISO calendar date itself — assert the exact string the mock echoes.
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

	// #76 correction 8: the separate bulk-return section is REMOVED — inline
	// Return buttons on lent copy rows are the only return surface. The old
	// "visible to librarian" presence test is inverted accordingly.
	it('bulk return section does NOT exist — not even for a librarian (#76 correction 8)', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]);

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
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] }
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
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] },
			{ memberId: 'member-2', personId: 'person-2', sectionIds: [] }
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

	// (The old grouped-bulk-return shape tests — edition picker, no flat loan
	// list, edition-scoped loan list — are REMOVED by #76 correction 8: the
	// bulk return section no longer exists at all.)

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
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] },
			{ memberId: 'member-2', personId: 'person-2', sectionIds: [] }
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

	// (The old bulk-return submit-wiring and edition-scoped-filtering tests are
	// REMOVED by #76 correction 8 — the section, and with it the bulkReturn
	// UI path, no longer exists.)
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
			{ memberId: 'member-a', personId: 'person-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'person-b', sectionIds: [] }
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
			{ memberId: 'member-1', personId: 'person-1', sectionIds: [] },
			{ memberId: 'member-2', personId: 'person-2', sectionIds: [] },
			{ memberId: 'member-3', personId: 'person-3', sectionIds: [] }
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
	// (Corrections 2, 3, and 7 — bulk return edition filter, per-edition lending
	// count, and stale-selection clearing — are REMOVED along with the bulk
	// return section itself, per #76 correction 8.)

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
			{ memberId: hexId, personId: 'person-1', sectionIds: [] }
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

	// ── Correction 8 / #129: My-loans copy chain resolution (no raw entity IDs) ─
	// #129 — superseded: a bare resolved copy name ("Score #7") is no longer
	// enough context; the loan row must show the full copy -> edition -> work
	// chain. resolveCopyNames stays as its own tested unit (libraryData.spec.ts)
	// but is no longer what the my-loans row renders from.
	it('my-loans section shows the resolved copy -> edition -> work chain, not raw entity IDs', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-abc', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');
		resolveCopyChainsMock.mockResolvedValue(
			new Map([['copy-abc', { copyNumber: 7, workName: 'Spem in alium', editionName: '40-part original' }]])
		);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});

		// Expand to see loan rows
		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);

		await waitFor(() => {
			const item = container.querySelector('[data-testid="my-loans-item-lend-mine"]');
			expect(item).not.toBeNull();
			expect(item?.textContent).toContain('Copy #7 — Spem in alium / 40-part original');
			// Must NOT contain the raw entity ID
			expect(item?.textContent).not.toContain('copy-abc');
		});
	});

	// ── #129 AC2: no copy number -> work/edition shown without the number ────
	it('when the copy has no number, the loan row shows work/edition context without a copy-number prefix', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-abc', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');
		resolveCopyChainsMock.mockResolvedValue(
			new Map([['copy-abc', { copyNumber: 0, workName: 'Spem in alium', editionName: '40-part original' }]])
		);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);

		await waitFor(() => {
			const item = container.querySelector('[data-testid="my-loans-item-lend-mine"]');
			expect(item).not.toBeNull();
			expect(item?.textContent).toContain('Spem in alium / 40-part original');
			expect(item?.textContent).not.toContain('Copy #');
		});
	});

	// ── #129 AC3: chain resolves from already-loaded data, no new fetch ──────
	// A librarian who is ALSO the current member already has the full chain
	// available locally: allCopies carries editionId, allEditions carries
	// workId + name, and works (loaded for every viewer) carries the work
	// name. In that case the page must resolve the chain from those caches —
	// resolveCopyChains (the network fallback) must not be invoked at all.
	it('resolves the loan chain from already-loaded librarian data (allCopies/allEditions/works) without calling the network resolver', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: '', copyNumber: 3, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);

		await waitFor(() => {
			const item = container.querySelector('[data-testid="my-loans-item-lend-mine"]');
			expect(item).not.toBeNull();
			expect(item?.textContent).toContain('Copy #3 — Spem in alium / 40-part original');
		});
		expect(resolveCopyChainsMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// #76 — correction 9: lending dates are rendered localized (Intl.DateTimeFormat
// with the current locale), never as raw ISO timestamps. Live Entu date
// properties arrive as full ISO strings like "2026-07-01T00:00:00.000Z"; the
// UI must format them for humans. #207 rule 7 (supersedes correction 9's
// locale-dependent rendering): lending dates are tabular date text, so the
// human form is the ISO calendar DATE itself — `YYYY-MM-DD`, exact — while the
// raw timestamp's TIME component must still never leak.
// ---------------------------------------------------------------------------
describe('#76 correction 9 → #207 rule 7: lending dates render as the ISO calendar date, never a raw timestamp', () => {
	// Matches the time component of a raw ISO timestamp, e.g. "T00:00:00".
	const RAW_ISO_TIME = /T\d{2}:\d{2}/;

	it('a lent copy row shows a localized "since" date, never a raw ISO timestamp', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter' }]);
		listCopiesMock.mockResolvedValue([{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-toggle-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-copy-copy-2"]')?.textContent).toContain('Out');
		});
		const row = container.querySelector('[data-testid="library-copy-copy-2"]');
		// The raw ISO time component must never leak into the UI...
		expect(row?.textContent).not.toMatch(RAW_ISO_TIME);
		// ...and the date is the exact ISO calendar day (#207 rule 7; the mock
		// echoes `since ${date}`).
		expect(row?.textContent).toContain('since 2026-07-01');
	});

	it('my-loans shows localized assignedAt/assignedUntil dates, never raw ISO', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-abc', memberId: 'member-mine', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '2099-01-01T00:00:00.000Z', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');
		// #129 — chain deliberately digit-free (no copy number, digit-free work/
		// edition names) so the year anchors below can only come from rendered
		// dates, not from the loan-chain label itself.
		resolveCopyChainsMock.mockResolvedValue(
			new Map([['copy-abc', { copyNumber: 0, workName: 'Untitled Mass', editionName: 'Urtext' }]])
		);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans-item-lend-mine"]')).not.toBeNull();
		});

		const item = container.querySelector('[data-testid="my-loans-item-lend-mine"]');
		// Never a raw ISO timestamp anywhere in the loan row.
		expect(item?.textContent).not.toMatch(RAW_ISO_TIME);
		// Both lending dates are the exact ISO calendar days (#207 rule 7).
		expect(item?.textContent).toContain('2026-07-01'); // assignedAt
		expect(item?.textContent).toContain('2099-01-01'); // assignedUntil
	});

	it('bulk checkout member picker "already lent" date is localized, never raw ISO', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		// member-a already holds copy-1 of edition-1 — full-ISO assignedAt as
		// live Entu delivers it.
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '', returnedAt: '' }
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
			{ memberId: 'member-a', personId: 'person-a', sectionIds: [] }
		]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-already-lent-member-a"]')).not.toBeNull();
		});
		const alreadyLent = container.querySelector('[data-testid="bulk-checkout-already-lent-member-a"]');
		expect(alreadyLent?.textContent).not.toMatch(RAW_ISO_TIME);
		// #207 rule 7 — exact ISO calendar day (mock echoes `Lent since ${date}`).
		expect(alreadyLent?.textContent).toContain('Lent since 2026-07-01');
	});

	it('inline checkout picker disabled-member lending date is localized, never raw ISO', async () => {
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace'], ['member-b', 'Ben Jonson']]));
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter' }]);
		listCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]);
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] }
		]);

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-toggle-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="inline-checkout-copy-1"]')).not.toBeNull();
		});
		const select = container.querySelector('[data-testid="inline-checkout-copy-1"]') as HTMLSelectElement;
		await waitFor(() => {
			expect(select.querySelector('option[value="member-a"]')).not.toBeNull();
		});
		const optA = select.querySelector('option[value="member-a"]') as HTMLOptionElement;
		expect(optA.disabled).toBe(true);
		expect(optA.textContent).not.toMatch(RAW_ISO_TIME);
		// #207 rule 7 — exact ISO calendar day (mock echoes `Lent since ${date}`).
		expect(optA.textContent).toContain('Lent since 2026-07-01');
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
