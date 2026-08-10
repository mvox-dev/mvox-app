// @vitest-environment happy-dom
//
// #92 TR.4 RED — repertoire status badges on the library browse tree.
//
// The library browse page gains season-awareness: on load it resolves the
// CURRENT season (listSeasons + the pure currentSeason picker, same as the
// agenda page) and reads that season's repertoire ONCE via TR.2's
// listRepertoireItems. Each work row whose work id appears in the repertoire
// carries a badge:
//
//   ▸ Spem in alium — Tallis           ● active    (green dot + text)
//   ▸ Mass in B minor — Bach           ● learning  (amber dot + text)
//   ▸ Magnificat — Pärt                            (no badge — not in rep)
//
// Retired/dropped repertoire never badges a member's view (AC-8 discipline
// carried over from #90: those statuses are invisible to members everywhere).
//
// Pinned contract (mirrors the attendance badge in AgendaList.svelte — the
// one badge pattern this codebase already ships):
//   - [data-testid="repertoire-badge-{workId}"] on the badge element, INSIDE
//     the work row [data-testid="library-work-{workId}"];
//   - data-status="active" | "learning" on the badge;
//   - a decorative dot child: aria-hidden="true", class bg-green (active) /
//     bg-amber (learning);
//   - a visible text label besides the dot (never color-only — same a11y
//     ruling as #86's attendance badge).
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	// Proxy mock: assertions below pin structure (testids, data-status, call
	// arguments), never translated copy — any message key renders as [key].
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const {
	listWorksMock,
	listEditionsMock,
	listCopiesMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listLendingsMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock
} = vi.hoisted(() => ({
	listWorksMock: vi.fn(),
	listEditionsMock: vi.fn(),
	listCopiesMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listLendingsMock: vi.fn(),
	resolveBorrowerNamesMock: vi.fn(),
	resolveCopyNamesMock: vi.fn()
}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual, // keep the pure availability derivations real
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllEditions: listAllEditionsMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock,
		resolveCopyNames: resolveCopyNamesMock
	};
});
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// vi.importActual pulls entuFetch -> $lib/entu-config -> $env/dynamic/public,
// unavailable outside a SvelteKit request context under happy-dom. Same
// one-line fix as page.library.spec.ts.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

const { resolveLibrarianMock } = vi.hoisted(() => ({ resolveLibrarianMock: vi.fn() }));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>('$lib/library/librarianStore');
	return {
		...actual, // keep the real writable store + resetLibrarian
		resolveLibrarian: resolveLibrarianMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

vi.mock('$lib/library/lendingActions', () => ({
	createLending: vi.fn(),
	returnLending: vi.fn(),
	bulkCheckout: vi.fn()
}));

// ── the two NEW seams this slice wires in ──────────────────────────────────
// Season read: the page resolves the current season the same way the agenda
// does — listSeasons, then the pure currentSeason picker (kept REAL: it is
// unit-covered in conductorLogic and pinning its internals here would
// over-specify).
const { listSeasonsMock } = vi.hoisted(() => ({ listSeasonsMock: vi.fn() }));
vi.mock('$lib/seasons/entuSeasons', async () => {
	const actual = await vi.importActual<typeof import('$lib/seasons/entuSeasons')>('$lib/seasons/entuSeasons');
	return {
		...actual, // keep resolveTypeId etc. + the EntuCfg type surface
		listSeasons: listSeasonsMock
	};
});
// Repertoire read: TR.2's data layer, reused — never re-derived.
const { listRepertoireItemsMock } = vi.hoisted(() => ({ listRepertoireItemsMock: vi.fn() }));
vi.mock('$lib/repertoire/repertoireData', async () => {
	const actual = await vi.importActual<typeof import('$lib/repertoire/repertoireData')>('$lib/repertoire/repertoireData');
	return {
		...actual,
		listRepertoireItems: listRepertoireItemsMock
	};
});

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

// Two seasons, both started — the CURRENT one is the latest-started (the pure
// currentSeason rule). Querying repertoire for 'season-old' must fail test 1.
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

// Five works in the library; four have a repertoire_item in the current
// season, one (Magnificat) has none.
const WORKS = [
	{ id: 'work-active', name: 'Spem in alium', composer: 'Thomas Tallis' },
	{ id: 'work-learning', name: 'Mass in B minor', composer: 'J.S. Bach' },
	{ id: 'work-none', name: 'Magnificat', composer: 'Arvo Pärt' },
	{ id: 'work-retired', name: 'Locus iste', composer: 'Anton Bruckner' },
	{ id: 'work-dropped', name: 'Os justi', composer: 'Anton Bruckner' }
];

// listRepertoireItems (TR.2) returns ALL statuses — the member-facing filter
// is the page's job. RepertoireItem shape from repertoireData.ts.
const REPERTOIRE_ITEMS = [
	{ id: 'rep-1', workId: 'work-active', editionId: '', status: 'active', name: 'Spem in alium' },
	{ id: 'rep-2', workId: 'work-learning', editionId: '', status: 'learning', name: 'Mass in B minor' },
	{ id: 'rep-3', workId: 'work-retired', editionId: '', status: 'retired', name: 'Locus iste' },
	{ id: 'rep-4', workId: 'work-dropped', editionId: '', status: 'dropped', name: 'Os justi' }
];

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	// Member view throughout — badges are a MEMBER surface (test 4 is exactly
	// about what members must NOT see).
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue([]);
	listAllCopiesMock.mockResolvedValue([]);
	listActiveMembersMock.mockResolvedValue([]);
}

function mockHappyPath() {
	listWorksMock.mockResolvedValue(WORKS);
	listLendingsMock.mockResolvedValue([]);
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#92 TR.4 — library browse tree repertoire badges', () => {
	// ── 1. season-scoped repertoire query on load ─────────────────────────────
	it('queries the CURRENT season repertoire once on load — listRepertoireItems(cfg, currentSeasonId)', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		await renderReady();

		await waitFor(() => {
			expect(listRepertoireItemsMock).toHaveBeenCalledTimes(1);
		});
		const [cfg, seasonId] = listRepertoireItemsMock.mock.calls[0];
		// The CURRENT season (latest-started), never the old one.
		expect(seasonId).toBe('season-current');
		// The selected collective's cfg, full-shape (not objectContaining — the
		// partial-assertion lesson from #76).
		expect(cfg).toEqual({ db: 'polyphony', token: 'jwt-abc' });
	});

	// ── 2. active + learning badges with correct status ───────────────────────
	it('a work in the repertoire shows a badge with its status: active = green dot, learning = amber dot', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		const container = await renderReady();

		// active — badge lives INSIDE the work row, carries data-status.
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
		// Green dot, decorative (hidden from AT — the text label carries the
		// meaning, same a11y ruling as the #86 attendance badge).
		const activeDot = activeBadge.querySelector('[aria-hidden="true"]') as HTMLElement | null;
		expect(activeDot).not.toBeNull();
		expect(activeDot!.className).toContain('bg-green');
		// Never color-only: a visible text label besides the dot.
		expect((activeBadge.textContent ?? '').trim()).not.toBe('');

		// learning — same shape, amber dot.
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

	// ── 3. no badge for works outside the repertoire ──────────────────────────
	it('a work NOT in the current season repertoire shows no badge', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		const container = await renderReady();

		// Settle: the badged rows exist first, so the absence below is a real
		// verdict, not a not-yet-rendered race.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="repertoire-badge-work-active"]')).not.toBeNull();
		});

		// Magnificat is in the library but in no repertoire — row yes, badge no.
		const row = container.querySelector('[data-testid="library-work-work-none"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain('Magnificat');
		expect(container.querySelector('[data-testid="repertoire-badge-work-none"]')).toBeNull();
	});

	// ── 4. retired/dropped are invisible to members ───────────────────────────
	it('retired and dropped repertoire works show NO badge to a member (AC-8 carried over)', async () => {
		mockHappyPath();
		setAuthedWithOneCollective();

		const container = await renderReady();

		// Settle on the badged rows first (same race guard as test 3).
		await waitFor(() => {
			expect(container.querySelector('[data-testid="repertoire-badge-work-active"]')).not.toBeNull();
		});

		// Both rows render — the WORKS stay browsable in the library...
		expect(container.querySelector('[data-testid="library-work-work-retired"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="library-work-work-dropped"]')).not.toBeNull();
		// ...but neither carries a repertoire badge, in ANY status.
		expect(container.querySelector('[data-testid="repertoire-badge-work-retired"]')).toBeNull();
		expect(container.querySelector('[data-testid="repertoire-badge-work-dropped"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
