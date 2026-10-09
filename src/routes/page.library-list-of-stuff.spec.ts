// @vitest-environment happy-dom
// The library work list renders through ListOfStuff, with no filter or view control (#862).
import { render, waitFor } from '@testing-library/svelte';
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
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock
} from '$lib/testing/mocks/library';
import { signInLibraryReader } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';
import { q } from '$lib/testing/pages/dom';

useLibraryPage();

describe('/library — list of stuff', () => {
	it('puts the work list inside the list body, with no filter or view slot', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'library-work-list')).not.toBeNull();
		});

		expect(q(container, 'list-of-stuff-body')!.contains(q(container, 'library-work-list'))).toBe(true);
		expect(q(container, 'list-of-stuff-filter')).toBeNull();
		expect(q(container, 'list-of-stuff-view')).toBeNull();
	});
});
