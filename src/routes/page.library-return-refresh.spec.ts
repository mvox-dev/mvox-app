// @vitest-environment happy-dom
// The library page: returning a copy refreshes the copy row and its work's tally.
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
vi.mock('$lib/library/libraryRights', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);
vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	returnLendingMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibraryEditRightMock } from '$lib/testing/mocks/admin';
import { signInLibraryReader } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';

useLibraryPage();

const copies = [
	{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
	{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
];
const lent = {
	id: 'lend-1',
	copyId: 'copy-2',
	memberId: 'member-a',
	assignedAt: '2026-07-01',
	assignedUntil: '',
	returnedAt: ''
};

describe('returning a lent copy', () => {
	it('flips the copy row to available and raises its work tally from the refreshed lendings', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'B' }]));
		listCopiesMock.mockResolvedValue(toListRead(copies));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		signInLibraryReader({ myLibraryId: 'lib-1' });
		resolveLibraryEditRightMock.mockResolvedValue({ state: 'editor', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(
			toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'B', workId: 'work-1' }])
		);
		listAllCopiesMock.mockResolvedValue(toListRead(copies));
		listActiveMembersMock.mockResolvedValue(toListRead([]));
		returnLendingMock.mockResolvedValue(undefined);
		listLendingsMock
			.mockResolvedValueOnce(toListRead([lent]))
			.mockResolvedValue(toListRead([{ ...lent, returnedAt: '2026-07-20' }]));

		const { container } = render(Page);
		const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
		await waitFor(() => expect(q('library-work-toggle-work-1')?.textContent).toContain('(1/2)'));
		await fireEvent.click(q('library-work-toggle-work-1') as Element);
		await waitFor(() => expect(q('library-edition-toggle-edition-1')).not.toBeNull());
		await fireEvent.click(q('library-edition-toggle-edition-1') as Element);
		await waitFor(() => expect(q('library-copy-copy-2')?.textContent).toContain('Out — Ada Lovelace'));

		await fireEvent.click(q('library-return-copy-2') as Element);

		await waitFor(() => expect(q('library-copy-copy-2')?.textContent).not.toContain('Out'));
		expect(q('library-return-copy-2')).toBeNull();
		expect(q('library-work-toggle-work-1')?.textContent).toContain('(2/2)');
	});
});
