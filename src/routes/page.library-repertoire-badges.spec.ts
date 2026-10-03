// @vitest-environment happy-dom
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);

vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule({ chains: false })
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

vi.mock('$lib/seasons/entuSeasons', async () =>
	(await import('$lib/testing/mocks/seasons')).entuSeasonsModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireOverRealModule()
);

import Page from './library/+page.svelte';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { listRepertoireItemsMock, listSeasonsMock } from '$lib/testing/mocks/seasons';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock
} from '$lib/testing/mocks/library';

const SEASONS = [
	{
		id: 'season-old',
		name: '2024/25',
		startDate: '2024-09-01',
		endDate: '2025-06-30',
		conductors: [],
		owners: [],
		editors: []
	},
	{
		id: 'season-current',
		name: '2025/26',
		startDate: '2025-09-01',
		endDate: '2026-08-31',
		conductors: [],
		owners: [],
		editors: []
	}
];

const WORKS = [
	{ id: 'work-active', name: 'Spem in alium', composer: 'Thomas Tallis' },
	{ id: 'work-learning', name: 'Mass in B minor', composer: 'J.S. Bach' },
	{ id: 'work-none', name: 'Magnificat', composer: 'Arvo Pärt' },
	{ id: 'work-retired', name: 'Locus iste', composer: 'Anton Bruckner' },
	{ id: 'work-dropped', name: 'Os justi', composer: 'Anton Bruckner' }
];

const REPERTOIRE_ITEMS = [
	{ id: 'rep-1', workId: 'work-active', editionId: '', status: 'active', name: 'Spem in alium' },
	{ id: 'rep-2', workId: 'work-learning', editionId: '', status: 'learning', name: 'Mass in B minor' },
	{ id: 'rep-3', workId: 'work-retired', editionId: '', status: 'retired', name: 'Locus iste' },
	{ id: 'rep-4', workId: 'work-dropped', editionId: '', status: 'dropped', name: 'Os justi' }
];

function setAuthedWithOneCollective() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
}

function mockHappyPath() {
	listWorksMock.mockResolvedValue(toListRead(WORKS));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
	listSeasonsMock.mockResolvedValue(SEASONS);
	listRepertoireItemsMock.mockResolvedValue(REPERTOIRE_ITEMS);
}

async function renderReady() {
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="library-work-list"]')).not.toBeNull();
	});
	return container;
}

afterEach(() => {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveCopyNamesMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listActiveMembersMock.mockReset();
	listSeasonsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	resetAppState();
});

describe('#92 TR.4 — library browse tree repertoire badges', () => {
	it('queries the CURRENT season repertoire once on load — listRepertoireItems(cfg, currentSeasonId)', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		await renderReady();

		await waitFor(() => {
			expect(listRepertoireItemsMock).toHaveBeenCalledTimes(1);
		});
		const [cfg, seasonId] = listRepertoireItemsMock.mock.calls[0];
		expect(seasonId).toBe('season-current');
		expect(cfg).toEqual({ db: 'sampledb', token: 'jwt-abc' });
	});

	it('a work in the repertoire shows a badge with its status: active = green dot, learning = amber dot', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		const container = await renderReady();

		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="library-work-work-active"] [data-testid="repertoire-badge-work-active"]'
				)
			).not.toBeNull();
		});
		const activeBadge = container.querySelector(
			'[data-testid="repertoire-badge-work-active"]'
		) as HTMLElement;
		expect(activeBadge.getAttribute('data-status')).toBe('active');
		const activeDot = activeBadge.querySelector('[aria-hidden="true"]') as HTMLElement | null;
		expect(activeDot).not.toBeNull();
		expect(activeDot!.className).toContain('bg-green');
		expect((activeBadge.textContent ?? '').trim()).not.toBe('');

		const learningBadge = container.querySelector(
			'[data-testid="library-work-work-learning"] [data-testid="repertoire-badge-work-learning"]'
		) as HTMLElement;
		expect(learningBadge).not.toBeNull();
		expect(learningBadge.getAttribute('data-status')).toBe('learning');
		const learningDot = learningBadge.querySelector('[aria-hidden="true"]') as HTMLElement | null;
		expect(learningDot).not.toBeNull();
		expect(learningDot!.className).toContain('bg-amber');
		expect((learningBadge.textContent ?? '').trim()).not.toBe('');
	});

	it('a work NOT in the current season repertoire shows no badge', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		const container = await renderReady();

		await waitFor(() => {
			expect(container.querySelector('[data-testid="repertoire-badge-work-active"]')).not.toBeNull();
		});

		const row = container.querySelector('[data-testid="library-work-work-none"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain('Magnificat');
		expect(container.querySelector('[data-testid="repertoire-badge-work-none"]')).toBeNull();
	});

	it('retired and dropped repertoire works show NO badge to a member (AC-8 carried over)', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		const container = await renderReady();

		await waitFor(() => {
			expect(container.querySelector('[data-testid="repertoire-badge-work-active"]')).not.toBeNull();
		});

		expect(container.querySelector('[data-testid="library-work-work-retired"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="library-work-work-dropped"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="repertoire-badge-work-retired"]')).toBeNull();
		expect(container.querySelector('[data-testid="repertoire-badge-work-dropped"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
