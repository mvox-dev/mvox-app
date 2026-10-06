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
import {
	copyOrder,
	resetCopyListMocks,
	signInLibraryReader,
	sortBtn
} from '$lib/testing/pages/library';

function setPartitionFixture() {
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listEditionsMock.mockResolvedValue(toListRead([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]));
	listCopiesMock.mockResolvedValue(toListRead([
		{ id: 'lent-alpha', name: 'Copy #8', copyNumber: 8, editionId: 'edition-1' },
		{ id: 'avail-none', name: '', copyNumber: 0, editionId: 'edition-1' },
		{ id: 'avail-three', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' },
		{ id: 'lent-none', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
		{ id: 'avail-one', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
		{ id: 'lent-beta', name: 'Copy #5', copyNumber: 5, editionId: 'edition-1' }
	]));
	listLendingsMock.mockResolvedValue(toListRead([
		{
			id: 'lend-alpha',
			copyId: 'lent-alpha',
			memberId: 'member-alpha',
			assignedAt: '',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-beta',
			copyId: 'lent-beta',
			memberId: 'member-beta',
			assignedAt: '2026-07-01',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-none',
			copyId: 'lent-none',
			memberId: 'member-noname',
			assignedAt: '2026-06-15',
			assignedUntil: '',
			returnedAt: ''
		}
	]));
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map([
			['member-alpha', 'Alpha Person'],
			['member-beta', 'Beta Person'],
			['member-noname', '']
		])
	);
	signInLibraryReader({ librarian: true });
}

async function renderWithEditionUnfolded() {
	setPartitionFixture();
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
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-copy-lent-alpha"]')).not.toBeNull()
	);
	return container;
}

async function activate(container: HTMLElement, key: 'nr' | 'member' | 'since') {
	await fireEvent.click(container.querySelector(sortBtn(key))!);
	await waitFor(() => {
		expect(container.querySelector(sortBtn(key))!.getAttribute('aria-pressed')).toBe('true');
	});
}

const LENT_IDS = new Set(['lent-alpha', 'lent-beta', 'lent-none']);

afterEach(resetCopyListMocks);

describe('/library — copy sort is PARTITION-then-sort: lent group first, available group always nr-sorted (#126 / #114 F6)', () => {
	it('nr: lent copies sorted by nr, then available copies sorted by nr — partition boundary holds', async () => {
		const container = await renderWithEditionUnfolded();
		expect(copyOrder(container)).toEqual([
			'lent-none',
			'lent-beta',
			'lent-alpha',
			'avail-one',
			'avail-three',
			'avail-none'
		]);
	});

	it("member: lent copies sorted by borrower name (nameless sorts last WITHIN the lent group), then available copies sorted by nr", async () => {
		const container = await renderWithEditionUnfolded();
		await activate(container, 'member');

		const order = copyOrder(container);
		expect(order.slice(0, 3)).toEqual(['lent-alpha', 'lent-beta', 'lent-none']);
		expect(order.slice(3)).toEqual(['avail-one', 'avail-three', 'avail-none']);
	});

	it('since: lent copies sorted by lending date (undated active lending sorts last WITHIN the lent group), then available copies sorted by nr', async () => {
		const container = await renderWithEditionUnfolded();
		await activate(container, 'since');

		const order = copyOrder(container);
		expect(order.slice(0, 3)).toEqual(['lent-none', 'lent-beta', 'lent-alpha']);
		expect(order.slice(3)).toEqual(['avail-one', 'avail-three', 'avail-none']);
	});

	it('partition boundary holds under every key: no available copy ever appears before a lent copy', async () => {
		const container = await renderWithEditionUnfolded();

		for (const key of ['nr', 'member', 'since'] as const) {
			await activate(container, key);
			const order = copyOrder(container);
			const lastLentIndex = Math.max(...order.map((id, i) => (LENT_IDS.has(id) ? i : -1)));
			const firstAvailableIndex = order.findIndex((id) => !LENT_IDS.has(id));
			expect(firstAvailableIndex, `key=${key}`).toBeGreaterThan(lastLentIndex);
		}
	});
});

// (*MVOX:Tallis chain — RED by red-126, corrected to partition-then-sort by fix-f6*)
