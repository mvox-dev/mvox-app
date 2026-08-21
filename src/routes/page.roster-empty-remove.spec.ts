// @vitest-environment happy-dom
//
// #124 RED (F3) — EVERY empty section the /roster page shows must offer the
// remove control, consistently (integration: real page component, real
// groupBySection; only the fetch/write seams are mocked — same harness as
// page.roster-sections-ux.spec.ts, which pinned the remove control itself in
// TU.2/#110 finding #7).
//
// WHY (TU.6 gate walk, #114 check 4 → SPIKE root cause, 2026-08-12): Mihkel saw
// TWO "Bass (0)" headers — one with the ✕, one without. The tree is rendered
// UNFILTERED across all four test orgs ("the whole grouped tree arguably wants
// the same filter" — the page's own #110 F2 comment), while `canRemove` gates
// on `isOwnOrgSection`, so a FOREIGN org's empty section renders with a "(0)"
// but no control. Two headers that read identically must not disagree.
//
// The #110 review F2 ruling stands: a DESTRUCTIVE affordance on another org's
// entity must never ship. So consistency can only be restored one way — a
// section group another org owns must not be RENDERED on this collective's
// roster at all. These tests are deliberately fix-shaped-but-not-fix-specific:
// they assert the INVARIANT (every rendered empty leaf offers remove), which a
// tree filtered to the viewer's own org satisfies, and which showing foreign
// groups without their controls (current behavior) violates.
//
// SECOND-ORDER root cause, pinned here too: `currentOrgId` — the org that
// `isOwnOrgSection` compares against — is derived from the FIRST ROSTER ROW
// (`rows.find((r) => r.orgId)`), i.e. whoever sorts first alphabetically, NOT
// from the VIEWER. `loadRoster`'s member query is not org-scoped, so on a
// multi-org db the first row can belong to another org — and then the ✕
// migrates onto the FOREIGN org's sections while the viewer's own empty
// sections lose theirs. "Whose roster is this?" must be answered from the
// AUTHENTICATED person (resolveDatabaseEntityId, or her own row via personId) — the
// same never-guess rule createSection's org threading already follows.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadRosterMock,
	listSectionsMock,
	assignMock,
	unassignMock,
	createSectionMock,
	reorderMock,
	deleteMock,
	resolveDatabaseEntityIdMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createSectionMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createSectionMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock
}));
// The viewer's-own-org seam — mocked so EITHER legitimate derivation (a
// resolveDatabaseEntityId fetch, or reading the authenticated person's own roster row)
// lands on the same org in these tests.
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── live-shaped fixtures (real polyphony entity ids, 2026-08-12 probe) ──────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9';
const ORG_TAM = '69c7f8868489bfcb0e81b4f0';
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const EFK_ALTO = '69c7f8748489bfcb0e81b0cd';
const EFK_TENOR = '69c7f8758489bfcb0e81b113';
const EFK_BASS = '69c7f8768489bfcb0e81b163';
const TAM_BASS = '69c7f88a8489bfcb0e81b5bc';
const SIREEN_SOPRANO_II = '69c7f8798489bfcb0e81b207';

function node(id: string, name: string, displayOrder: number, orgId: string): SectionNode {
	return { id, name, displayOrder, parentId: null, orgId, depth: 0, children: [] };
}

/** The GATE-WALK shape: EFK's four voices (Bass EMPTY) plus another org's
 *  "Bass" (empty BY CONSTRUCTION — `rows` only ever holds this collective's
 *  members). Two "Bass (0)" headers, exactly what Mihkel saw. */
function gateWalkTree(): SectionNode[] {
	return [
		node(EFK_SOPRANO, 'Soprano', 1, ORG_EFK),
		node(EFK_ALTO, 'Alto', 4, ORG_EFK),
		node(EFK_TENOR, 'Tenor', 7, ORG_EFK),
		node(EFK_BASS, 'Bass', 15, ORG_EFK),
		node(TAM_BASS, 'Bass', 16, ORG_TAM)
	];
}

/** Fixture leaves only — every node above is childless, so any rendered group
 *  showing "(0)" is a removable-empty candidate. */

/** EFK members (the viewer's collective): Soprano/Alto/Tenor populated, Bass
 *  empty. The VIEWER (authenticated personId 'person-p') is Pete. */
function efkRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [EFK_SOPRANO],
			orgId: ORG_EFK
		},
		{
			memberId: 'm-bea',
			personId: 'p-bea',
			name: 'Bea Noe',
			email: '',
			sectionIds: [EFK_ALTO],
			orgId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [EFK_TENOR],
			orgId: ORG_EFK
		}
	];
}

const CFG_DB = 'polyphony';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [CFG_DB]: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: CFG_DB, name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(CFG_DB);
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(efkRows());
	listSectionsMock.mockResolvedValue(gateWalkTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createSectionMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

// #155/S4 — section management (remove included) moved EXCLUSIVELY into
// Arrange mode; `renderReady` now switches into it, and every id lookup below
// reads `arrange-row-<id>`/`section-remove-<id>` (still the SAME remove
// testid — only WHERE it renders moved, per #155/S4's design) rather than the
// retired `section-group-*`/`section-header-*` collapsed-view markup.
async function renderReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	const arrangeChip = container.querySelector<HTMLElement>(
		'[data-testid="roster-view-chip-arrange"]'
	);
	expect(arrangeChip, 'arrange chip').not.toBeNull();
	arrangeChip!.click();
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-arrange-list"]')).not.toBeNull();
	});
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Ids of every RENDERED arrange row, in the SAME org-filtered tree the
 *  collapsed/expanded views render from (`visibleSections`) — a foreign org's
 *  root never reaches this list at all (#124/F3), same guarantee the retired
 *  `section-group-*` scan relied on. */
function renderedSectionIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="arrange-row-"]')).map((el) =>
		el.getAttribute('data-testid')!.slice('arrange-row-'.length)
	);
}

// ── the gate repro: two "Bass (0)" rows must not disagree ────────────────────

describe('/roster — F3: every empty section the page SHOWS offers a WORKING (non-disabled) remove control', () => {
	it('gate repro — with EFK Bass (0) and another org\'s Bass (0) in the whole-db tree, every RENDERED "(0)" leaf row carries an ENABLED section-remove-<id>; never one-with-one-without', async () => {
		const container = await renderReady();

		// Sanity: the viewer's own empty section is on screen with a WORKING
		// control — the invariant below must not pass vacuously. #155/S4: the
		// button is now ALWAYS rendered (per-row, like indent/unindent) and
		// `disabled` when ineligible, rather than absent — "offers the remove
		// control" therefore means "renders enabled", not merely "exists".
		expect(q(container, 'arrange-row-' + EFK_BASS)?.textContent).toContain('(0)');
		expect((q(container, `section-remove-${EFK_BASS}`) as HTMLButtonElement).disabled).toBe(false);

		// THE INVARIANT (fix-agnostic): an arrange row the page chose to render
		// whose text reads "(0)" — every fixture node is a childless leaf — must
		// offer a WORKING remove control. Today the foreign org's "Bass (0)"
		// would render disabled/absent (canRemove's isOwnOrgSection gate) if it
		// rendered at all, which is exactly the on-screen inconsistency the gate
		// walk failed. A tree scoped to the viewer's own org satisfies this;
		// rendering foreign rows control-less does not.
		for (const id of renderedSectionIds(container)) {
			const row = q(container, `arrange-row-${id}`);
			if (!row?.textContent?.includes('(0)')) continue;
			const button = q(container, `section-remove-${id}`) as HTMLButtonElement | null;
			expect(
				button,
				`rendered empty section "${row.textContent.trim()}" (${id}) has no remove control — empty sections must not be inconsistent (#114 check 4)`
			).not.toBeNull();
			expect(
				button!.disabled,
				`rendered empty section "${row.textContent.trim()}" (${id}) has a DISABLED remove control — empty sections must not be inconsistent (#114 check 4)`
			).toBe(false);
		}
	});

	it("a foreign org's section must NEVER carry the destructive control (#110 review F2 stands) — so consistency means TAM's Bass is not rendered here at all", async () => {
		const container = await renderReady();

		// Whatever the page renders, the remove control on ANOTHER org's entity
		// is forbidden…
		expect(q(container, `section-remove-${TAM_BASS}`)).toBeNull();
		// …and therefore the only consistent presentation is to not show the
		// foreign row on this collective's roster in the first place.
		expect(q(container, `arrange-row-${TAM_BASS}`)).toBeNull();
	});
});

// ── second-order: "own org" comes from the VIEWER, not the first roster row ─────

describe("/roster — F3: the org that gates remove is the AUTHENTICATED VIEWER's, not whoever sorts first", () => {
	it("multi-org roster where a FOREIGN member sorts first alphabetically: the EFK viewer still gets a WORKING ✕ on EFK's empty Bass, and Sireen's empty section gets none rendered at all", async () => {
		// `loadRoster`'s member query is not org-scoped — on a multi-org db the
		// rows legitimately span orgs, sorted by name. Anna (Sireen) sorts
		// before every EFK member; the current `rows.find((r) => r.orgId)`
		// derivation therefore answers SIREEN and hangs the destructive control
		// on the wrong org's sections. The viewer is Pete (personId 'person-p',
		// EFK) — resolveDatabaseEntityId answers EFK, and so does his own roster row.
		loadRosterMock.mockResolvedValue([
			{
				memberId: 'm-anna',
				personId: 'p-anna',
				name: 'Anna Aaviksoo',
				email: 'anna@x.com',
				sectionIds: [],
				orgId: ORG_SIREEN
			},
			...efkRows()
		] satisfies RosterRow[]);
		listSectionsMock.mockResolvedValue([
			node(EFK_SOPRANO, 'Soprano', 1, ORG_EFK),
			node(EFK_BASS, 'Bass', 15, ORG_EFK),
			node(SIREEN_SOPRANO_II, 'Soprano II', 3, ORG_SIREEN)
		]);

		const container = await renderReady();

		// The viewer's own empty section keeps a WORKING control…
		expect(
			(q(container, `section-remove-${EFK_BASS}`) as HTMLButtonElement | null)?.disabled,
			"EFK viewer's own empty Bass lost its (enabled) remove control — own-org must derive from the viewer, not the first alphabetical row"
		).toBe(false);
		// …and the foreign org's section never even RENDERS as an arrange row
		// (`visibleSections`/`arrangeRows` org-filter, #124/F3) — so its remove
		// control cannot exist either.
		expect(
			q(container, `arrange-row-${SIREEN_SOPRANO_II}`),
			"the foreign org's section rendered as an arrange row at all — destructive affordance surface on a foreign entity (#110 review F2)"
		).toBeNull();
		expect(q(container, `section-remove-${SIREEN_SOPRANO_II}`)).toBeNull();
	});
});

// (*MVOX:Tallis* — #124 RED, F3: consistent empty-section remove + viewer-derived own org)
// (*MVOX:Palestrina* — #155/S4: remove control relocated into Arrange mode, always-rendered/disabled shape)
