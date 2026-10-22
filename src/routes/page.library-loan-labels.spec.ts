// @vitest-environment happy-dom
// The library page: what each of my loans is called when a copy read fails or a part is missing.
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

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import {
	listLendingsMock,
	listWorksMock,
	loanCopiesRead,
	resolveBorrowerNamesMock,
	resolveLoanCopiesMock
} from '$lib/testing/mocks/library';
import { signInLibraryReader } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';
import type { LoanCopy } from '$lib/library/libraryData';

useLibraryPage();

const loan = (id: string, copyId: string) => ({
	id, copyId, memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: ''
});
const SPEM: LoanCopy = {
	name: 'Blue binder',
	chain: { copyNumber: 7, workName: 'Spem in alium', editionName: '40-part original' }
};

async function openMyLoans(loans: ReturnType<typeof loan>[]): Promise<HTMLElement> {
	listWorksMock.mockResolvedValue(toListRead([]));
	listLendingsMock.mockResolvedValue(toListRead(loans));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
	signInLibraryReader({ myLibraryId: 'lib-1' });
	findMyMemberIdMock.mockResolvedValue('member-mine');
	const { container } = render(Page);
	const toggle = await waitFor(() => {
		const el = container.querySelector('[data-testid="my-loans-toggle"]');
		expect(el).not.toBeNull();
		return el!;
	});
	await fireEvent.click(toggle);
	return container;
}

const labelOf = (container: HTMLElement, loanId: string) =>
	container.querySelector(`[data-testid="my-loans-item-${loanId}"] span`)?.textContent;

describe('#979 one unreadable copy does not blank the other loan labels', () => {
	it('the readable loan keeps its label, the unreadable one reads "Untitled copy", one report', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		resolveLoanCopiesMock.mockResolvedValue(
			loanCopiesRead([['copy-ok', SPEM]], [new Error('copy copy-gone lookup failed: 404')])
		);
		const container = await openMyLoans([loan('lend-ok', 'copy-ok'), loan('lend-gone', 'copy-gone')]);

		await waitFor(() => {
			expect(labelOf(container, 'lend-ok')).toBe('Copy no. 7 — Spem in alium / 40-part original');
		});
		expect(labelOf(container, 'lend-gone')).toBe('Untitled copy');
		const reports = error.mock.calls.filter(([what]) => String(what).includes('resolving the copy'));
		expect(reports).toHaveLength(1);
		error.mockRestore();
	});
});

describe('#981 a loan label never shows empty parts', () => {
	it('with the edition missing, the label is the copy name', async () => {
		resolveLoanCopiesMock.mockResolvedValue(loanCopiesRead([
			['copy-1', { name: 'Blue binder', chain: { copyNumber: 3, workName: '', editionName: '' } }]
		]));
		const container = await openMyLoans([loan('lend-1', 'copy-1')]);

		await waitFor(() => expect(labelOf(container, 'lend-1')).toBe('Blue binder'));
	});

	it('with the work missing and no name, the label is "Untitled copy"', async () => {
		resolveLoanCopiesMock.mockResolvedValue(loanCopiesRead([
			['copy-1', { name: '', chain: { copyNumber: 0, workName: '', editionName: 'Urtext' } }]
		]));
		const container = await openMyLoans([loan('lend-1', 'copy-1')]);

		// The unresolved label is "Untitled copy" too: let the answer land before reading it.
		await waitFor(() => expect(resolveLoanCopiesMock).toHaveBeenCalled());
		await new Promise((settle) => setTimeout(settle, 0));
		expect(labelOf(container, 'lend-1')).toBe('Untitled copy');
	});
});

// (*MVOX:Josquin*)
