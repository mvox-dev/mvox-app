// @vitest-environment happy-dom
// My loans: which changes read my loaned copies again, and what the labels show meanwhile.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lending, LoanCopy, SettledReads } from '$lib/library/libraryData';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const loadMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/library/libraryPageData', () => ({ loadMyLoanCopies: loadMock }));

import MyLoansSection from './MyLoansSection.svelte';
import { authStore } from '$lib/auth/session';
import { clearAll } from '$lib/auth/storage';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const loan = (id: string, copyId: string, memberId = 'me'): Lending => ({
	id, copyId, memberId, assignedAt: '2026-10-01', assignedUntil: '', returnedAt: ''
});
const named = (name: string): LoanCopy => ({ name, chain: { copyNumber: 1, workName: '', editionName: '' } });
const LABELS: Record<string, string> = { c1: 'Blue binder', c2: 'Red binder' };

function answer(ids: string[]): SettledReads<LoanCopy> {
	return { resolved: new Map(ids.map((id) => [id, named(LABELS[id])])), failed: [] };
}

const props = (lendings: Lending[], db = 'db-a') => ({
	selected: { db },
	lendings,
	myMemberId: 'me',
	works: [],
	allCopies: [],
	allEditions: []
});

async function open(lendings: Lending[]) {
	const view = render(MyLoansSection, props(lendings));
	await fireEvent.click(view.getByTestId('my-loans-toggle'));
	return view;
}

const labelOf = (container: HTMLElement, loanId: string) =>
	container.querySelector(`[data-testid="my-loans-item-${loanId}"] span`)?.textContent;
const readIds = () => loadMock.mock.calls.map(([, ids]) => ids as string[]);
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
	loadMock.mockReset();
	loadMock.mockImplementation(async (_cfg: unknown, ids: string[]) => answer(ids));
	signIn({ selected: 'db-a' });
});
afterEach(() => {
	cleanup();
	resetAppState();
});

describe('#984 only a change to my loans reads my copies again', () => {
	it('another member’s loan change reads nothing; a new loan of mine reads only that copy', async () => {
		const mine = loan('l1', 'c1');
		const { container, rerender } = await open([mine]);
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Blue binder'));

		await rerender(props([mine, loan('l9', 'c9', 'someone-else')]));
		await settle();
		expect(readIds()).toEqual([['c1']]);

		await rerender(props([mine, loan('l2', 'c2')]));
		await waitFor(() => expect(labelOf(container, 'l2')).toBe('Red binder'));
		expect(readIds()).toEqual([['c1'], ['c2']]);
		expect(labelOf(container, 'l1')).toBe('Blue binder');
	});

	it('another member’s loan change while my read is out does not drop and repeat it', async () => {
		let land!: () => void;
		loadMock.mockImplementationOnce(
			(_cfg: unknown, ids: string[]) => new Promise((done) => (land = () => done(answer(ids))))
		);
		const mine = loan('l1', 'c1');
		const { container, rerender } = await open([mine]);
		await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(1));

		await rerender(props([mine, loan('l9', 'c9', 'someone-else')]));
		land();
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Blue binder'));
		expect(readIds()).toEqual([['c1']]);
	});

	it('librarian copies arriving later read nothing already answered', async () => {
		const loans = [loan('l1', 'c1'), loan('l2', 'c2'), loan('l3', 'c3')];
		loadMock.mockImplementationOnce(async () => answer(['c1', 'c2']));
		const { container, rerender } = await open(loans);
		await waitFor(() => expect(labelOf(container, 'l2')).toBe('Red binder'));

		const held = { id: 'c1', name: 'Held binder', copyNumber: 1, editionId: '' };
		await rerender({ ...props(loans), allCopies: [held] });
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Held binder'));
		expect(readIds()).toEqual([['c1', 'c2', 'c3'], ['c3']]);
	});
});

describe('#978 signed out, the labels go; signed in again, they come back', () => {
	it('a sign-out clears the labels, and a token arriving later fills them', async () => {
		const mine = loan('l1', 'c1');
		const { container } = await open([mine]);
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Blue binder'));

		clearAll({ preserveProvider: false });
		authStore.set({ status: 'anonymous' });
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Untitled copy'));

		signIn({ selected: 'db-a' });
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Blue binder'));
	});

	it('with no token at first, nothing is read until one arrives', async () => {
		clearAll({ preserveProvider: false });
		authStore.set({ status: 'anonymous' });
		const { container } = await open([loan('l1', 'c1')]);
		await settle();
		expect(loadMock).not.toHaveBeenCalled();
		expect(labelOf(container, 'l1')).toBe('Untitled copy');

		signIn({ selected: 'db-a' });
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Blue binder'));
	});

	it('a collective switch shows no label of the old collective while the new read is out', async () => {
		const { container, rerender } = await open([loan('l1', 'c1')]);
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Blue binder'));

		let land!: () => void;
		const other = { resolved: new Map([['c1', named('Green binder')]]), failed: [] };
		loadMock.mockImplementationOnce(() => new Promise((done) => (land = () => done(other))));
		await rerender(props([loan('l1', 'c1')], 'db-b'));
		await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(2));
		expect(labelOf(container, 'l1')).toBe('Untitled copy');

		land();
		await waitFor(() => expect(labelOf(container, 'l1')).toBe('Green binder'));
		expect(loadMock.mock.calls[1][0]).toMatchObject({ db: 'db-b' });
	});
});

// (*MVOX:Josquin*)
