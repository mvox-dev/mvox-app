// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
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
import { signIn } from '$lib/testing/session';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveCopyChainsMock,
	resolveCopyNamesMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import { cleanupClearReset } from '$lib/testing/pages/library';

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

afterEach(cleanupClearReset);

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
