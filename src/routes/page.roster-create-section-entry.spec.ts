// @vitest-environment happy-dom
//
// #124 RED (F1 + F2) — a PAGE-LEVEL "+ New section" entry point on the ACTUAL
// /roster route (integration: real page component, real SectionPicker, real
// groupBySection; only the fetch/write seams are mocked — same harness as
// page.roster-create-section-org.spec.ts).
//
// WHY (TU.6 gate walk, #114 check 1 → SPIKE root cause, 2026-08-12): section
// creation "does nothing" in live NOT because the writes are broken — the
// deployed bundle carries the TU.1 code and the exact createSection wire shape
// succeeds against live polyphony — but because the ONLY entry point is buried
// three levels deep inside a member row's picker dropdown:
//
//   - MIS-TAP: "(Unassigned)" and "+ New section…" are adjacent 24px rows with
//     identical styling; a tap one row high on an already-unassigned member is
//     `pick(null)` → `if (before.length === 0) return` → picker closes, nothing
//     written, nothing said. Exactly the reported symptom.
//   - OFF-SCREEN FORM: 16 live sections make the dropdown ~440px tall;
//     "+ New section…" is the LAST row, and tapping it swaps the list for a
//     ~110px form anchored back at the trigger — off-viewport on a phone.
//   - INVISIBLE SUCCESS: a new section is inserted with displayOrder=Infinity
//     (sorts LAST) while the member moves OUT of the group under the user's
//     thumb — even a successful create shows nothing at the point of gaze.
//
// The fix this file pins: a DEDICATED, page-level create affordance that does
// not depend on any member row, any picker, or any expansion state — plus an
// announced (role="status") success so a create is never silent. The
// member-picker path stays as-is (its own specs keep pinning it); this is an
// ADDITIONAL, primary entry point.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS
//     roster-new-section          page-level "+ New section" control: grouped
//                                 view, ADMIN-ONLY, rendered ABOVE the groups
//                                 (document order before roster-groups), NOT
//                                 inside any member row, reachable with every
//                                 section still COLLAPSED (default state)
//     roster-new-section-form     the form it opens (no picker involved)
//     roster-new-section-name     name input, AUTO-FOCUSED on open
//     roster-new-section-parent   parent <select>; '' = "(top level)" default;
//                                 options are the VIEWER'S OWN org's sections
//                                 ONLY (the whole-db tree holds four test orgs'
//                                 roots — a foreign org's section must not be
//                                 offered as a parent)
//     roster-new-section-submit   fires createSection(cfg, { name, parentId,
//                                 orgId: <the VIEWER's own org id> }) — orgId
//                                 from the authenticated person (resolveDatabaseEntityId
//                                 or her own roster row), NEVER a limit=1 guess
//     roster-new-section-cancel   closes the form; nothing written
//     roster-new-section-error    inline validation error (duplicate/empty),
//                                 sibling-scoped + own-org-scoped exactly like
//                                 the picker form (a GLOBAL check was the
//                                 original live bug — TU.1 finding #10 B)
//     roster-section-create-status  role="status" live region; a successful
//                                 create lands a non-empty announcement in it
//                                 (the "invisible success" half of the finding)
//
//   BEHAVIOR
//     - submit resolves → the new section's group (section-group-<newId>)
//       appears in the roster, titled with the typed name; a sub-section
//       renders NESTED inside its parent's group. LOCAL insertion — neither
//       loadRoster nor listSections is refetched.
//     - the page-level create assigns NO member (there is no member context) —
//       assignMemberSection must not fire.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── live-shaped fixtures (real polyphony entity ids, 2026-08-12 probe) ──────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9';
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const EFK_ALTO = '69c7f8748489bfcb0e81b0cd';
const SIREEN_SOPRANO_II = '69c7f8798489bfcb0e81b207';

/** Live shape: the whole-db tree — EFK's roots AND another org's flat
 *  "Soprano II" (the name that must NOT block an EFK create). */
function liveShapedTree(): SectionNode[] {
	return [
		{
			id: EFK_SOPRANO,
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			orgId: ORG_EFK,
			depth: 0,
			children: []
		},
		{
			id: SIREEN_SOPRANO_II,
			name: 'Soprano II',
			displayOrder: 3,
			parentId: null,
			orgId: ORG_SIREEN,
			depth: 0,
			children: []
		},
		{
			id: EFK_ALTO,
			name: 'Alto',
			displayOrder: 4,
			parentId: null,
			orgId: ORG_EFK,
			depth: 0,
			children: []
		}
	];
}

/** The VIEWER (authenticated personId 'person-p') is Pete, an EFK member. */
function fixtureRows(): RosterRow[] {
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
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		}
	];
}

const CFG = { db: 'polyphony', token: 'jwt-abc' };

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
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(fixtureRows());
	listSectionsMock.mockResolvedValue(liveShapedTree());
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

async function renderReady(admin: AdminState = 'admin') {
	setAuthedWithOneCollective();
	adminStore.set(admin);
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

// #155/S4 — the page-level "+ New section" control moved EXCLUSIVELY into
// Arrange mode (was rendered regardless of viewMode). Every test below that
// wants `roster-new-section` first switches into it via this helper.
async function renderArrangeReady(admin: AdminState = 'admin') {
	const container = await renderReady(admin);
	const arrangeChip = q(container, 'roster-view-chip-arrange') as HTMLElement | null;
	if (arrangeChip) {
		await fireEvent.click(arrangeChip);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
	}
	return container;
}

async function openPageForm(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
}

async function typeName(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
		target: { value }
	});
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
}

// ── F1: the entry point exists at PAGE level, not buried in a picker ────────────
//
// #155/S4 — this control RELOCATED into Arrange mode exclusively (was
// page-level, rendered regardless of viewMode). Every test below opens
// Arrange first via `renderArrangeReady`; the structural pin is now "outside
// the arrange row list, admin-only, reachable from the arrange chip" rather
// than "above roster-groups" (roster-groups doesn't render in Arrange mode
// at all).

describe('/roster — the "+ New section" control lives in Arrange mode (finding F1, structural, relocated #155/S4)', () => {
	it('admin, Arrange mode: roster-new-section renders inside the arrange screen, outside the row list and outside any member row — and merely rendering writes nothing', async () => {
		const container = await renderArrangeReady();

		const control = q(container, 'roster-new-section');
		expect(control).not.toBeNull();
		// NOT buried: no member-row ancestor, no picker involved, not one of the
		// per-row arrange controls either.
		expect(control!.closest('[data-testid^="roster-row-"]')).toBeNull();
		expect(container.querySelector('[data-testid^="section-picker-menu-"]')).toBeNull();
		const list = q(container, 'roster-arrange-list') as HTMLElement;
		expect(list.contains(control)).toBe(false);

		expect(createSectionMock).not.toHaveBeenCalled();
		expect(assignMock).not.toHaveBeenCalled();
	});

	it('Collapsed/Expanded (display-only) views: roster-new-section does NOT render — it lives exclusively in Arrange mode now', async () => {
		const container = await renderReady();
		expect(q(container, 'roster-new-section')).toBeNull();

		const expandedChip = q(container, 'roster-view-chip-expanded') as HTMLElement;
		await fireEvent.click(expandedChip);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
		expect(q(container, 'roster-new-section')).toBeNull();
	});

	it('non-admin: roster-new-section does not render (same fail-closed gate as every other admin control — and the Arrange chip itself is unreachable)', async () => {
		const container = await renderArrangeReady('not-admin');
		expect(q(container, 'roster-new-section')).toBeNull();
	});

	it('tapping it opens roster-new-section-form: name input AUTO-FOCUSED, parent select present defaulting to "(top level)" — nothing written by opening', async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		const name = q(container, 'roster-new-section-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(name);
		});
		const parent = q(container, 'roster-new-section-parent') as HTMLSelectElement;
		expect(parent).not.toBeNull();
		expect(parent.value).toBe('');

		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form; nothing was written', async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await fireEvent.click(q(container, 'roster-new-section-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-new-section-form')).toBeNull();
		});
		expect(createSectionMock).not.toHaveBeenCalled();
	});
});

// ── F1: end-to-end — type name, submit, section APPEARS (and is announced) ──────

describe('/roster — page-level create: type name, submit, the section appears in the arrange list', () => {
	it("top-level create: createSection(cfg, { name, parentId: null, orgId: <viewer's org> }) fires ONCE; the new row renders TITLED with the name; success is ANNOUNCED (role=status non-empty); NO member assigned; NO refetch", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await typeName(container, 'Tenor 2');
		await submit(container);

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		// The viewer's OWN org — from the authenticated person, never a limit=1
		// guess, never "whichever roster row sorted first" (see the F3 spec).
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Tenor 2',
			parentId: null,
			orgId: ORG_EFK
		});

		// VISIBLE result: the arrange row is on screen, named.
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-new-1')).not.toBeNull();
		});
		expect(q(container, 'arrange-row-sec-new-1')?.textContent).toContain('Tenor 2');

		// ANNOUNCED result — the "invisible success" half of the finding: a
		// role="status" live region carries a non-empty announcement.
		const status = q(container, 'roster-section-create-status');
		expect(status).not.toBeNull();
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(status?.textContent?.trim()).not.toBe('');
		});

		// Page-level create has no member context — nobody is assigned.
		expect(assignMock).not.toHaveBeenCalled();
		// LOCAL insertion, not reload-the-world.
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});

	it("duplicate of the viewer's OWN org's root ('Alto') is refused: roster-new-section-error shows, no write", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await typeName(container, 'Alto');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'roster-new-section-error')).not.toBeNull();
		});
		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it("ANOTHER org's flat 'Soprano II' does NOT block a top-level EFK 'Soprano II' — no error, the write fires (the global duplicate check was the original live bug)", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await typeName(container, 'Soprano II');
		await submit(container);

		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Soprano II',
			parentId: null,
			orgId: ORG_EFK
		});
	});
});

// ── F2: sub-section creation under a parent section ─────────────────────────────

describe('/roster — page-level create of a SUB-SECTION (finding F2)', () => {
	it("parent select offers ONLY the viewer's own org's sections — EFK's roots yes, Sireen's 'Soprano II' NO (a foreign org's section must not be offered as a parent)", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		const parent = q(container, 'roster-new-section-parent') as HTMLSelectElement;
		const values = Array.from(parent.querySelectorAll('option')).map((o) => o.value);
		expect(values).toContain(''); // "(top level)"
		expect(values).toContain(EFK_SOPRANO);
		expect(values).toContain(EFK_ALTO);
		expect(values).not.toContain(SIREEN_SOPRANO_II);
	});

	it("name 'Soprano II', parent Soprano: not refused by the foreign flat 'Soprano II'; createSection(cfg, { name, parentId: Soprano, orgId }) fires; the new row renders NESTED under Soprano's row at data-depth 1", async () => {
		const container = await renderArrangeReady();

		await openPageForm(container);
		await typeName(container, 'Soprano II');
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLElement, {
			target: { value: EFK_SOPRANO }
		});
		await submit(container);

		expect(q(container, 'roster-new-section-error')).toBeNull();
		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Soprano II',
			parentId: EFK_SOPRANO,
			orgId: ORG_EFK
		});

		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-new-1')).not.toBeNull();
		});
		const newRow = q(container, 'arrange-row-sec-new-1') as HTMLElement;
		expect(newRow.getAttribute('data-depth')).toBe('1');
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — #124 RED, F1+F2: page-level section-create entry point)
// (*MVOX:Palestrina* — #155/S4: relocated into Arrange mode exclusively)
