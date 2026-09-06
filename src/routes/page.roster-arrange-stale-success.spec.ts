// @vitest-environment happy-dom
//
// #264 item 4 RED — the generation-guard gap on performReorder/performReparent
// SUCCESS branches (the #259/#260 class, PO ruling item 4).
//
// Both write paths capture `g = routeLoad.generation` at entry and check it
// ONLY on the failure/refetch branches. The SUCCESS branch checks nothing: a
// reorder/reparent response that settles AFTER a collective switch writes the
// OLD collective's outcome into the page — the `roster-reorder-status` live
// region announces a move of a section that is not on screen (and the reparent
// path computes its follow-up renumber against the NEW collective's tree).
//
// Pinned: a success response settling after a collective switch writes NOTHING
// — no status/announcement, no banner, no tree state — for the stale
// collective.
//
// House method for timing proofs (#259's deterministic race construction): the
// write mock is release-controlled — a test-held deferred on the async
// boundary ONLY. Ordering is hold → switch → settle-success; the failure trips
// on the live-region assertion, never on a timeout.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — key + params echoed; structural assertions only.
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

const {
	loadRosterMock,
	listSectionsMock,
	assignMock,
	unassignMock,
	createMock,
	reorderMock,
	deleteMock,
	reparentMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
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

// ── two collectives, two disjoint fixtures ──────────────────────────────────

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function treeA(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

function treeB(): SectionNode[] {
	return [
		{ id: 'sec-b1', name: 'Bass I', displayOrder: 1, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] },
		{ id: 'sec-b2', name: 'Bass II', displayOrder: 2, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] }
	];
}

function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: ORG_A },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: 'bea@x.com', sectionIds: ['sec-alto'], dbEntityId: ORG_A }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: ['sec-b1'], dbEntityId: ORG_B }
	];
}

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', 'other-choir': 'person-q' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'polyphony' ? rowsA() : rowsB())
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'polyphony' ? treeA() : treeB())
	);
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
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

function rowOrder(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="arrange-row-"]')].map(
		(el) => el.getAttribute('data-testid') ?? ''
	);
}

function statusText(container: HTMLElement): string {
	return (q(container, 'roster-reorder-status')?.textContent ?? '').trim();
}

async function renderInArrangeMode(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

async function switchToOtherChoir(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	// Collective B's tree is on screen before anything stale settles.
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-alto')).toBeNull();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('/roster — a structural-write SUCCESS settling after a collective switch writes NOTHING (#264 item 4)', () => {
	it('performReorder: a held reorderSections SUCCESS settles after the switch → the live region stays EMPTY (no stale "moved"/"dropped" announcement), no banner, and collective B\'s tree is untouched', async () => {
		let release!: () => void;
		reorderMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		const container = await renderInArrangeMode();

		// Keyboard reorder on collective A: grab Soprano, move it down one slot
		// provisionally, drop — the commit awaits the held write.
		let target = q(container, 'arrange-row-sec-sop') as HTMLElement;
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
		await fireEvent.keyDown(target, { key: 'ArrowDown' });
		target = q(container, 'arrange-row-sec-sop') as HTMLElement;
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});

		// Switch mid-flight; B renders. The drop cleared the live region when the
		// attempt started, so anything in it after the settle came from the
		// STALE success.
		await switchToOtherChoir(container);

		release();
		await flush();

		// THE pin: the stale success wrote nothing. Pre-fix, performReorder's
		// success branch sets `roster_section_moved` (and the keyboard drop path
		// its committed-drop wording) with no generation check — announcing
		// collective A's move while collective B is on screen.
		expect(statusText(container)).toBe('');
		expect(q(container, 'section-reorder-error')).toBeNull();
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
	});

	it('performReparent: a held reparentSection SUCCESS settles after the switch → no stale "indented" announcement, and NO follow-up renumber write is fired for either collective', async () => {
		let release!: () => void;
		reparentMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		const container = await renderInArrangeMode();

		// Indent Alto under Soprano on collective A; the write is held.
		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoir(container);

		release();
		await flush();

		// The stale success must not announce collective A's indent over
		// collective B's roster …
		expect(statusText(container)).toBe('');
		expect(q(container, 'section-reorder-error')).toBeNull();
		// … and the second-phase renumber must not fire at all — before the
		// guard, the success branch computed the destination sibling group
		// against whatever tree is CURRENT (collective B's) and wrote status for
		// the stale collective.
		expect(reorderMock).not.toHaveBeenCalled();
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
	});
});

// (*MVOX:Tallis* — #264 item 4 RED, house deterministic-race method per #259)
