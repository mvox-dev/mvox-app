// @vitest-environment happy-dom
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

const {
	listWorksMock,
	listEditionsMock,
	listCopiesMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listLendingsMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock,
	resolveCopyChainsMock
} = vi.hoisted(() => ({
	listWorksMock: vi.fn(),
	listEditionsMock: vi.fn(),
	listCopiesMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listLendingsMock: vi.fn(),
	resolveBorrowerNamesMock: vi.fn(),
	resolveCopyNamesMock: vi.fn(),
	resolveCopyChainsMock: vi.fn()
}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>(
		'$lib/library/libraryData'
	);
	return {
		...actual,
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

const { resolveLibrarianMock } = vi.hoisted(() => ({ resolveLibrarianMock: vi.fn() }));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>(
		'$lib/library/librarianStore'
	);
	return { ...actual, resolveLibrarian: resolveLibrarianMock };
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

vi.mock('$lib/library/lendingActions', () => ({
	createLending: vi.fn(),
	returnLending: vi.fn(),
	bulkCheckout: vi.fn()
}));

import Page from './library/+page.svelte';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function setAuthedLibrarian() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
	listLendingsMock.mockResolvedValue(toListRead([]));
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
});

describe('/library — bulk-checkout work picker shows composer (#204)', () => {
	it('work-select option labels read "Name - Composer"; empty composer → name only, no dangling " - "', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Silmavalgus', composer: 'P. Uusberg' },
			{ id: 'work-2', name: 'Anonymous chant', composer: '' }
		]));
		setAuthedLibrarian();

		const { container } = render(Page);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="bulk-checkout-work-select"]')
			).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="bulk-checkout-work-select"]'
		) as HTMLSelectElement;
		const labels = [...select.querySelectorAll('option')]
			.filter((o) => (o as HTMLOptionElement).value !== '')
			.map((o) => (o.textContent ?? '').trim());

		expect(labels).toEqual(['Silmavalgus - P. Uusberg', 'Anonymous chant']);
	});
});

// (*MVOX:Tallis* — #204 RED)
