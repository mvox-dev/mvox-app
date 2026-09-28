// @vitest-environment happy-dom
//
// #434 slice 6/6 RED (library integration) — the librarian's lending writes
// are gated while offline, on the REAL /library page (harness:
// src/routes/page.library.spec.ts — reads module-mocked, lendingActions
// module-mocked with named handles, global fetch spied so a stray write is
// visible too).
//
// CONTRACT — a librarian, the tree expanded to copies; the signal
// ($lib/net/online) goes offline:
//   • inline-checkout-{copyId} (the per-copy member select), library-return-
//     {copyId} and bulk-checkout-submit are disabled;
//   • ONE visible sentence [data-testid="library-write-unavailable"] =
//     m.write_unavailable_no_signal() is on the page;
//   • picking a member / clicking Return / clicking bulk submit calls none of
//     createLending / returnLending / bulkCheckout and issues no fetch;
//   • back online: enabled again, the sentence gone, a Return writes.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const { listWorksMock, listEditionsMock, listCopiesMock, listAllEditionsMock, listAllCopiesMock, listLendingsMock, resolveBorrowerNamesMock, resolveCopyNamesMock, resolveCopyChainsMock } =
	vi.hoisted(() => ({
		listWorksMock: vi.fn(),
		listEditionsMock: vi.fn(),
		listCopiesMock: vi.fn(),
		listAllEditionsMock: vi.fn(),
		listAllCopiesMock: vi.fn(),
		listLendingsMock: vi.fn(),
		resolveBorrowerNamesMock: vi.fn(),
		resolveCopyNamesMock: vi.fn(),
		// #129 — loan → copy → edition → work chain resolver (network fallback
		// when the chain isn't already available from locally-loaded data).
		resolveCopyChainsMock: vi.fn()
	}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual, // keep the real, pure deriveCopyAvailability / deriveWorkAvailability / formatLoanChainLabel
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllEditions: listAllEditionsMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock,
		resolveCopyNames: resolveCopyNamesMock,
		resolveCopyChains: resolveCopyChainsMock
	};
});
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// vi.importActual for $lib/library/libraryData (kept above, to preserve the real
// deriveCopyAvailability) pulls entuFetch -> $lib/entu-config, which reads
// $env/dynamic/public — unavailable outside a SvelteKit request context under
// happy-dom. Same fix as page.profile.spec.ts.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

// #434 slice 4 review round 2, finding 2 — the write paths no longer read the
// library id off a store the (cache-backed) librarian resolution filled: they
// resolve it LIVE through `resolveMyLibraryId`, so it is mocked here too.
const { resolveLibrarianMock, resolveMyLibraryIdMock } = vi.hoisted(() => ({
	resolveLibrarianMock: vi.fn(),
	resolveMyLibraryIdMock: vi.fn()
}));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>('$lib/library/librarianStore');
	return {
		...actual, // keep the real writable store + resetLibrarian
		resolveLibrarian: resolveLibrarianMock,
		resolveMyLibraryId: resolveMyLibraryIdMock
	};
});

// T6.4/#73 — "my loans" resolves the viewer's own active member the same way
// RSVP already does (rsvpData.ts's findMyMemberId: person + status=active, no
// org scoping in the single-collective dev/test db). Reused, not re-derived.
const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

// #74 — mock lendingActions to verify submit triggers the action layer
const { createLendingMock, returnLendingMock, bulkCheckoutMock } = vi.hoisted(() => ({
	createLendingMock: vi.fn(),
	returnLendingMock: vi.fn(),
	bulkCheckoutMock: vi.fn()
}));
vi.mock('$lib/library/lendingActions', () => ({
	createLending: createLendingMock,
	returnLending: returnLendingMock,
	bulkCheckout: bulkCheckoutMock
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	isWriteDisabled,
	nonGetCalls
} from '$lib/testing/networkSignal';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { sampledb: 'person-p' }, expMs: Date.now() + 100_000 });
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
	// Default: not-librarian, unless a test overrides resolveLibrarianMock afterward.
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	// #434 slice 4 review round 2, finding 2 — the LIVE write-path resolution
	// every checkout/create now makes for its own `_parent`.
	resolveMyLibraryIdMock.mockResolvedValue('lib-1');
	// Default: no active membership, unless a test overrides findMyMemberIdMock afterward.
	findMyMemberIdMock.mockResolvedValue(null);
	// Default: empty copy names, unless a test overrides.
	resolveCopyNamesMock.mockResolvedValue(new Map());
	// Default: empty loan chains, unless a test overrides. (#129)
	resolveCopyChainsMock.mockResolvedValue(new Map());
	// Default: empty checkout data, unless a test overrides.
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});


const REASON = '[write_unavailable_no_signal]';

afterEach(() => {
	resetOnLine();
	vi.unstubAllGlobals();
});

/** work-1 → edition-1 → copy-1 (available) + copy-2 (out to member-a). */
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

	// Bulk: an edition and a member picked, so submit is enabled on its own terms.
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

// (*MVOX:Tallis* — #434 slice 6 RED)
