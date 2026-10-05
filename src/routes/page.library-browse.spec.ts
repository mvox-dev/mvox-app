// @vitest-environment happy-dom
// The library page: browsing works, editions and copies, and the librarian tools.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
);
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
// importActual of libraryData pulls in $lib/entu-config, which reads $env/dynamic/public:
// unavailable under happy-dom. Same fix as page.profile.spec.ts.
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

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock
} from '$lib/testing/mocks/library';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import { signInLibraryReader } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';

useLibraryPage();

describe('/library — work expand -> edition expand -> copy availability', () => {
	it('expanding a work lazily loads its editions; expanding an edition lazily loads its copies; availability reflects an active lending', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([
			{
				id: 'lend-1',
				copyId: 'copy-2',
				memberId: 'member-a',
				assignedAt: '2026-07-01',
				assignedUntil: '2026-08-01',
				returnedAt: ''
			}
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]));
		listCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});
		expect(listEditionsMock).not.toHaveBeenCalled();

		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		// #434 — through libraryPageData, which threads a fetchImpl and the CACHED_READ
		// opts alongside the (cfg, id) pair.
		await waitFor(() =>
			expect(listEditionsMock).toHaveBeenCalledWith(
				expect.anything(),
				'work-1',
				expect.anything(),
				expect.anything()
			)
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		});
		expect(listCopiesMock).not.toHaveBeenCalled();

		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);
		await waitFor(() =>
			expect(listCopiesMock).toHaveBeenCalledWith(
				expect.anything(),
				'edition-1',
				expect.anything(),
				expect.anything()
			)
		);

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
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue(toListRead([]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });

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
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([
			{
				id: 'lend-1',
				copyId: 'copy-1',
				memberId: 'member-x',
				assignedAt: '2026-07-01',
				assignedUntil: '',
				returnedAt: ''
			}
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-x', '']]));
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: 'Ed', publisher: 'Pub' }]));
		listCopiesMock.mockResolvedValue(toListRead([{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });

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
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockReturnValue(new Promise(() => {}));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')).toBeNull();
		expect(container.querySelector('[data-testid="librarian-load-error"]')).toBeNull();
	});

	it('shows the librarian placeholder section when resolveLibrarian resolves librarian', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')?.textContent).toContain('Librarian tools');
	});

	it('hides librarian tools when resolveLibrarian resolves not-librarian (fail-closed)', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="librarian-tools"]')).toBeNull();
	});

	it('shows a retry action when resolveLibrarian errors; retry re-resolves and reveals tools', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
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

// (*MVOX:Tallis*)
