// @vitest-environment happy-dom
// #550: every library write with no token sends nothing and gets the 401 session-expired handling.
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

import Page from './+page.svelte';
import { clearAll } from '$lib/auth/storage';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { nonGetCalls, settle } from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import {
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
	resolveMyLibraryIdMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';

function stubWire() {
	const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
		const typeName = new URL(String(input)).searchParams.get('name.string');
		const body = typeName ? { entities: [{ _id: `type-${typeName}` }] } : { entities: [] };
		return new Response(JSON.stringify(body), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchStub);
	return fetchStub;
}

function mockLibrarianTree() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	resolveMyLibraryIdMock.mockResolvedValue('lib-1');
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
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
	const copies = [
		{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
		{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
	];
	listCopiesMock.mockResolvedValue(toListRead(copies));
	listAllEditionsMock.mockResolvedValue(
		toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' }])
	);
	listAllCopiesMock.mockResolvedValue(toListRead(copies));
	listActiveMembersMock.mockResolvedValue(
		toListRead([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] }
		])
	);
}

function q(container: Element, testid: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
	if (!el) throw new Error(`missing ${testid}`);
	return el;
}

async function renderExpandedThenLoseToken() {
	const fetchStub = stubWire();
	mockLibrarianTree();
	const { container } = render(Page);
	await waitFor(() => q(container, 'library-work-toggle-work-1'));
	await fireEvent.click(q(container, 'library-work-toggle-work-1'));
	await waitFor(() => q(container, 'library-edition-toggle-edition-1'));
	await fireEvent.click(q(container, 'library-edition-toggle-edition-1'));
	await waitFor(() => {
		q(container, 'inline-checkout-copy-1');
		q(container, 'library-return-copy-2');
		q(container, 'bulk-checkout-edition-select');
		q(container, 'library-attach-file-edition-1');
	});
	await settle();
	clearAll({ preserveProvider: false });
	fetchStub.mockClear();
	return { container, fetchStub };
}

async function expectSessionExpiredAndNothingSent(fetchStub: ReturnType<typeof stubWire>) {
	await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
	expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
	await settle();
	expect(nonGetCalls(fetchStub)).toEqual([]);
}

beforeEach(() => {
	install401Recovery();
	gotoMock.mockReset();
	resetTypeIdCache();
	history.replaceState({}, '', '/library');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetAppState();
	history.replaceState({}, '', '/');
});

describe('/library — a write with no token (#550)', () => {
	it('create work', async () => {
		const { container, fetchStub } = await renderExpandedThenLoseToken();
		await fireEvent.click(q(container, 'create-work-button'));
		await waitFor(() => q(container, 'create-work-name'));
		await fireEvent.input(q(container, 'create-work-name'), { target: { value: 'Ave verum' } });
		await fireEvent.click(q(container, 'create-work-submit'));
		await expectSessionExpiredAndNothingSent(fetchStub);
	});

	it('create edition', async () => {
		const { container, fetchStub } = await renderExpandedThenLoseToken();
		await fireEvent.click(q(container, 'create-edition-button-work-1'));
		await waitFor(() => q(container, 'create-edition-name-work-1'));
		await fireEvent.input(q(container, 'create-edition-name-work-1'), { target: { value: 'Novello' } });
		await fireEvent.click(q(container, 'create-edition-submit-work-1'));
		await expectSessionExpiredAndNothingSent(fetchStub);
	});

	it('attach files', async () => {
		const { container, fetchStub } = await renderExpandedThenLoseToken();
		const file = new File(['%PDF'], 'score.pdf', { type: 'application/pdf' });
		await fireEvent.change(q(container, 'library-attach-file-edition-1'), { target: { files: [file] } });
		await expectSessionExpiredAndNothingSent(fetchStub);
	});

	it('checkout', async () => {
		const { container, fetchStub } = await renderExpandedThenLoseToken();
		await fireEvent.change(q(container, 'inline-checkout-copy-1'), { target: { value: 'member-b' } });
		await expectSessionExpiredAndNothingSent(fetchStub);
	});

	it('return', async () => {
		const { container, fetchStub } = await renderExpandedThenLoseToken();
		await fireEvent.click(q(container, 'library-return-copy-2'));
		await expectSessionExpiredAndNothingSent(fetchStub);
	});

	it('bulk checkout', async () => {
		const { container, fetchStub } = await renderExpandedThenLoseToken();
		await fireEvent.change(q(container, 'bulk-checkout-edition-select'), { target: { value: 'edition-1' } });
		await waitFor(() => q(container, 'bulk-checkout-member-list'));
		const box = container.querySelector(
			'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]:not([disabled])'
		) as HTMLInputElement;
		await fireEvent.click(box);
		await fireEvent.click(q(container, 'bulk-checkout-submit'));
		await expectSessionExpiredAndNothingSent(fetchStub);
	});
});

// (*MVOX:Josquin*)
