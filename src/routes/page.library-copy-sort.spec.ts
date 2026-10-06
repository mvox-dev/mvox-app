// @vitest-environment happy-dom
import { render, createEvent, fireEvent, waitFor } from '@testing-library/svelte';
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

function setSortFixture() {
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listEditionsMock.mockResolvedValue(toListRead([
		{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }
	]));
	listCopiesMock.mockResolvedValue(toListRead([
		{ id: 'copy-a', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' },
		{ id: 'copy-d', name: '', copyNumber: 0, editionId: 'edition-1' },
		{ id: 'copy-b', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
		{ id: 'copy-c', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
	]));
	listLendingsMock.mockResolvedValue(toListRead([
		{
			id: 'lend-b',
			copyId: 'copy-b',
			memberId: 'member-z',
			assignedAt: '2026-07-15',
			assignedUntil: '',
			returnedAt: ''
		},
		{
			id: 'lend-c',
			copyId: 'copy-c',
			memberId: 'member-a',
			assignedAt: '2026-06-01',
			assignedUntil: '',
			returnedAt: ''
		}
	]));
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map([
			['member-z', 'Zara Zilch'],
			['member-a', 'Adam Aber']
		])
	);
	signInLibraryReader({ librarian: true });
}

async function renderWithEditionUnfolded() {
	setSortFixture();
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
		expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull()
	);
	await waitFor(() =>
		expect(container.querySelector('[data-testid="library-copy-copy-a"]')).not.toBeNull()
	);
	return container;
}

afterEach(resetCopyListMocks);

describe('/library — copy list sort controls (#112/#88)', () => {
	it('an unfolded edition shows three visible, labeled sort controls: nr / member / since', async () => {
		const container = await renderWithEditionUnfolded();

		const nr = container.querySelector(sortBtn('nr'));
		const member = container.querySelector(sortBtn('member'));
		const since = container.querySelector(sortBtn('since'));
		expect(nr).not.toBeNull();
		expect(member).not.toBeNull();
		expect(since).not.toBeNull();

		expect(nr!.textContent).toContain('Nr');
		expect(member!.textContent).toContain('Member');
		expect(since!.textContent).toContain('Since');

		for (const el of [nr, member, since]) {
			expect(el!.closest('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		}
	});

	it('default sort is by nr, ascending — even though the fetch delivered the copies out of order', async () => {
		const container = await renderWithEditionUnfolded();

		expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);

		expect(container.querySelector(sortBtn('nr'))!.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector(sortBtn('member'))!.getAttribute('aria-pressed')).toBe(
			'false'
		);
		expect(container.querySelector(sortBtn('since'))!.getAttribute('aria-pressed')).toBe(
			'false'
		);
	});

	it('sorting by member orders by borrower name A→Z; unassigned copies (no borrower) sort LAST', async () => {
		const container = await renderWithEditionUnfolded();

		await fireEvent.click(container.querySelector(sortBtn('member'))!);
		await waitFor(() => {
			expect(
				container.querySelector(sortBtn('member'))!.getAttribute('aria-pressed')
			).toBe('true');
		});

		const order = copyOrder(container);
		expect(order.slice(0, 2)).toEqual(['copy-c', 'copy-b']);
		expect(new Set(order.slice(2))).toEqual(new Set(['copy-a', 'copy-d']));
	});

	it('sorting by since orders by lending start date, oldest loan first; copies with no lending date sort LAST', async () => {
		const container = await renderWithEditionUnfolded();

		await fireEvent.click(container.querySelector(sortBtn('since'))!);
		await waitFor(() => {
			expect(container.querySelector(sortBtn('since'))!.getAttribute('aria-pressed')).toBe(
				'true'
			);
		});

		const order = copyOrder(container);
		expect(order.slice(0, 2)).toEqual(['copy-c', 'copy-b']);
		expect(new Set(order.slice(2))).toEqual(new Set(['copy-a', 'copy-d']));
	});

	it('switching sort keys re-orders the SAME list in place — member, then back to nr restores the default order', async () => {
		const container = await renderWithEditionUnfolded();
		expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);

		await fireEvent.click(container.querySelector(sortBtn('member'))!);
		await waitFor(() => {
			expect(copyOrder(container).slice(0, 2)).toEqual(['copy-c', 'copy-b']);
		});

		await fireEvent.click(container.querySelector(sortBtn('nr'))!);
		await waitFor(() => {
			expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);
		});
		expect(container.querySelector(sortBtn('nr'))!.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector(sortBtn('member'))!.getAttribute('aria-pressed')).toBe(
			'false'
		);

		expect(listCopiesMock).toHaveBeenCalledTimes(1);
	});
});

describe('/library — copy-sort controls a11y (#113)', () => {
	it('the three controls live in a role="toolbar" with an m.* accessible name, each a toggle button (#809)', async () => {
		const container = await renderWithEditionUnfolded();
		const group = container.querySelector('[data-testid="copy-sort-edition-1"]');
		expect(group, 'the sort control group').not.toBeNull();
		expect(group!.getAttribute('role')).toBe('toolbar');
		expect(group!.getAttribute('aria-label')).toBe('Sort copies by');
		for (const key of ['nr', 'member', 'since'] as const) {
			expect(container.querySelector(sortBtn(key))!.closest('[role="toolbar"]')).toBe(group);
			expect(container.querySelector(sortBtn(key))!.getAttribute('aria-pressed')).not.toBeNull();
		}
	});

	it('every sort control is a native <button type="button"> — Enter/Space operability for free, and no accidental form submits', async () => {
		const container = await renderWithEditionUnfolded();
		for (const key of ['nr', 'member', 'since'] as const) {
			const btn = container.querySelector(sortBtn(key)) as HTMLElement;
			expect(btn.tagName, `copy-sort-${key}`).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
		}
	});

	it('exactly ONE control reports aria-pressed="true" at any time, and the marker follows a key switch', async () => {
		const container = await renderWithEditionUnfolded();
		const pressed = () =>
			(['nr', 'member', 'since'] as const).filter(
				(key) => container.querySelector(sortBtn(key))!.getAttribute('aria-pressed') === 'true'
			);
		expect(pressed()).toEqual(['nr']);
		await fireEvent.click(container.querySelector(sortBtn('since'))!);
		await waitFor(() => {
			expect(pressed()).toEqual(['since']);
		});
	});
});

describe('/library — copy-sort chips: roving tabindex (#156)', () => {
	const KEYS = ['nr', 'member', 'since'] as const;

	function chips(container: HTMLElement): HTMLButtonElement[] {
		return KEYS.map((key) => container.querySelector(sortBtn(key)) as HTMLButtonElement);
	}
	function stops(container: HTMLElement): HTMLButtonElement[] {
		return chips(container).filter((c) => c.getAttribute('tabindex') === '0');
	}

	it('exactly ONE chip is the Tab stop, and it is the pressed key', async () => {
		const container = await renderWithEditionUnfolded();
		expect(stops(container)).toEqual([chips(container)[0]]);
	});

	it('arrows move focus and wrap, and never re-sort the list (#809)', async () => {
		const container = await renderWithEditionUnfolded();
		const [nr, member, since] = chips(container);

		nr.focus();
		await fireEvent.keyDown(nr, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(member);
		expect(stops(container)).toEqual([member]);
		await fireEvent.keyDown(member, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(since);
		await fireEvent.keyDown(since, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(nr);
		await fireEvent.keyDown(nr, { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(since);
		expect(nr.getAttribute('aria-pressed')).toBe('true');
		expect(copyOrder(container)).toEqual(['copy-b', 'copy-c', 'copy-a', 'copy-d']);
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus leaves the group and the chip still activates', async () => {
		const container = await renderWithEditionUnfolded();
		const chip = chips(container)[0];
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(chip, { key });
			fireEvent(chip, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});
});

// (*MVOX:Tallis*)
