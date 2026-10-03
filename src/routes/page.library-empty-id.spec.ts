// @vitest-environment happy-dom
// The /library route never composes an empty entity path from a damaged lending row.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
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
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import { bulkCheckoutMock, createLendingMock, returnLendingMock } from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';

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
