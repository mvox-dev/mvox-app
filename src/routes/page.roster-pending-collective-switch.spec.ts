// @vitest-environment happy-dom
//
// #287 RED — `removePending` / `deactivatePending` survive a collective switch
// (the #260 class, on the roster's write flags).
//
// The route-load `reset` callback clears the ARMED ids (`pendingRemoveId`,
// `pendingDeactivateId`) and their error slots on every switch — but neither
// in-flight FLAG. And neither handler's `finally` is generation-guarded. Three
// distinct consequences, each pinned here:
//
//   (1) STALE DISABLE — a write held on collective A keeps its flag true
//       through the switch, so collective B's controls render disabled (and,
//       for remove, undraggable via `structuralWritePending`) from FIRST
//       PAINT, for a write B never started.
//   (2) CROSS-COLLECTIVE ANNOUNCEMENT (remove only) — the success branch
//       writes `removeStatus = roster_section_removed({name})` with no
//       generation check at all: A's delete settling after the switch
//       announces A's section into B's live region. (Deactivate has NO
//       success announcement — its exposure is the disabled/aria-busy half
//       only, pinned in (1)/(3).)
//   (3) LATE-SETTLE CLOBBER — clearing the flags on switch is NOT enough on
//       its own: A's stale promise can settle AFTER a genuine new write has
//       started on B, and an unguarded `finally` clobbers B's live flag back
//       to false — re-enabling B's controls mid-write and reopening the
//       double-submit window #273/#286 closed. The stale success also nulls
//       the armed id, unmounting B's own armed pair mid-write.
//
// House method for timing proofs (#259's deterministic race construction):
// the WRITE mock itself is release-controlled — hold → switch → (arm B) →
// settle. No existing spec holds the remove/deactivate WRITE across a switch
// (#259's block holds only the panel RELOAD), which is why this file exists.
// Flags are not exported: every assertion here reads rendered `disabled` /
// `aria-busy` / `draggable` DOM state and mock call counts, never the flags.
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
	reparentMock,
	renameMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn(),
	renameMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn()
}));
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer.
vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
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
	reparentSection: reparentMock,
	renameSection: renameMock
}));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: createInviteMock,
	mintSelfLinkInvite: mintSelfLinkInviteMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
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

// Every member UNASSIGNED: all sections stay empty (deletable — `canDelete`
// needs an empty, childless section) and the rows live under the Unassigned
// group's toggle. All personIds differ from both viewers', so the deactivate
// trigger renders on every row.
function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: 'bea@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B }
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
	renameMock.mockResolvedValue(undefined);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue([]);
	listInactiveMembersMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

// ── house helpers (deferred: page.roster-deactivate.spec.ts; switch/flush:
//    page.roster-arrange-stale-success.spec.ts) ──────────────────────────────

function deferred<T = void>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function removeStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-remove-status')?.textContent ?? '').trim();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

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

async function switchToOtherChoirArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	// Collective B's tree is on screen before anything stale settles.
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-alto')).toBeNull();
}

// Arms sec-tenor's delete on collective A and confirms it into the HELD write.
async function startHeldRemoveOnA(container: HTMLElement) {
	await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
	await waitFor(() => {
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});
}

// ── groups-view helpers for the deactivate flow ─────────────────────────────

async function renderGroupsRoster(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'section-toggle-unassigned')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-toggle-unassigned') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-row-m-ada')).not.toBeNull();
	});
	return container;
}

async function switchToOtherChoirGroups(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	// B's own tree replaces A's before anything stale settles …
	await waitFor(() => {
		expect(q(container, 'section-toggle-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'section-toggle-sec-sop')).toBeNull();
	// … and the switch collapsed the groups: reopen Unassigned to reach Bob.
	await fireEvent.click(q(container, 'section-toggle-unassigned') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-row-m-bob')).not.toBeNull();
	});
}

// Arms the row's deactivate and confirms it into the HELD write (the blocker
// read and the library lookup resolve immediately from the beforeEach mocks).
async function startHeldDeactivate(container: HTMLElement, memberId: string, nthWrite: number) {
	await fireEvent.click(q(container, `member-deactivate-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `member-deactivate-confirm-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `member-deactivate-confirm-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(deactivateMemberMock).toHaveBeenCalledTimes(nthWrite);
	});
}

// ═════════════════════════════════════════════════════════════════════════════

describe('/roster — #287 removePending across a collective switch', () => {
	it("STALE DISABLE: with collective A's delete WRITE still in flight, collective B's structural controls render ENABLED from load — A's unresolved write is not B's business", async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);

		// Switch while the write is held. Pre-fix, `removePending` is still true
		// (the reset callback never clears it), `structuralWritePending` is
		// derived page-wide from it, and every control below renders disabled /
		// undraggable on B from FIRST PAINT.
		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-indent-sec-b2') as HTMLButtonElement).disabled,
			"B's indent control must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			q(container, 'arrange-row-sec-b1')?.getAttribute('draggable'),
			"B's rows must be draggable — no structural write is in flight HERE"
		).toBe('true');

		// Settle A's orphaned write cleanly before teardown.
		gate.resolve();
		await flush();
	});

	it("CROSS-COLLECTIVE ANNOUNCEMENT: A's delete SUCCESS settling after the switch leaves roster-section-remove-status EMPTY — it must not name A's section into B's live region", async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);
		await switchToOtherChoirArrange(container);

		gate.resolve();
		await flush();

		// THE pin: pre-fix the success branch writes
		// `removeStatus = roster_section_removed({name: 'Tenor'})` with no
		// generation check at all — a screen-reader user standing in collective
		// B is told a section of collective A was removed.
		expect(removeStatusText(container)).toBe('');
		// …and B's tree is untouched by the stale settle.
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
	});

	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new delete has started on B — B's armed pair stays mounted, stays disabled, and B's write cannot double-fire", async () => {
		const gateA = deferred();
		const gateB = deferred();
		deleteMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);
		await switchToOtherChoirArrange(container);

		// Precondition (= the STALE DISABLE pin): B's trigger must be usable at
		// all, or no genuine write can ever start here.
		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must be enabled after the switch"
		).toBe(false);

		// A GENUINE new write on B, held on its own gate.
		await fireEvent.click(q(container, 'section-remove-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-b2')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(2);
		});

		// NOW A's stale promise settles. An unguarded `finally` would clobber
		// B's live flag back to false; the unguarded success branch would null
		// the armed id (unmounting B's own armed pair mid-write) and announce
		// A's section. All three must not happen.
		gateA.resolve();
		await flush();

		const confirmB = q(container, 'section-remove-confirm-sec-b2') as HTMLButtonElement | null;
		expect(confirmB, "B's armed pair must survive A's stale settle").not.toBeNull();
		expect(confirmB!.disabled, "B's write is STILL in flight — confirm stays disabled").toBe(true);
		expect(confirmB!.getAttribute('aria-busy')).toBe('true');
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's structural controls stay frozen while B's own write is in flight"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b1')?.getAttribute('draggable')).toBe('false');
		expect(removeStatusText(container)).toBe('');

		// Double-submit probe on the (still-mounted) confirm: nothing fires.
		await fireEvent.click(confirmB!);
		confirmB!.click();
		await flush();
		expect(deleteMock).toHaveBeenCalledTimes(2);

		// B's own write completes HONESTLY: announced with B's section name,
		// controls released. (Trap detector: an over-broad guard — e.g. a
		// generation consumed by A's settle — would leave B frozen forever.)
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(removeStatusText(container)).toContain('roster_section_removed');
		expect(removeStatusText(container)).toContain('Bass II');
		expect(removeStatusText(container)).not.toContain('Tenor');
		expect(deleteMock).toHaveBeenCalledTimes(2);
	});
});

describe('/roster — #287 deactivatePending across a collective switch', () => {
	it("STALE DISABLE: with collective A's deactivate WRITE still in flight, collective B's deactivate trigger renders ENABLED from load", async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const container = await renderGroupsRoster();

		await startHeldDeactivate(container, 'm-ada', 1);
		await switchToOtherChoirGroups(container);

		// Pre-fix `deactivatePending` is still true (never cleared on switch),
		// so Bob's trigger — `disabled={deactivatePending}` — renders disabled
		// from first paint, falsely signalling an in-flight operation that was
		// never started in this collective. There is no armed pair on B
		// (`pendingDeactivateId` IS reset), so the trigger is the whole surface.
		expect(
			(q(container, 'member-deactivate-m-bob') as HTMLButtonElement).disabled,
			"B's deactivate trigger must not be disabled by A's in-flight write"
		).toBe(false);

		gate.resolve();
		await flush();
	});

	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new deactivate has started on B — B's armed pair stays mounted, disabled and aria-busy; no double-fire; B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		deactivateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderGroupsRoster();

		await startHeldDeactivate(container, 'm-ada', 1);
		await switchToOtherChoirGroups(container);

		// Precondition (= the STALE DISABLE pin).
		expect(
			(q(container, 'member-deactivate-m-bob') as HTMLButtonElement).disabled,
			"B's deactivate trigger must be enabled after the switch"
		).toBe(false);

		// A GENUINE new deactivate on B, held on its own gate.
		await startHeldDeactivate(container, 'm-bob', 2);

		// A's stale promise settles. An unguarded settle would (a) null the
		// armed id — unmounting B's confirm/cancel pair mid-write — and (b) via
		// the unguarded `finally`, flip `deactivatePending` back to false,
		// re-enabling B's armed pair while B's write is still in flight.
		gateA.resolve();
		await flush();

		const confirmB = q(container, 'member-deactivate-confirm-m-bob') as HTMLButtonElement | null;
		expect(confirmB, "B's armed pair must survive A's stale settle").not.toBeNull();
		expect(confirmB!.disabled, "B's write is STILL in flight — confirm stays disabled").toBe(true);
		expect(confirmB!.getAttribute('aria-busy')).toBe('true');
		expect(
			(q(container, 'member-deactivate-cancel-m-bob') as HTMLButtonElement).disabled
		).toBe(true);

		// Double-submit probe: a second tap on the still-mounted confirm must
		// not fire a third write.
		await fireEvent.click(confirmB!);
		confirmB!.click();
		await flush();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(2);

		// B's own write completes HONESTLY: Bob leaves the roster via B's own
		// refetch and the pair disarms. (Trap detector: if A's stale settle was
		// allowed to bump the generation — e.g. by running its unguarded
		// `loadForSelected()` — B's guarded success path would read stale and
		// Bob's row would never leave.)
		loadRosterMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'polyphony' ? rowsA() : [])
		);
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect(q(container, 'roster-row-m-bob')).toBeNull();
		});
		expect(q(container, 'member-deactivate-confirm-m-bob')).toBeNull();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(2);
	});
});

// (*MVOX:Tallis* — #287 RED, house deterministic-race method per #259/#264;
//  held-WRITE-across-switch construction new here, fixtures/switch driver from
//  page.roster-arrange-stale-success.spec.ts, deferred from
//  page.roster-deactivate.spec.ts)
