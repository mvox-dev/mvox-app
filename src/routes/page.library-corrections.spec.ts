// @vitest-environment happy-dom
// The library page: the consolidated corrections and lending dates.
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
// #434 — the write paths resolve the library id live through `resolveMyLibraryId`,
// never off the cache-backed librarian resolution, so it is mocked here too.
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveCopyChainsMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import { signInLibraryReader } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';

useLibraryPage();

// #76 — consolidated corrections: return filter, count, tree counters,
// nameless guard.
describe('#76 — consolidated corrections', () => {
	// ── Correction 4: Works tree available/total counters (librarian) ──────
	// When the user is a librarian, show available/total copy counts behind
	// each work name in the browse tree, e.g. "Spem in alium (8/12)".
	it('librarian view shows available/total counter behind each work name in the browse tree', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-1', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-1', 'Ada']]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
			{ id: 'copy-3', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));

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
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});

		const workRow = container.querySelector('[data-testid="library-work-work-1"]');
		expect(workRow?.textContent).not.toMatch(/\d+\/\d+/);
	});

	// ── Correction 5: an empty resolved name shows a placeholder, never a raw
	// hex entity id; the guard now applies to the inline checkout picker.
	it('member with empty resolved name shows a placeholder in the inline picker, never a raw 24-char hex entity ID', async () => {
		const hexId = '6a785fd523dc1d97bb8f1687';
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([[hexId, '']]));
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter' }]));
		listCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: hexId, personId: 'person-1', sectionIds: [] }
		]));

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-toggle-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			const options = container.querySelectorAll('[data-testid="inline-checkout-copy-1"] option');
			expect(options.length).toBeGreaterThan(1);
		});

		const memberSelect = container.querySelector('[data-testid="inline-checkout-copy-1"]');
		expect(memberSelect?.textContent).not.toMatch(/[0-9a-f]{24}/);
	});

	// ── Correction 8 / #129: a loan row shows the copy -> edition -> work chain, not a
	// bare copy name; resolveCopyNames keeps its own unit tests in libraryData.spec.ts.
	it('my-loans section shows the resolved copy -> edition -> work chain, not raw entity IDs', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-mine', copyId: 'copy-abc', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		findMyMemberIdMock.mockResolvedValue('member-mine');
		resolveCopyChainsMock.mockResolvedValue(
			new Map([['copy-abc', { copyNumber: 7, workName: 'Spem in alium', editionName: '40-part original' }]])
		);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});

		await fireEvent.click(container.querySelector('[data-testid="my-loans-toggle"]') as Element);

		await waitFor(() => {
			const item = container.querySelector('[data-testid="my-loans-item-lend-mine"]');
			expect(item).not.toBeNull();
			expect(item?.textContent).toContain('Copy #7 — Spem in alium / 40-part original');
			expect(item?.textContent).not.toContain('copy-abc');
		});
	});

	// ── #129 AC2: no copy number -> work/edition shown without the number ────
	it('when the copy has no number, the loan row shows work/edition context without a copy-number prefix', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-mine', copyId: 'copy-abc', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
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

	// ── #129 AC3: a librarian who is also the member holds the whole chain locally
	// (allCopies, allEditions, works), so the network resolver is never called.
	it('resolves the loan chain from already-loaded librarian data (allCopies/allEditions/works) without calling the network resolver', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		findMyMemberIdMock.mockResolvedValue('member-mine');
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: '', copyNumber: 3, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));

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

// #76 correction 9 → #207 rule 7: Entu sends full ISO timestamps; a lending date renders
// as the ISO calendar date, `YYYY-MM-DD`, and the time component never leaks.
describe('#76 correction 9 → #207 rule 7: lending dates render as the ISO calendar date, never a raw timestamp', () => {
	// Matches the time component of a raw ISO timestamp, e.g. "T00:00:00".
	const RAW_ISO_TIME = /T\d{2}:\d{2}/;

	it('a lent copy row shows a localized "since" date, never a raw ISO timestamp', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter' }]));
		listCopiesMock.mockResolvedValue(toListRead([{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });

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
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-mine', copyId: 'copy-abc', memberId: 'member-mine', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '2099-01-01T00:00:00.000Z', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
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
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		// member-a already holds copy-1 of edition-1 — full-ISO assignedAt as
		// live Entu delivers it.
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada']]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-a', personId: 'person-a', sectionIds: [] }
		]));

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
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01T00:00:00.000Z', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace'], ['member-b', 'Ben Jonson']]));
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter' }]));
		listCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]));
		signInLibraryReader({ myLibraryId: 'lib-1', chains: true });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: '40-part original', publisher: 'Baerenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] }
		]));

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

// (*MVOX:Tallis*)
