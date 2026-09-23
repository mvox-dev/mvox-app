// @vitest-environment happy-dom
//
// TS.2/#96 RED — the /roster page's SECTION PICKER wiring (integration). These
// tests render the ACTUAL page route component — the whole reason this file
// exists is the "partial assertions hide bugs" lesson: a unit-covered
// SectionPicker plus a unit-covered sectionActions with NOTHING joining them to
// the page ships an unreachable feature. Here `groupBySection` runs REAL and
// only the fetching/writing seams are mocked, so GREEN cannot pass without
// genuinely wiring the picker into the member rows and the writes into the
// picker's taps.
//
// Pinned wiring contract (GREEN must implement):
//   - OWNER GATE (#468, superseding the launch-era admin gate): the picker
//     trigger renders on a member row ONLY when the row's `ownerIds` (the
//     member entity's own `_owner` grant references, read off the list query)
//     contain the READER's own person id for this db (`selected?.personId`).
//     `$adminStore` no longer decides it — the grant on the target entity
//     does (#454's lesson; ER-14: a move deletes a `_parent`, owner-gated).
//     `ownerIds: []` (withheld private bucket or no grant) hides it — FAIL
//     CLOSED. `!sectionsError` stays: no section tree → nothing to pick (F2).
//   - POSITION (#468): the picker floats upper right on the card — wrapper
//     `absolute top-1 right-1`, NO z-index, written AFTER the card activator
//     inside the same `relative` <li> (the #302 F1 lift discipline).
//   - Tapping a section NOT in the row's sectionIds → assignMemberSection(cfg,
//     memberId, sectionId); tapping one ALREADY in it → unassignMemberSection
//     (toggle). Tapping "(Unassigned)" → unassignMemberSection ONCE PER
//     currently-assigned section (removes ALL section parents).
//   - PER-TAP OPTIMISTIC-AND-RECONCILE: the row moves group(s) IMMEDIATELY
//     (before the write resolves); on write failure it REVERTS (and the
//     failure is logged); on success it stays — NO roster refetch (loadRoster
//     is called exactly once, at load; per-tap writes are not batch-saves and
//     not reload-the-world).
//   - The menu closes after every pick.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock, listSectionsMock, assignMock, unassignMock } = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn()
}));
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer; the SHARED,
// profile-names-only `loadRoster` belongs to the agenda / event page / admin roles
// (Henry's roster-only scope ruling — see rosterData.ts for both contracts).
vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
// The WRITE seam — the picker taps must land here, with the page's cfg.
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock
}));
// Severs the entu-config → $env/dynamic/public import under happy-dom (same
// pattern as page.roster-sections.spec.ts).
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
// NOT mocked (unlike `sectionActions`) — the page imports the discriminator from
// this module precisely so the vi.mock above can't blank it out.
import { SectionMembershipMissingError } from '$lib/sections/sectionErrors';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';

// ── fixtures (same shape as page.roster-sections.spec.ts) ───────────────────────
// Soprano (order 1) ▸ Soprano 1; Alto (order 2). Ada+Carol in Soprano, Eva in
// Soprano 1, Bea in Alto, Pete unassigned.

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

// #468 — every default fixture row carries the READER's person id ('person-p',
// per setAuthedWithOneCollective's personIdByDb) in `ownerIds`, alongside an
// inherited db-level owner: the wiring suites below all open pickers, and under
// the owner gate a picker only exists on a row the reader may actually move.
function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-carol', personId: 'p-carol', name: 'Carol Williams', email: 'carol@x.com', sectionIds: ['sec-sop'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-pete', personId: 'p-pete', name: 'Pete Wilson', email: 'pete@x.com', sectionIds: [], ownerIds: ['person-db-owner', 'person-p'] }
	];
}

// #468 gate fixtures — one row the reader OWNS (inherited value first: wire
// order, inherited included), one owned only by somebody else, one whose
// private bucket the read withheld (`ownerIds: []`).
function gateRows(): RosterRow[] {
	return [
		{ memberId: 'm-owned', personId: 'p-owned', name: 'Otto Owned', email: 'otto@x.com', sectionIds: ['sec-sop'], ownerIds: ['person-db-owner', 'person-p'] },
		{ memberId: 'm-foreign', personId: 'p-foreign', name: 'Fanny Foreign', email: 'fanny@x.com', sectionIds: ['sec-alto'], ownerIds: ['person-db-owner'] },
		{ memberId: 'm-withheld', personId: 'p-withheld', name: 'Willa Withheld', email: 'willa@x.com', sectionIds: [], ownerIds: [] }
	];
}

const CFG = { db: 'sampledb', token: 'jwt-abc' };

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
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
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue(fixtureTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
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
	// TU.2/#110 finding #9 — sections default COLLAPSED now (member rows, and
	// this file's picker triggers, don't render until expanded); this file's
	// concern is picker WIRING, not the collapse default (that is
	// page.roster-sections-ux.spec.ts's / page.roster-sections.spec.ts's job),
	// so expand everything up front via the same toggle-all control #9 shipped.
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

async function openPicker(container: HTMLElement, memberId: string): Promise<void> {
	await fireEvent.click(q(container, `section-picker-trigger-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `section-picker-menu-${memberId}`)).not.toBeNull();
	});
}

// ── owner gate (#468 — supersedes the launch-era admin gate) ───────────────────

describe('/roster — picker owner gate (#468, integration: actual page route)', () => {
	// The gate is the member's own `_owner` grant, read off the entity onto
	// `row.ownerIds` and compared against the READER's person id for this db
	// (`selected?.personId` — 'person-p' here). No app-computed role decides it.
	it("a row whose ownerIds carry the reader's person id renders the trigger INSIDE that row — even with adminStore 'not-admin' (the grant decides, not the role)", async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('not-admin');
		const row = q(container, 'roster-row-m-owned');
		expect(row, 'owned row renders').not.toBeNull();
		expect(
			row?.querySelector('[data-testid="section-picker-trigger-m-owned"]'),
			'trigger inside the owned row'
		).not.toBeNull();
		// Her neighbours without the reader's grant render NOTHING there.
		expect(q(container, 'section-picker-trigger-m-foreign')).toBeNull();
		expect(q(container, 'section-picker-trigger-m-withheld')).toBeNull();
	});

	it("a row WITHOUT the reader in ownerIds renders NO trigger even with adminStore 'admin' — the collective-wide role no longer opens every row", async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('admin');
		expect(q(container, 'section-picker-trigger-m-foreign')).toBeNull();
		// The owned row still gets its trigger — the absence above is the gate
		// working, not a picker-wide regression.
		expect(q(container, 'section-picker-trigger-m-owned')).not.toBeNull();
	});

	it("ownerIds: [] (withheld private bucket — no `_owner` in the read) → NO trigger, fail closed, even with adminStore 'admin'", async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('admin');
		expect(q(container, 'section-picker-trigger-m-withheld')).toBeNull();
	});

	// Green before AND after #468 by design — under the old gate 'not-admin'
	// hid it, under the new one `!sectionsError` must keep hiding it for a
	// reader who DOES hold `_owner` (F2: no section tree → nothing to pick).
	it('sectionsError still hides the picker even for a reader who holds _owner on the row', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listSectionsMock.mockRejectedValue(new Error('sections boom'));
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		setAuthedWithOneCollective();
		adminStore.set('not-admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid^="section-picker-trigger-"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

// ── position (#468 — floating upper right, the #302 F1 lift discipline) ────────

describe('/roster — picker position (#468): upper right on the card, lifted by tree order alone', () => {
	// The wrapper is the <li>'s DIRECT CHILD holding the picker — walk up from
	// the trigger to it (never assume how many component-internal layers sit
	// between).
	function pickerWrapper(container: HTMLElement, memberId: string): HTMLElement {
		const li = q(container, `roster-row-${memberId}`) as HTMLElement;
		expect(li, `row li ${memberId}`).not.toBeNull();
		const trigger = q(container, `section-picker-trigger-${memberId}`) as HTMLElement;
		expect(trigger, `trigger ${memberId}`).not.toBeNull();
		let wrapper: HTMLElement = trigger;
		while (wrapper.parentElement && wrapper.parentElement !== li) wrapper = wrapper.parentElement;
		expect(wrapper.parentElement, 'wrapper is a direct child of the row <li>').toBe(li);
		return wrapper;
	}

	it('the wrapper is `absolute top-1 right-1` with NO z- class, and FOLLOWS the roster-row-card activator in tree order inside the same (already-relative) <li>', async () => {
		// 'admin' so the collapsed-card activator renders alongside the picker —
		// the exact overlay the lift discipline exists for.
		const container = await renderReady('admin');
		const li = q(container, 'roster-row-m-ada') as HTMLElement;
		const wrapper = pickerWrapper(container, 'm-ada');
		const classes = wrapper.className.split(/\s+/);
		expect(classes).toContain('absolute');
		expect(classes).toContain('top-1');
		expect(classes).toContain('right-1');
		// NO z-index — positioned + written after the activator wins by tree
		// order; a z-index would make the wrapper a stacking context and trap
		// the picker's own `absolute z-10` menu under the following rows (#302 F1).
		expect(classes.some((c) => c.startsWith('z-'))).toBe(false);
		// The <li> is already `relative` (the activator's containing block) —
		// the corner offsets anchor to IT; no second positioned wrapper appears.
		expect(li.className.split(/\s+/)).toContain('relative');
		const card = q(container, 'roster-row-card-m-ada') as HTMLElement;
		expect(card, 'collapsed card activator').not.toBeNull();
		expect(
			card.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the lifted picker wrapper must FOLLOW the activator in tree order'
		).toBeTruthy();
		expect(li.contains(card)).toBe(true);
		expect(li.contains(wrapper)).toBe(true);
	});

	it('a row WITHOUT the picker still shows the section name in rowInfo (flat view) — the information is already on screen; nothing else on the card moves', async () => {
		loadRosterMock.mockResolvedValue(toListRead(gateRows()));
		const container = await renderReady('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle') as HTMLElement);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		const li = q(container, 'roster-row-m-foreign') as HTMLElement;
		expect(li).not.toBeNull();
		const section = li.querySelector('[data-testid="roster-row-section"]');
		expect(section, 'section name text stays in rowInfo').not.toBeNull();
		expect(section?.textContent).toContain('Alto');
		expect(li.querySelector('[data-testid="section-picker-trigger-m-foreign"]')).toBeNull();
	});
});

// ── per-tap assign: optimistic move, reconcile, revert ─────────────────────────

describe('/roster — tap assigns per-tap with optimistic-and-reconcile', () => {
	it('unassigned member + tap a section → assignMemberSection(cfg, memberId, sectionId) fires; the row moves into that group IMMEDIATELY (write still pending); on success it STAYS and loadRoster is NOT refetched; menu closed', async () => {
		const write = deferred<void>();
		assignMock.mockReturnValue(write.promise);
		const container = await renderReady('admin');

		await openPicker(container, 'm-pete');
		await fireEvent.click(q(container, 'section-picker-option-sec-alto') as HTMLElement);

		expect(assignMock).toHaveBeenCalledTimes(1);
		expect(assignMock).toHaveBeenCalledWith(CFG, 'm-pete', 'sec-alto');

		// OPTIMISTIC — the write has not resolved yet, and the row already moved.
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]')
			).not.toBeNull();
		});
		expect(
			q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-pete"]') ??
				null
		).toBeNull();
		expect(q(container, 'section-picker-menu-m-pete')).toBeNull();

		// RECONCILE on success — it stays, and nothing re-fetches the world.
		write.resolve();
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]')
			).not.toBeNull();
		});
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('assign FAILURE → the row REVERTS to its original group and the failure is logged (optimistic never silently sticks)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const write = deferred<void>();
		assignMock.mockReturnValue(write.promise);
		const container = await renderReady('admin');

		await openPicker(container, 'm-pete');
		await fireEvent.click(q(container, 'section-picker-option-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]')
			).not.toBeNull();
		});

		write.reject(new Error('assign boom'));
		await waitFor(() => {
			expect(
				q(container, 'section-group-unassigned')?.querySelector(
					'[data-testid="roster-row-m-pete"]'
				)
			).not.toBeNull();
		});
		// Palestrina/GREEN fix: the revert's `rows` write is a single, correct,
		// synchronous state update (verified directly — the reverted `rows`/
		// `groups` are right the instant the catch runs); the unassigned-group
		// MOUNT (`{#if unassignedGroup}`, previously absent) and the sec-alto
		// LIST SHRINK are two effects off that one update, and this harness
		// (Svelte 5 + happy-dom + testing-library) can observe them settle one
		// mutation-observer tick apart. Wrapped in its own `waitFor` rather than
		// asserted bare, same as the mount-detection waitFor just above —
		// tolerates that harness-level lag without weakening what's checked.
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]') ??
					null
			).toBeNull();
		});
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('assigning a SECOND section ADDS membership (multi-section, never replaces): Ada (Soprano) + tap Alto → she renders in BOTH groups; unassignMemberSection NOT called', async () => {
		const container = await renderReady('admin');

		await openPicker(container, 'm-ada');
		await fireEvent.click(q(container, 'section-picker-option-sec-alto') as HTMLElement);

		expect(assignMock).toHaveBeenCalledWith(CFG, 'm-ada', 'sec-alto');
		expect(unassignMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-ada"]')
			).not.toBeNull();
		});
		// STILL in Soprano — assignment appends a membership, it does not move her.
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]')
		).not.toBeNull();
	});
});

// ── toggle-unassign and "(Unassigned)" ──────────────────────────────────────────

describe('/roster — tapping a CURRENT section unassigns it; "(Unassigned)" removes ALL section parents', () => {
	it('tap the already-assigned section → unassignMemberSection(cfg, memberId, thatSectionId); the row leaves the group and (now section-less) lands in Unassigned', async () => {
		const container = await renderReady('admin');

		await openPicker(container, 'm-ada');
		await fireEvent.click(q(container, 'section-picker-option-sec-sop') as HTMLElement);

		expect(unassignMock).toHaveBeenCalledTimes(1);
		expect(unassignMock).toHaveBeenCalledWith(CFG, 'm-ada', 'sec-sop');
		expect(assignMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(
				q(container, 'section-group-unassigned')?.querySelector(
					'[data-testid="roster-row-m-ada"]'
				)
			).not.toBeNull();
		});
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]') ??
				null
		).toBeNull();
	});

	it('multi-section member + tap "(Unassigned)" → unassignMemberSection fires ONCE PER current section; the row ends up ONLY in Unassigned', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			...fixtureRows(),
			{
				memberId: 'm-multi',
				personId: 'p-multi',
				name: 'Mia Multi',
				email: 'mia@x.com',
				sectionIds: ['sec-sop', 'sec-alto'],
				ownerIds: ['person-db-owner', 'person-p']
			}
		]));
		const container = await renderReady('admin');

		await openPicker(container, 'm-multi');
		await fireEvent.click(q(container, 'section-picker-option-unassigned') as HTMLElement);

		const calls = unassignMock.mock.calls.map((c) => [c[1], c[2]]).sort();
		expect(calls).toEqual([
			['m-multi', 'sec-alto'],
			['m-multi', 'sec-sop']
		]);
		for (const call of unassignMock.mock.calls) expect(call[0]).toEqual(CFG);
		expect(assignMock).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(
				q(container, 'section-group-unassigned')?.querySelector(
					'[data-testid="roster-row-m-multi"]'
				)
			).not.toBeNull();
		});
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-multi"]') ??
				null
		).toBeNull();
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-multi"]') ??
				null
		).toBeNull();
	});
});

// ── code-review fixes: targeted reconcile + degraded-tree gate ─────────────────

describe('/roster — F1 code-review fix: a revert undoes ONLY the membership its own call owned', () => {
	it('"(Unassigned)" with a PARTIAL failure → only the section whose unassign REJECTED comes back; the one that succeeded stays gone (no whole-snapshot restore)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockResolvedValue(toListRead([
			...fixtureRows(),
			{
				memberId: 'm-multi',
				personId: 'p-multi',
				name: 'Mia Multi',
				email: 'mia@x.com',
				sectionIds: ['sec-sop', 'sec-alto'],
				ownerIds: ['person-db-owner', 'person-p']
			}
		]));
		// Soprano 403s, Alto succeeds — the server ends up holding Soprano only.
		unassignMock.mockImplementation((_cfg, _memberId, sectionId) =>
			sectionId === 'sec-sop' ? Promise.reject(new Error('403')) : Promise.resolve()
		);
		const container = await renderReady('admin');

		await openPicker(container, 'm-multi');
		await fireEvent.click(q(container, 'section-picker-option-unassigned') as HTMLElement);

		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-multi"]')
			).not.toBeNull();
		});
		// The successful unassign is NOT undone, and she is no longer section-less.
		expect(
			q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-multi"]') ??
				null
		).toBeNull();
		expect(
			q(container, 'section-group-unassigned')?.querySelector(
				'[data-testid="roster-row-m-multi"]'
			) ?? null
		).toBeNull();
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('two concurrent taps on ONE member: the first tap FAILING must not discard the second tap`s already-persisted assignment', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const first = deferred<void>();
		assignMock.mockImplementation((_cfg, _memberId, sectionId) =>
			sectionId === 'sec-alto' ? first.promise : Promise.resolve()
		);
		const container = await renderReady('admin');

		// Tap A — Alto (write left pending).
		await openPicker(container, 'm-pete');
		await fireEvent.click(q(container, 'section-picker-option-sec-alto') as HTMLElement);
		// Tap B — Soprano, resolves immediately.
		await openPicker(container, 'm-pete');
		await fireEvent.click(q(container, 'section-picker-option-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-pete"]')
			).not.toBeNull();
		});

		// Tap A now fails: Alto must go, Soprano must SURVIVE.
		first.reject(new Error('assign boom'));
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-pete"]') ??
					null
			).toBeNull();
		});
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-pete"]')
		).not.toBeNull();
		expect(
			q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-pete"]') ??
				null
		).toBeNull();
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe('/roster — F2 code-review fix: no picker while the section tree is unreadable', () => {
	it('sections load REJECTS → admin sees the flat list + banner but NO picker trigger (its only reachable option would be the destructive clear-all)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listSectionsMock.mockRejectedValue(new Error('sections boom'));
		setAuthedWithOneCollective();
		adminStore.set('admin');

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-sections-load-error"]')).not.toBeNull();
		expect(container.querySelector('[data-testid^="section-picker-trigger-"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('/roster — F1(b) code-review fix: "membership already gone server-side" reconciles FORWARD, never reverts', () => {
	it('toggle-unassign rejecting with SectionMembershipMissingError → the removal STICKS (server and UI already agree) and is logged; reverting would pin a phantom membership on a page that never refetches', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		unassignMock.mockRejectedValue(new SectionMembershipMissingError('m-ada', 'sec-sop'));
		const container = await renderReady('admin');

		await openPicker(container, 'm-ada');
		await fireEvent.click(q(container, 'section-picker-option-sec-sop') as HTMLElement);

		await waitFor(() => {
			expect(
				q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-ada"]')
			).not.toBeNull();
		});
		// Still gone from Soprano AFTER the rejection settled — no addBack.
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]') ??
					null
			).toBeNull();
		});
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('a REAL unassign failure (403) still REVERTS — the forward-reconcile branch must not swallow genuine write failures', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		unassignMock.mockRejectedValue(new Error('403'));
		const container = await renderReady('admin');

		await openPicker(container, 'm-ada');
		await fireEvent.click(q(container, 'section-picker-option-sec-sop') as HTMLElement);

		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-ada"]')
			).not.toBeNull();
		});
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('"(Unassigned)": a section whose unassign says ALREADY-GONE does not come back, while a genuinely failing one does', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockResolvedValue(toListRead([
			...fixtureRows(),
			{
				memberId: 'm-multi',
				personId: 'p-multi',
				name: 'Mia Multi',
				email: 'mia@x.com',
				sectionIds: ['sec-sop', 'sec-alto'],
				ownerIds: ['person-db-owner', 'person-p']
			}
		]));
		// Soprano: already gone server-side (stale row). Alto: a real 403.
		unassignMock.mockImplementation((_cfg, memberId, sectionId) =>
			sectionId === 'sec-sop'
				? Promise.reject(new SectionMembershipMissingError(memberId, sectionId))
				: Promise.reject(new Error('403'))
		);
		const container = await renderReady('admin');

		await openPicker(container, 'm-multi');
		await fireEvent.click(q(container, 'section-picker-option-unassigned') as HTMLElement);

		// Alto's write genuinely failed → back it comes.
		await waitFor(() => {
			expect(
				q(container, 'section-group-sec-alto')?.querySelector('[data-testid="roster-row-m-multi"]')
			).not.toBeNull();
		});
		// Soprano was already absent server-side → it stays off the row.
		expect(
			q(container, 'section-group-sec-sop')?.querySelector('[data-testid="roster-row-m-multi"]') ??
				null
		).toBeNull();
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe('/roster — F2 code-review fix: only one picker menu is ever on screen', () => {
	it("opening member B's picker CLOSES member A's (absolutely-positioned menus must not stack over neighbouring rows)", async () => {
		const container = await renderReady('admin');

		await openPicker(container, 'm-ada');
		expect(q(container, 'section-picker-menu-m-ada')).not.toBeNull();

		await openPicker(container, 'm-bea');

		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-ada')).toBeNull();
		});
		expect(q(container, 'section-picker-menu-m-bea')).not.toBeNull();
		// Nothing was written — dismissal is non-destructive.
		expect(assignMock).not.toHaveBeenCalled();
		expect(unassignMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — TS.2/#96 RED)
// (*MVOX:Palestrina* — GREEN fix: wrap the revert's sec-alto assertion in its own
// waitFor, tolerating a one-tick harness lag between the unassigned-group mount
// and the sec-alto list shrink; see comment at the assertion, TS.2/#96)
// (*MVOX:Tallis* — #468 RED: owner gate replaces the admin gate; corner-position
// pin; fixtures carry per-member ownerIds)
