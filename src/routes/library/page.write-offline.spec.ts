// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
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
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

const { createWorkMock, createEditionMock } = vi.hoisted(() => ({
	createWorkMock: vi.fn(),
	createEditionMock: vi.fn()
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createWork: createWorkMock,
	createEdition: createEditionMock
}));

vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);

import Page from './+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	isWriteDisabled,
	nonGetCalls,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import {
	bulkCheckoutMock,
	createLendingMock,
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveCopyChainsMock,
	resolveCopyNamesMock,
	resolveLibrarianMock,
	resolveMyLibraryIdMock,
	returnLendingMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';

function setAuthedWithOneCollective() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	resolveMyLibraryIdMock.mockResolvedValue('lib-1');
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
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
	resolveMyLibraryIdMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	createLendingMock.mockReset();
	returnLendingMock.mockReset();
	bulkCheckoutMock.mockReset();
	createWorkMock.mockReset();
	createEditionMock.mockReset();
	resetAppState();
});

const REASON = '[write_unavailable_no_signal]';

afterEach(() => {
	resetOnLine();
	vi.unstubAllGlobals();
});

function mockLibrarianTree() {
	listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
	listLendingsMock.mockResolvedValue(
		toListRead([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		])
	);
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map([
			['member-a', 'Ada Lovelace'],
			['member-b', 'Ben Jonson']
		])
	);
	listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]));
	listCopiesMock.mockResolvedValue(
		toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		])
	);
	setAuthedWithOneCollective();
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	listAllEditionsMock.mockResolvedValue(
		toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' }])
	);
	listAllCopiesMock.mockResolvedValue(
		toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
		])
	);
	listActiveMembersMock.mockResolvedValue(
		toListRead([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] }
		])
	);
	createLendingMock.mockResolvedValue(undefined);
	returnLendingMock.mockResolvedValue(undefined);
	bulkCheckoutMock.mockResolvedValue({ succeeded: [], failed: [] });
}

function q(container: Element, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderExpandedOnline() {
	await goOnline();
	const fetchStub = vi.fn(async () => new Response(JSON.stringify({ entities: [] }), { status: 200 }));
	vi.stubGlobal('fetch', fetchStub);
	mockLibrarianTree();
	const { container } = render(Page);

	await waitFor(() => expect(q(container, 'library-work-toggle-work-1')).not.toBeNull());
	await fireEvent.click(q(container, 'library-work-toggle-work-1') as Element);
	await waitFor(() => expect(q(container, 'library-edition-toggle-edition-1')).not.toBeNull());
	await fireEvent.click(q(container, 'library-edition-toggle-edition-1') as Element);
	await waitFor(() => {
		expect(q(container, 'inline-checkout-copy-1')).not.toBeNull();
		expect(q(container, 'library-return-copy-2')).not.toBeNull();
		expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
	});

	await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
		target: { value: 'edition-1' }
	});
	await waitFor(() => expect(q(container, 'bulk-checkout-member-list')).not.toBeNull());
	const box = container.querySelector(
		'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]:not([disabled])'
	) as HTMLInputElement;
	await fireEvent.click(box);
	await waitFor(() => {
		expect(isWriteDisabled(q(container, 'bulk-checkout-submit') as HTMLElement)).toBe(false);
		expect(isWriteDisabled(q(container, 'inline-checkout-copy-1') as HTMLElement)).toBe(false);
		expect(isWriteDisabled(q(container, 'library-return-copy-2') as HTMLElement)).toBe(false);
	});
	return { container, fetchStub };
}

const LENDING_CONTROLS = ['inline-checkout-copy-1', 'library-return-copy-2', 'bulk-checkout-submit'];

describe('/library — lending writes while offline (#434 slice 6)', () => {
	it('offline: checkout, return and bulk submit are disabled and the reason is visible', async () => {
		const { container } = await renderExpandedOnline();
		await goOffline();

		await waitFor(() => {
			for (const id of LENDING_CONTROLS) expect(isWriteDisabled(q(container, id) as HTMLElement), id).toBe(true);
		});
		expectVisibleReason(container, 'library-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="library-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: picking a member, Return and bulk submit write nothing and issue no fetch', async () => {
		const { container, fetchStub } = await renderExpandedOnline();
		await goOffline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await fireEvent.change(q(container, 'inline-checkout-copy-1') as HTMLSelectElement, {
			target: { value: 'member-b' }
		});
		await fireEvent.click(q(container, 'library-return-copy-2') as HTMLElement);
		await fireEvent.click(q(container, 'bulk-checkout-submit') as HTMLElement);
		await settle();

		expect(createLendingMock).not.toHaveBeenCalled();
		expect(returnLendingMock).not.toHaveBeenCalled();
		expect(bulkCheckoutMock).not.toHaveBeenCalled();
		expect(resolveMyLibraryIdMock).not.toHaveBeenCalled();
		expect(fetchStub.mock.calls.length).toBe(callsBefore);
		expect(nonGetCalls(fetchStub)).toEqual([]);
	});

	it('back online: enabled again, the reason gone, and Return writes', async () => {
		const { container } = await renderExpandedOnline();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			for (const id of LENDING_CONTROLS) expect(isWriteDisabled(q(container, id) as HTMLElement), id).toBe(false);
		});
		expect(q(container, 'library-write-unavailable')).toBeNull();
		await fireEvent.click(q(container, 'library-return-copy-2') as HTMLElement);
		await waitFor(() => expect(returnLendingMock).toHaveBeenCalledTimes(1));
		expect(returnLendingMock.mock.calls[0][1]).toBe('lend-1');
	});
});

describe('/library — no write control reaches the wire offline (#434 slice 6 fence)', () => {
	it('offline: operating every enabled control issues no non-GET', async () => {
		const { container, fetchStub } = await renderExpandedOnline();
		await goOffline();
		await settle();
		fetchStub.mockClear();
		createLendingMock.mockClear();
		returnLendingMock.mockClear();
		bulkCheckoutMock.mockClear();
		createWorkMock.mockClear();
		createEditionMock.mockClear();
		resolveMyLibraryIdMock.mockClear();

		const touched = await exerciseEveryEnabledControl(container, {
			skip: ['library-work-toggle-work-1', 'library-edition-toggle-edition-1']
		});

		expect(touched.length).toBeGreaterThan(5);
		expect(createLendingMock).not.toHaveBeenCalled();
		expect(returnLendingMock).not.toHaveBeenCalled();
		expect(bulkCheckoutMock).not.toHaveBeenCalled();
		expect(createWorkMock).not.toHaveBeenCalled();
		expect(createEditionMock).not.toHaveBeenCalled();
		expect(resolveMyLibraryIdMock).not.toHaveBeenCalled();
		expect(nonGetCalls(fetchStub)).toEqual([]);
	});

	it('offline: the tree\'s own create/attach controls are disabled too', async () => {
		const { container } = await renderExpandedOnline();
		await fireEvent.click(q(container, 'create-edition-button-work-1') as HTMLElement);
		await waitFor(() => expect(q(container, 'create-edition-submit-work-1')).not.toBeNull());
		await goOffline();

		await waitFor(() => {
			for (const testid of ['create-edition-submit-work-1', 'library-attach-file-edition-1']) {
				const el = q(container, testid);
				expect(el, testid).not.toBeNull();
				expect(isWriteDisabled(el!), testid).toBe(true);
			}
		});
	});
});

// (*MVOX:Tallis*)
