// @vitest-environment happy-dom
//
// TS.3/#97 RED — the /roster page's NEW-SECTION-IN-PICKER wiring (integration).
// These tests render the ACTUAL page route component — same
// #partial-assertions-hide-bugs rationale as page.roster-picker.spec.ts: a
// unit-covered inline form plus a unit-covered createSection with nothing
// joining them to the page ships an unreachable feature. `groupBySection` runs
// REAL; only the fetching/writing seams are mocked, so GREEN cannot pass
// without genuinely wiring the form into the picker on the page AND the two
// writes into its submit.
//
// Pinned wiring contract (GREEN must implement):
//   - The picker menu the /roster page renders carries the '+ New section…'
//     entry (section-picker-new); tapping it shows the inline form
//     (section-create-form) INSIDE that member's row, name input auto-focused.
//   - 'Create + assign' = TWO writes, STRICTLY ORDERED: (1) createSection(cfg,
//     { name, parentId }) — parentId null for '(top level)', a section id when
//     one is chosen; then, only after (1) RESOLVES with the new id,
//     (2) assignMemberSection(cfg, memberId, <newId>). Server-confirmed — the
//     assign cannot be optimistic, the id does not exist until the create
//     round-trips.
//   - After both writes resolve the NEW SECTION APPEARS IN THE ROSTER
//     IMMEDIATELY — meaning: the page inserts the new node into its LOCAL tree
//     + membership state. NO refetch: loadRoster and listSections are each
//     called exactly ONCE (at load). A sub-section renders NESTED inside its
//     parent's group.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock, listSectionsMock, assignMock, unassignMock, createSectionMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createSectionMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
// The WRITE seams — the form's submit must land here, with the page's cfg.
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createSectionMock
}));
// Severs the entu-config → $env/dynamic/public import under happy-dom (same
// pattern as page.roster-picker.spec.ts).
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

// ── fixtures (same shape as page.roster-picker.spec.ts) ─────────────────────────

function fixtureTree(): SectionNode[] {
	const sop1: SectionNode = {
		id: 'sec-sop1',
		name: 'Soprano 1',
		displayOrder: 1,
		parentId: 'sec-sop',
		depth: 1,
		children: []
	};
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [sop1] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-pete', personId: 'p-pete', name: 'Pete Wilson', email: 'pete@x.com', sectionIds: [] }
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

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(fixtureRows());
	listSectionsMock.mockResolvedValue(fixtureTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createSectionMock.mockReset();
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
	// TU.2/#110 finding #9 — sections default COLLAPSED now (member rows, and
	// this file's picker triggers, don't render until expanded); this file's
	// concern is the create+assign WRITE flow, not the collapse default, so
	// expand everything up front via the same toggle-all control #9 shipped.
	const toggleAll = container.querySelector('[data-testid="roster-view-chip-expanded"]') as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
	}
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function openForm(container: HTMLElement, memberId: string): Promise<void> {
	await fireEvent.click(q(container, `section-picker-trigger-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `section-picker-menu-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-create-form')).not.toBeNull();
	});
}

async function typeName(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
		target: { value }
	});
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);
}

// ── the form is reachable ON THE PAGE (integration: actual route) ───────────────

describe('/roster — the inline new-section form renders within the page picker', () => {
	it("admin opens a member's picker → the menu the PAGE renders carries section-picker-new; tapping it shows the form INSIDE that member's row, name auto-focused", async () => {
		const container = await renderReady();

		await fireEvent.click(q(container, 'section-picker-trigger-m-pete') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-pete')).not.toBeNull();
		});
		expect(q(container, 'section-picker-new')).not.toBeNull();

		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
		const row = q(container, 'roster-row-m-pete') as HTMLElement;
		await waitFor(() => {
			expect(row.querySelector('[data-testid="section-create-form"]')).not.toBeNull();
		});
		const name = row.querySelector('[data-testid="section-create-name"]') as HTMLInputElement;
		expect(name).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(name);
		});
		// Nothing has been written just by opening the form.
		expect(createSectionMock).not.toHaveBeenCalled();
		expect(assignMock).not.toHaveBeenCalled();
	});
});

// ── 'Create + assign': two ordered, server-confirmed writes ─────────────────────

describe("/roster — 'Create + assign' does TWO writes: createSection, then assign via _parent", () => {
	it('top-level create for m-pete: createSection(cfg, { name, parentId: null }) fires first; assignMemberSection(cfg, m-pete, <newId>) fires ONLY AFTER the create resolves with the id', async () => {
		const create = deferred<string>();
		createSectionMock.mockReturnValue(create.promise);
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Tenor');
		await submit(container);

		expect(createSectionMock).toHaveBeenCalledTimes(1);
		expect(createSectionMock).toHaveBeenCalledWith(CFG, { name: 'Tenor', parentId: null });
		// SERVER-CONFIRMED ordering: the section id does not exist yet — the
		// assign MUST NOT have fired while the create is pending.
		expect(assignMock).not.toHaveBeenCalled();

		create.resolve('sec-new-1');
		await waitFor(() => {
			expect(assignMock).toHaveBeenCalledTimes(1);
		});
		expect(assignMock).toHaveBeenCalledWith(CFG, 'm-pete', 'sec-new-1');
		expect(unassignMock).not.toHaveBeenCalled();
	});

	it("with a parent chosen in the form's parent picker: createSection receives parentId = that section id", async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Soprano 2');
		await fireEvent.change(q(container, 'section-create-parent') as HTMLElement, {
			target: { value: 'sec-sop' }
		});
		await submit(container);

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, { name: 'Soprano 2', parentId: 'sec-sop' });
	});
});

// ── the new section appears in the roster immediately — no refetch ──────────────

describe('/roster — after create + assign the new section appears in the roster immediately', () => {
	it("top-level: a section-group-sec-new-1 group renders, TITLED with the new name, with m-pete's row INSIDE it and OUT of Unassigned — and neither loadRoster nor listSections was refetched (each exactly once, at load)", async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Tenor');
		await submit(container);

		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-new-1')?.querySelector('[data-testid="roster-row-m-pete"]')
			).not.toBeNull();
		});
		expect(q(container, 'section-group-sec-new-1')?.textContent).toContain('Tenor');
		expect(
			q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-pete"]') ??
				null
		).toBeNull();
		// "Immediately" means LOCAL state insertion, not reload-the-world.
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});

	it("sub-section (parent = Soprano): the new group renders NESTED INSIDE section-group-sec-sop with data-depth='1', and the member's row is in it", async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Soprano 2');
		await fireEvent.change(q(container, 'section-create-parent') as HTMLElement, {
			target: { value: 'sec-sop' }
		});
		await submit(container);

		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-sop')?.querySelector(
					'[data-testid="section-group-sec-new-1"]'
				)
			).not.toBeNull();
		});
		const newGroup = q(container, 'section-group-sec-new-1') as HTMLElement;
		expect(newGroup.getAttribute('data-depth')).toBe('1');
		expect(newGroup.querySelector('[data-testid="roster-row-m-pete"]')).not.toBeNull();
	});

	it('the picker is CLOSED after a successful submit (menu and form both gone), and reopening it lists the NEW section as a pickable option', async () => {
		const container = await renderReady();

		await openForm(container, 'm-pete');
		await typeName(container, 'Tenor');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'section-group-sec-new-1')).not.toBeNull();
		});
		expect(q(container, 'section-create-form')).toBeNull();
		expect(q(container, 'section-picker-menu-m-pete')).toBeNull();

		// The new node is in the page's LOCAL tree, so every picker now offers it.
		await fireEvent.click(q(container, 'section-picker-trigger-m-ada') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-ada')).not.toBeNull();
		});
		expect(q(container, 'section-picker-option-sec-new-1')).not.toBeNull();
	});
});

// (*MVOX:Tallis* — TS.3/#97 RED)
