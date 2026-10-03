// @vitest-environment happy-dom
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
);

vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule({ chains: false })
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).activeMembersModule()
);

vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule({ libraryId: false })
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
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock
} from '$lib/testing/mocks/library';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import { resetCopyListMocks, signInLibraryReader } from '$lib/testing/pages/library';

type Fixture = {
	lent: string[];
	available: string[];
};

function setFixture({ lent, available }: Fixture) {
	const all = [...lent, ...available];
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listEditionsMock.mockResolvedValue(toListRead([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]));
	listCopiesMock.mockResolvedValue(toListRead(
		all.map((id, i) => ({
			id,
			name: `Copy #${i + 1}`,
			copyNumber: i + 1,
			editionId: 'edition-1'
		}))
	));
	const borrowers = ['Adam Aber', 'Beata Berg', 'Carl Corno', 'Dora Dux', 'Enn Erg'];
	listLendingsMock.mockResolvedValue(toListRead(
		lent.map((copyId, i) => ({
			id: `lend-${copyId}`,
			copyId,
			memberId: `member-${i}`,
			assignedAt: `2026-07-0${i + 1}`,
			assignedUntil: '',
			returnedAt: ''
		}))
	));
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map(lent.map((_, i) => [`member-${i}`, borrowers[i]]))
	);
	signInLibraryReader();
}

const SUMMARY = '[data-testid="library-available-summary-edition-1"]';

function copyRows(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid="library-edition-edition-1"] [data-testid^="library-copy-"]'
		)
	].map((el) => el.getAttribute('data-testid')!.replace('library-copy-', ''));
}

async function renderWithEditionUnfolded() {
	const { container } = render(Page);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull()
	);
	await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]')!);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull()
	);
	await fireEvent.click(
		container.querySelector('[data-testid="library-edition-toggle-edition-1"]')!
	);
	return container;
}

afterEach(resetCopyListMocks);

describe('/library — member view collapses available copies (#128)', () => {
	it('member view: lent copies render individually, available copies collapse into ONE summary line with the count', async () => {
		setFixture({ lent: ['copy-b', 'copy-c'], available: ['copy-a', 'copy-d', 'copy-e'] });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-b"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="library-copy-copy-c"]')).not.toBeNull();

		expect(copyRows(container).sort()).toEqual(['copy-b', 'copy-c']);
		for (const id of ['copy-a', 'copy-d', 'copy-e']) {
			expect(
				container.querySelector(`[data-testid="library-copy-${id}"]`),
				`individual row for available ${id}`
			).toBeNull();
		}

		const summaries = container.querySelectorAll(SUMMARY);
		expect(summaries.length, 'summary line count').toBe(1);
		expect(summaries[0].textContent).toContain('3 copies available for lending');
	});

	it('librarian view: NO collapse — every copy renders individually and no summary line appears', async () => {
		setFixture({ lent: ['copy-b', 'copy-c'], available: ['copy-a', 'copy-d', 'copy-e'] });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull()
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
		);

		expect(copyRows(container).sort()).toEqual([
			'copy-a',
			'copy-b',
			'copy-c',
			'copy-d',
			'copy-e'
		]);
		expect(container.querySelector(SUMMARY)).toBeNull();
	});

	it('member view, ALL copies available: only the summary line renders — zero individual rows', async () => {
		setFixture({ lent: [], available: ['copy-a', 'copy-b', 'copy-c'] });
		const container = await renderWithEditionUnfolded();

		await waitFor(() => expect(container.querySelector(SUMMARY)).not.toBeNull());
		expect(container.querySelector(SUMMARY)!.textContent).toContain(
			'3 copies available for lending'
		);
		expect(copyRows(container)).toEqual([]);
	});

	it('librarian view, ALL copies available: all rows render individually, no summary line', async () => {
		setFixture({ lent: [], available: ['copy-a', 'copy-b', 'copy-c'] });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull()
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
		);

		expect(copyRows(container).sort()).toEqual(['copy-a', 'copy-b', 'copy-c']);
		expect(container.querySelector(SUMMARY)).toBeNull();
	});

	it('member view, ALL copies lent: every row renders individually and NO summary line appears (count 0 is noise)', async () => {
		setFixture({ lent: ['copy-a', 'copy-b', 'copy-c'], available: [] });
		const container = await renderWithEditionUnfolded();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
		);

		expect(copyRows(container).sort()).toEqual(['copy-a', 'copy-b', 'copy-c']);
		expect(container.querySelector(SUMMARY)).toBeNull();
	});
});

// (*MVOX:Tallis*)
