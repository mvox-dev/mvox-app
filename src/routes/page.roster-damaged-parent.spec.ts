// @vitest-environment happy-dom
//
// #264 item 5 RED — DAMAGED `_parent` data surfaces LOUDLY on the real /roster
// route (PO ruling: a section holding ≠1 `_parent` values must render as
// damaged data — an explicit marker naming the section — never a silent
// `.find()` guess; the rest of the roster still renders; no arrange
// affordances on the damaged node).
//
// INTEGRATION discipline: sectionData is REAL here (no listSections mock) —
// the deterministic damaged fixture is a raw listSections wire response with
// TWO `_parent` values for one section, served through a stubbed global
// fetch. Only the roster read (loadRoster) and the write layer
// (sectionActions) are mocked. That wiring is the point: detection lives in
// the tree builder and the marker lives in the page, and this spec fails
// unless BOTH are wired on the actual route.
//
// Pinned surface (GREEN implements; the exact visual treatment beyond this is
// engineering's, proposed in the delivery report):
//
//   - testid `section-parent-damaged-<sectionId>` renders wherever the
//     damaged section renders (groups view AND arrange mode), carrying the
//     NEW i18n message `roster_section_parent_damaged` with the section's
//     NAME as its param (the lenient message mock below echoes key + params).
//   - the damaged node offers NO arrange affordances: no ENABLED
//     arrange-indent-*/arrange-unindent-* button, and no draggable row.
//   - the rest of the roster renders normally (clean groups, clean arrange
//     rows with live affordances).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — params ECHOED (key + JSON) so the marker's NAME
// binding is assertable; real copy is pinned in page.roster-damaged-i18n.spec.ts.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
}));

const { loadRosterMock, assignMock, unassignMock, createMock, reorderMock, deleteMock, reparentMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createMock: vi.fn(),
		reorderMock: vi.fn(),
		deleteMock: vi.fn(),
		reparentMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
// sectionData deliberately NOT mocked — the REAL listSections must detect the
// damage from the wire fixture below.
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock,
	reparentSection: reparentMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const DB_ENTITY = 'db-1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** The wire fixture: Soprano clean; Alto DAMAGED (two `_parent` values, both
 *  the collective's database entity — the live Soprano II shape); Tenor clean. */
function sectionWireEntities(damagedParents: Array<{ reference: string; entity_type?: string }> = [
	{ reference: DB_ENTITY, entity_type: 'database' },
	{ reference: DB_ENTITY, entity_type: 'database' }
]) {
	return [
		{
			_id: 'sec-sop',
			name: [{ string: 'Soprano' }],
			display_order: [{ number: 1 }],
			_parent: [{ reference: DB_ENTITY, entity_type: 'database' }]
		},
		{
			_id: 'sec-tenor',
			name: [{ string: 'Tenor' }],
			display_order: [{ number: 2 }],
			_parent: [{ reference: DB_ENTITY, entity_type: 'database' }]
		},
		{
			_id: 'sec-alto',
			name: [{ string: 'Alto' }],
			display_order: [{ number: 3 }],
			_parent: damagedParents
		}
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: DB_ENTITY },
		{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-tenor'], dbEntityId: DB_ENTITY }
	];
}

/** Global-fetch stub: the section list query answers the damaged fixture;
 *  everything else answers an empty, well-formed list. */
function stubGlobalFetch(entities: unknown[] = sectionWireEntities()) {
	const stub = vi.fn().mockImplementation((url: RequestInfo | URL) => {
		const u = String(url);
		if (u.includes('_type.string=section')) {
			return Promise.resolve(json({ entities, count: entities.length }));
		}
		return Promise.resolve(json({ entities: [], count: 0 }));
	});
	vi.stubGlobal('fetch', stub);
	return stub;
}

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
	stubGlobalFetch();
	loadRosterMock.mockImplementation(() => Promise.resolve(fixtureRows()));
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	reparentMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Re-stub the wire with a DIFFERENT damage shape for `sec-alto`, then render. */
async function renderRosterWithDamage(
	damagedParents: Array<{ reference: string; entity_type?: string }>
): Promise<HTMLElement> {
	vi.unstubAllGlobals();
	stubGlobalFetch(sectionWireEntities(damagedParents));
	return renderRoster();
}

async function renderRoster(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	return container;
}

describe('/roster — a section with ≠1 `_parent` values renders as DAMAGED DATA, loudly (#264 item 5)', () => {
	it('groups view: the damaged marker renders, names the section via the roster_section_parent_damaged message, and the REST of the roster still renders', async () => {
		const container = await renderRoster();

		// The marker — present, and NAMING the section (the message mock echoes
		// the key and its params, so a marker that never received the name
		// param fails here).
		const marker = await waitFor(() => {
			const el = q(container, 'section-parent-damaged-sec-alto');
			expect(el, 'damaged-data marker for sec-alto').not.toBeNull();
			return el!;
		});
		expect(marker.textContent).toContain('roster_section_parent_damaged');
		expect(marker.textContent).toContain('Alto');

		// The rest of the roster is NOT thrown away: clean sections render.
		expect(q(container, 'section-group-sec-sop')).not.toBeNull();
		expect(q(container, 'section-group-sec-tenor')).not.toBeNull();
		// Clean sections carry no marker.
		expect(q(container, 'section-parent-damaged-sec-sop')).toBeNull();
		expect(q(container, 'section-parent-damaged-sec-tenor')).toBeNull();
	});

	it('arrange mode: the damaged node offers NO arrange affordances (no enabled indent/unindent, nothing draggable), the marker stays visible, and clean rows keep their controls', async () => {
		const container = await renderRoster();

		await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		// The marker survives into arrange mode — arrange is exactly where the
		// silent guess used to mislead.
		expect(q(container, 'section-parent-damaged-sec-alto')).not.toBeNull();

		// NO arrange affordances on the damaged node: no ENABLED indent or
		// unindent button (absent or disabled both satisfy the pin) …
		expect(
			container.querySelector('[data-testid="arrange-indent-sec-alto"]:not([disabled])')
		).toBeNull();
		expect(
			container.querySelector('[data-testid="arrange-unindent-sec-alto"]:not([disabled])')
		).toBeNull();
		// … and nothing draggable for it.
		expect(
			container.querySelector('[data-testid="arrange-row-sec-alto"][draggable="true"]')
		).toBeNull();

		// Clean rows keep their live controls — the damage is contained. Tenor's
		// previous sibling is the CLEAN Soprano (the damaged node sorts last in
		// this fixture), so its indent affordance is uncontroversially enabled.
		const tenorIndent = container.querySelector<HTMLButtonElement>(
			'[data-testid="arrange-indent-sec-tenor"]'
		);
		expect(tenorIndent).not.toBeNull();
		expect(tenorIndent!.disabled).toBe(false);
	});

	// #264 review F3 — the buttons and `draggable` were the only pinned
	// affordances; the handle's `onkeydown` is bound UNCONDITIONALLY (grab and
	// roving must keep working), so the keyboard reparent seam needs its own
	// pin. A damaged node is forced to top level, so ArrowRight's own
	// `prevSiblingId` guard does NOT refuse it: Alto sorts last in this fixture,
	// behind the clean Soprano and Tenor.
	it('arrange mode: ArrowRight on the GRABBED damaged row is refused — no reparent write, no failure banner', async () => {
		const container = await renderRoster();

		await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const damagedRow = q(container, 'arrange-row-sec-alto');
		expect(damagedRow, 'arrange row for the damaged section').not.toBeNull();

		// Grab it (the grab itself writes nothing and stays available — only the
		// reparent keys are refused), then try to indent under Tenor.
		await fireEvent.keyDown(damagedRow!, { key: ' ' });
		await waitFor(() => {
			expect(damagedRow!.getAttribute('aria-grabbed')).toBe('true');
		});
		await fireEvent.keyDown(damagedRow!, { key: 'ArrowRight' });

		// Nothing was written, and the user is not told a write failed — the
		// affordance is simply absent, which is what the commit promises.
		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
		expect(q(container, 'section-reorder-error')).toBeNull();
		// The marker still names the real problem.
		expect(q(container, 'section-parent-damaged-sec-alto')).not.toBeNull();

		// ArrowLeft is refused for the same reason (asserted, not incidental).
		await fireEvent.keyDown(damagedRow!, { key: 'ArrowLeft' });
		expect(reparentMock).not.toHaveBeenCalled();
		expect(q(container, 'section-reorder-error')).toBeNull();

		// The refusal LEAVES the grab (same contract as ArrowRight/ArrowLeft's own
		// clamp), so release it before driving another row.
		await fireEvent.keyDown(damagedRow!, { key: 'Escape' });
		await waitFor(() => {
			expect(damagedRow!.getAttribute('aria-grabbed')).toBe('false');
		});

		// A CLEAN row's keyboard reparent still works — the refusal is scoped to
		// the damaged node, not a blanket disable of the keyboard seam.
		const tenorRow = q(container, 'arrange-row-sec-tenor');
		expect(tenorRow).not.toBeNull();
		await fireEvent.keyDown(tenorRow!, { key: ' ' });
		await waitFor(() => {
			expect(tenorRow!.getAttribute('aria-grabbed')).toBe('true');
		});
		await fireEvent.keyDown(tenorRow!, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
	});

	// #264 review F1 — the damage shapes that carry NO `database` `_parent` value.
	// `listSections` forces every damaged node to a ROOT (`parentId: null`) while
	// `dbEntityId` is still read as `_parent.find(entity_type === 'database')`, so
	// a node whose values are all SECTION refs (the half-landed sub-section
	// indent/unindent) or a node with ZERO values resolves `dbEntityId: null` and
	// used to be dropped by the roster page's org-scope filter — no marker, no
	// name, no trace, which is the same #258 fail-open class item 5 closes, only
	// with a disappearance instead of a wrong placement. A damaged node the page
	// cannot attribute to a collective must be ANNOUNCED, not guessed at and not
	// swallowed.
	const unattributableShapes: Array<{
		label: string;
		parents: Array<{ reference: string; entity_type?: string }>;
	}> = [
		{
			label: 'two SECTION refs (a half-landed sub-section indent/unindent)',
			parents: [
				{ reference: 'sec-sop', entity_type: 'section' },
				{ reference: 'sec-tenor', entity_type: 'section' }
			]
		},
		{ label: 'ZERO `_parent` values', parents: [] }
	];

	for (const shape of unattributableShapes) {
		it(`groups view: a damaged section with ${shape.label} still renders its marker and name (no database ref to scope it by)`, async () => {
			const container = await renderRosterWithDamage(shape.parents);

			const marker = await waitFor(() => {
				const el = q(container, 'section-parent-damaged-sec-alto');
				expect(el, 'damaged-data marker for sec-alto').not.toBeNull();
				return el!;
			});
			expect(marker.textContent).toContain('roster_section_parent_damaged');
			expect(marker.textContent).toContain('Alto');

			// The section itself is on screen (it is a root — never nested under one
			// of the guessed section refs), and the clean roster is untouched.
			expect(q(container, 'section-group-sec-alto')).not.toBeNull();
			expect(q(container, 'section-group-sec-sop')).not.toBeNull();
			expect(q(container, 'section-group-sec-tenor')).not.toBeNull();
			expect(q(container, 'section-parent-damaged-sec-sop')).toBeNull();
			expect(q(container, 'section-parent-damaged-sec-tenor')).toBeNull();
		});

		it(`arrange mode: a damaged section with ${shape.label} renders its marker and offers NO arrange affordances`, async () => {
			const container = await renderRosterWithDamage(shape.parents);

			await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
			await waitFor(() => {
				expect(q(container, 'roster-arrange-list')).not.toBeNull();
			});

			expect(q(container, 'section-parent-damaged-sec-alto')).not.toBeNull();
			expect(
				container.querySelector('[data-testid="arrange-indent-sec-alto"]:not([disabled])')
			).toBeNull();
			expect(
				container.querySelector('[data-testid="arrange-unindent-sec-alto"]:not([disabled])')
			).toBeNull();
			expect(
				container.querySelector('[data-testid="arrange-row-sec-alto"][draggable="true"]')
			).toBeNull();

			// Clean rows keep their live controls — the damage is contained.
			const tenorIndent = container.querySelector<HTMLButtonElement>(
				'[data-testid="arrange-indent-sec-tenor"]'
			);
			expect(tenorIndent).not.toBeNull();
			expect(tenorIndent!.disabled).toBe(false);
		});
	}
});

// (*MVOX:Tallis* — #264 item 5 RED, integration on the real /roster route)
