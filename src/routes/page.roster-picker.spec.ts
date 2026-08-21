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
//   - ADMIN GATE: the picker trigger renders on member rows ONLY when
//     `$adminStore === 'admin'` ($lib/nav/adminStore — resolved by the root
//     layout). 'not-admin', 'loading' and 'error' all hide it — FAIL CLOSED.
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
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

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] },
		{ memberId: 'm-carol', personId: 'p-carol', name: 'Carol Williams', email: 'carol@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
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

// ── admin gate ──────────────────────────────────────────────────────────────────

describe('/roster — picker admin gate (integration: actual page route)', () => {
	it('admin: EVERY member row carries its section-picker trigger, INSIDE the row element', async () => {
		const container = await renderReady('admin');
		for (const id of ['m-ada', 'm-bea', 'm-carol', 'm-eva', 'm-pete']) {
			const row = q(container, `roster-row-${id}`);
			expect(row, `row ${id}`).not.toBeNull();
			expect(
				row?.querySelector(`[data-testid="section-picker-trigger-${id}"]`),
				`trigger inside row ${id}`
			).not.toBeNull();
		}
	});

	it.each(['not-admin', 'loading', 'error'] as const)(
		'%s: NO picker trigger anywhere — read-only roster, fail closed on unresolved/errored rights',
		async (state) => {
			const container = await renderReady(state);
			expect(container.querySelector('[data-testid^="section-picker-trigger-"]')).toBeNull();
		}
	);
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
		loadRosterMock.mockResolvedValue([
			...fixtureRows(),
			{
				memberId: 'm-multi',
				personId: 'p-multi',
				name: 'Mia Multi',
				email: 'mia@x.com',
				sectionIds: ['sec-sop', 'sec-alto']
			}
		]);
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
		loadRosterMock.mockResolvedValue([
			...fixtureRows(),
			{
				memberId: 'm-multi',
				personId: 'p-multi',
				name: 'Mia Multi',
				email: 'mia@x.com',
				sectionIds: ['sec-sop', 'sec-alto']
			}
		]);
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
		loadRosterMock.mockResolvedValue([
			...fixtureRows(),
			{
				memberId: 'm-multi',
				personId: 'p-multi',
				name: 'Mia Multi',
				email: 'mia@x.com',
				sectionIds: ['sec-sop', 'sec-alto']
			}
		]);
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
