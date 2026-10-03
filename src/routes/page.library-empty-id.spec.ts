// @vitest-environment happy-dom
// The /library route never composes an empty entity path from a damaged lending row.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		library_title: () => 'Library',
		library_no_collective: () => 'Select a collective to view the library.',
		library_load_error: () => 'Something went wrong loading the library.',
		library_retry: () => 'Retry',
		library_empty: () => 'Nothing in the library yet.',
		library_work_composer_unknown: () => 'Unknown composer',
		library_editions_empty: () => 'No editions yet.',
		library_edition_publisher_unknown: () => 'Unknown publisher',
		library_copies_empty: () => 'No copies yet.',
		library_copy_available: () => 'Available',
		library_copy_lent_to: (p: { name: string }) => `Out — ${p.name}`,
		library_borrower_unknown: () => 'an unnamed member',
		library_copy_name_unknown: () => 'Untitled copy',
		library_lent_since: (p: { date: string }) => `since ${p.date}`,
		library_node_load_error: () => 'Could not load.',
		library_node_retry: () => 'Retry',
		library_librarian_tools: () => 'Librarian tools',
		library_create_work_button: () => 'Add work',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_error: () => 'Could not create the work.',
		library_librarian_load_error: () => 'Could not check librarian access.',
		library_librarian_retry: () => 'Retry',
		library_my_loans_title: (p: { count: number }) => `My loans (${p.count})`,
		library_my_loans_copy_label: (p: { copyName: string }) => `${p.copyName}`,
		library_my_loans_overdue: () => 'Overdue',
		library_checkout_submit: () => 'Checkout',
		library_return: () => 'Return',
		library_bulk_checkout_title: () => 'Bulk checkout',
		library_bulk_checkout_edition_placeholder: () => 'Select edition',
		library_bulk_checkout_work_placeholder: () => 'Select work',
		library_bulk_checkout_availability: (p: { available: number; total: number }) => `${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_work_availability: (p: { available: number; total: number }) => `${p.available}/${p.total}`,
		library_inline_checkout_placeholder: () => 'Select member',
		library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_inline_checkout_error: () => 'Checkout failed',
		library_copy_sort_label: () => 'Sort copies by',
		library_copy_sort_nr: () => 'Nr',
		library_copy_sort_member: () => 'Member',
		library_copy_sort_since: () => 'Since',
		library_available_summary: (p: { count: number }) => `${p.count} copies available for lending`
	}
}));

vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

const { resolveLibrarianMock } = vi.hoisted(() => ({ resolveLibrarianMock: vi.fn() }));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>('$lib/library/librarianStore');
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

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

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const EMPTY_ID_ENTITY_URL = /\/entity\/(\?|$)/;

function installFetchStub(lendingEntities: unknown[]) {
	const stub = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('_type.string=work'))
			return json({
				entities: [{ _id: 'work-1', name: [{ string: 'Spem in alium' }], composer: [{ string: 'Thomas Tallis' }] }]
			});
		if (url.includes('_type.string=lending')) return json({ entities: lendingEntities });
		if (url.includes('_type.string=profile')) return json({ entities: [] });
		if (EMPTY_ID_ENTITY_URL.test(url)) return json({ entities: [] }); // the LIST-route trap
		if (url.includes('/entity/'))
			return json({
				entity: {
					name: [{ string: 'Resolved name' }],
					copy_number: [{ number: 3 }],
					person: [{ reference: 'person-good' }],
					_parent: [{ reference: 'edition-1', entity_type: 'edition' }]
				}
			});
		return json({ entities: [] }); // seasons, database-entity resolution, etc.
	});
	vi.stubGlobal('fetch', stub);
	return stub;
}

function setAuthedWithOneCollective() {
	signIn({ selected: 'sampledb' });
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	listActiveMembersMock.mockResolvedValue(toListRead([]));
}

function terminalState(container: HTMLElement): Element | null {
	return (
		container.querySelector('[data-testid="library-work-list"]') ??
		container.querySelector('[data-testid="library-empty"]') ??
		container.querySelector('[data-testid="library-load-error"]')
	);
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	listActiveMembersMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	createLendingMock.mockReset();
	returnLendingMock.mockReset();
	bulkCheckoutMock.mockReset();
	resetAppState();
});

describe('/library integration — a malformed lending row never reaches the wire with an empty id (#258)', () => {
	it('initial load with a lending row missing its MEMBER reference: no empty-id entity request; honest terminal state', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const stub = installFetchStub([
			{
				_id: 'lending-good',
				copy: [{ reference: 'copy-1' }],
				member: [{ reference: 'member-good' }],
				assigned_at: [{ date: '2026-07-01' }],
				assigned_until: [{ date: '2026-08-01' }]
			},
			{
				_id: 'lending-bad',
				copy: [{ reference: 'copy-2' }],
				assigned_at: [{ date: '2026-07-02' }]
			}
		]);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => expect(terminalState(container)).not.toBeNull());
		await new Promise((r) => setTimeout(r, 50));

		const urls = stub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=work'))).toBe(true);
		expect(urls.some((u) => u.includes('_type.string=lending'))).toBe(true);
		expect(urls.filter((u) => EMPTY_ID_ENTITY_URL.test(u))).toEqual([]);
		errSpy.mockRestore();
	});

	it('a my-loan row missing its COPY reference: no empty-id entity request; never a silently blank "Untitled copy" loan', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const stub = installFetchStub([
			{
				_id: 'lending-bad',
				member: [{ reference: 'member-me' }],
				assigned_at: [{ date: '2026-07-01' }],
				assigned_until: [{ date: '2026-08-01' }]
			}
		]);
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-me');

		const { container } = render(Page);
		await waitFor(() => expect(terminalState(container)).not.toBeNull());
		await new Promise((r) => setTimeout(r, 50));

		const urls = stub.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => EMPTY_ID_ENTITY_URL.test(u))).toEqual([]);

		const loadError = container.querySelector('[data-testid="library-load-error"]');
		const myLoans = container.querySelector('[data-testid="my-loans"]');
		expect(loadError !== null || myLoans === null).toBe(true);
		errSpy.mockRestore();
	});
});

// (*MVOX:Tallis*)
