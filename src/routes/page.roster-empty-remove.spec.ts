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
// AUTHENTICATED person (resolveMyOrgId, or her own row via personId) — the
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
	resolveMyOrgIdMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createSectionMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	resolveMyOrgIdMock: vi.fn()
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
// resolveMyOrgId fetch, or reading the authenticated person's own roster row)
// lands on the same org in these tests.
vi.mock('$lib/org/myOrg', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/org/myOrg')>();
	return { ...actual, resolveMyOrgId: resolveMyOrgIdMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
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
	resolveMyOrgIdMock.mockResolvedValue(ORG_EFK);
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
	resolveMyOrgIdMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

async function renderReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Ids of every RENDERED section group (headers render collapsed or not),
 *  excluding the Unassigned pseudo-group. */
function renderedSectionIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="section-group-"]'))
		.map((el) => el.getAttribute('data-testid')!.slice('section-group-'.length))
		.filter((id) => id !== 'unassigned');
}

// ── the gate repro: two "Bass (0)" headers must not disagree ────────────────────

describe('/roster — F3: every empty section the page SHOWS offers the remove control', () => {
	it('gate repro — with EFK Bass (0) and another org\'s Bass (0) in the whole-db tree, every RENDERED "(0)" leaf group carries section-remove-<id>; never one-with-one-without', async () => {
		const container = await renderReady();

		// Sanity: the viewer's own empty section is on screen with its control —
		// the invariant below must not pass vacuously.
		expect(q(container, `section-header-${EFK_BASS}`)?.textContent).toContain('(0)');
		expect(q(container, `section-remove-${EFK_BASS}`)).not.toBeNull();

		// THE INVARIANT (fix-agnostic): a section group the page chose to render
		// whose header reads "(0)" — every fixture node is a childless leaf —
		// must offer the remove control. Today the foreign org's "Bass (0)"
		// renders WITHOUT one (canRemove's isOwnOrgSection gate), which is
		// exactly the on-screen inconsistency the gate walk failed. A tree
		// scoped to the viewer's own org satisfies this; rendering foreign
		// groups control-less does not.
		for (const id of renderedSectionIds(container)) {
			const header = q(container, `section-header-${id}`);
			if (!header?.textContent?.includes('(0)')) continue;
			expect(
				q(container, `section-remove-${id}`),
				`rendered empty section "${header.textContent.trim()}" (${id}) has no remove control — empty sections must not be inconsistent (#114 check 4)`
			).not.toBeNull();
		}
	});

	it("a foreign org's section must NEVER carry the destructive control (#110 review F2 stands) — so consistency means TAM's Bass is not rendered here at all", async () => {
		const container = await renderReady();

		// Whatever the page renders, the remove control on ANOTHER org's entity
		// is forbidden…
		expect(q(container, `section-remove-${TAM_BASS}`)).toBeNull();
		// …and therefore the only consistent presentation is to not show the
		// foreign group on this collective's roster in the first place.
		expect(q(container, `section-group-${TAM_BASS}`)).toBeNull();
	});
});

// ── second-order: "own org" comes from the VIEWER, not the first roster row ─────

describe("/roster — F3: the org that gates remove is the AUTHENTICATED VIEWER's, not whoever sorts first", () => {
	it("multi-org roster where a FOREIGN member sorts first alphabetically: the EFK viewer still gets the ✕ on EFK's empty Bass, and Sireen's empty section gets none", async () => {
		// `loadRoster`'s member query is not org-scoped — on a multi-org db the
		// rows legitimately span orgs, sorted by name. Anna (Sireen) sorts
		// before every EFK member; the current `rows.find((r) => r.orgId)`
		// derivation therefore answers SIREEN and hangs the destructive control
		// on the wrong org's sections. The viewer is Pete (personId 'person-p',
		// EFK) — resolveMyOrgId answers EFK, and so does his own roster row.
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

		// The viewer's own empty section keeps its control…
		expect(
			q(container, `section-remove-${EFK_BASS}`),
			"EFK viewer's own empty Bass lost its remove control — own-org must derive from the viewer, not the first alphabetical row"
		).not.toBeNull();
		// …and the foreign org's empty section never gains one.
		expect(
			q(container, `section-remove-${SIREEN_SOPRANO_II}`),
			"the remove control migrated onto ANOTHER org's section — destructive affordance on a foreign entity (#110 review F2)"
		).toBeNull();
	});
});

// (*MVOX:Tallis* — #124 RED, F3: consistent empty-section remove + viewer-derived own org)
