// @vitest-environment happy-dom
//
// #296 RED — the remaining roster write-flags and error slots survive a
// collective switch (the #260 class; #287's named siblings, plus the two
// ungated siblings folded in by the scope amendment,
// #296 issuecomment-5594599579).
//
// Five state slots, three functions — NOT one case five times:
//
//   `reorderPending`   — absent from `reset`, and both writers' `finally`
//                        blocks (`performReorder`, `performReparent`) clear it
//                        unconditionally. Every OTHER write branch in those two
//                        functions is already generation-guarded (#264 item 4),
//                        so only the switch-clear and the finally-clobber are
//                        pinned here.
//   `reorderError`     — (amendment) IS cleared in `reset`, but both writers'
//                        catch blocks set it with no generation check. It is a
//                        PAGE-LEVEL `role="alert"` banner, so a stale failure
//                        settling after a switch paints "the order couldn't be
//                        saved" over a collective that saved nothing.
//   `reinstatePending` — absent from `reset`, and `handleReinstate` has NO
//                        generation capture at all — neither its `finally` nor
//                        its catch has any protection to lean on. It holds a
//                        memberId (not a boolean): every reinstate button on
//                        the page disables off `reinstatePending !== null`.
//   `deactivateActionError` — IS cleared in `reset`, but both writer catches
//                        (`handleDeactivateConfirm`'s and `handleReinstate`'s)
//                        are ungated. Row-scoped alerts, so the stale write's
//                        harm is a CLOBBER: it overwrites the slot out from
//                        under a GENUINE failure alert standing on the new
//                        collective, unmounting it.
//   `deactivateRefusal` — (amendment) IS cleared in `reset`, but the REFUSAL
//                        branch of `handleDeactivateConfirm` — the designed
//                        non-error outcome for a member holding a grant —
//                        writes it inside the `try`, after two awaits, with no
//                        check, even though `gEntry` is captured at a usable
//                        scope in that same function. Row-scoped and co-gated
//                        on `pendingDeactivateId`, so again the observable
//                        harm is the CLOBBER of a live refusal on B.
//
// Row-scoped vs page-level decides the assertion shape (#296 pin 1): the
// page-level `reorderError` banner is pinned ABSENT after a stale failure; the
// row-scoped deactivate/reinstate alerts are pinned as B's OWN live alert
// SURVIVING a stale settle (a stale write carries A's memberId, which no B row
// matches, so absence alone would pass pre-fix and prove nothing).
//
// House method for timing proofs (#259's deterministic race construction): the
// WRITE mock itself is release-controlled — hold → switch → (act on B) →
// settle. Flags are not exported: every assertion reads rendered `disabled` /
// `draggable` / alert presence / live-region text and mock call counts.
// Held-write-across-switch construction from
// page.roster-pending-collective-switch.spec.ts (#287, the worked example);
// keyboard-reorder driver from page.roster-arrange-stale-success.spec.ts.
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
	mintSelfLinkInviteMock,
	loadMemberRecordMock
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
	mintSelfLinkInviteMock: vi.fn(),
	loadMemberRecordMock: vi.fn()
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
// #302 — opening a card runs the editor's record lookup; resolve it so the
// editor (and the deactivate controls now inside it) can mount.
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: loadMemberRecordMock
}));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { resolveMyLibraryId, resolveLibrarian } from '$lib/library/librarianStore';
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

// Every member UNASSIGNED: rows live under the Unassigned toggle, and all
// personIds differ from both viewers', so the deactivate trigger renders.
function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B }
	];
}

// Disjoint INACTIVE panels — the reinstate surface. Ids never collide across
// collectives, which is exactly why absence-of-A's-alert-on-B proves nothing
// and the clobber construction below is the real pin.
function inactiveA(): RosterRow[] {
	return [
		{ memberId: 'm-ina', personId: 'p-ina', name: 'Ina Gone', email: 'ina@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function inactiveB(): RosterRow[] {
	return [
		{ memberId: 'm-inb', personId: 'p-inb', name: 'Benno Gone', email: 'benno@x.com', sectionIds: [], dbEntityId: ORG_B }
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
	loadInactiveRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'polyphony' ? inactiveA() : inactiveB())
	);
	listInactiveMembersMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
	vi.mocked(resolveLibrarian).mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanup();
	// resetAllMocks, NOT clearAllMocks: several tests here queue
	// `mockImplementationOnce` gates and then — pre-fix, by design — abort at a
	// failed precondition before the queued call ever fires. `clearAllMocks`
	// keeps unconsumed once-implementation queues, so the NEXT test's first
	// call would silently receive the previous test's never-settled gate and
	// freeze mid-write, turning that test into a false pass (observed: this
	// file's performReorder-catch test went green off the finally-clobber
	// test's leftover gate). `resetAllMocks` drops the queues; the beforeEach
	// above re-installs every default implementation.
	vi.resetAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

// ── house helpers ───────────────────────────────────────────────────────────

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

function reorderStatusText(container: HTMLElement): string {
	return (q(container, 'roster-reorder-status')?.textContent ?? '').trim();
}

function rowOrder(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="arrange-row-"]')].map(
		(el) => el.getAttribute('data-testid') ?? ''
	);
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

// Keyboard reorder (grab → down one slot → drop): the pure-`performReorder`
// driver. `nthWrite` pins WHICH reorderSections call this drop is.
async function keyboardMoveDown(container: HTMLElement, rowId: string, nthWrite: number) {
	let target = q(container, `arrange-row-${rowId}`) as HTMLElement;
	target.focus();
	await fireEvent.keyDown(target, { key: 'Enter' });
	await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
	await fireEvent.keyDown(target, { key: 'ArrowDown' });
	target = q(container, `arrange-row-${rowId}`) as HTMLElement;
	await fireEvent.keyDown(target, { key: 'Enter' });
	await waitFor(() => {
		expect(reorderMock).toHaveBeenCalledTimes(nthWrite);
	});
}

// ── groups-view render + switch (deactivate/reinstate flows) ────────────────

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

// Opens the inactive panel and waits for the named row's reinstate button.
// The switch reset closes and empties the panel (isSwitch-gated), so this runs
// once per collective.
async function openInactivePanel(container: HTMLElement, memberId: string) {
	await fireEvent.click(q(container, 'roster-inactive-toggle') as HTMLElement);
	await waitFor(() => {
		expect(q(container, `member-reinstate-${memberId}`)).not.toBeNull();
	});
}

// #302 drive-path step (Gama's on-issue ruling): the deactivate controls
// render inside the OPENED record editor, so reaching them takes an
// open-the-card step first. Idempotent — an already-open editor is left alone.
async function openCard(container: HTMLElement, memberId: string) {
	const li = q(container, `roster-row-${memberId}`);
	expect(li, `roster-row-${memberId} must render`).not.toBeNull();
	if (li!.querySelector('[data-testid="roster-record-name"]')) return; // already open
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `#302: collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card as HTMLElement);
	await waitFor(() => {
		expect(
			q(container, `roster-row-${memberId}`)!.querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull();
	});
}

// Arms the row's deactivate and confirms it (blocker read + library lookup
// resolve from the beforeEach mocks unless a test holds them itself).
// #302 drive-path edit: opens the row's card first — the trigger lives inside
// the opened editor now. Everything the helper CLAIMS is unchanged.
async function armAndConfirmDeactivate(container: HTMLElement, memberId: string) {
	await openCard(container, memberId);
	await fireEvent.click(q(container, `member-deactivate-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `member-deactivate-confirm-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `member-deactivate-confirm-${memberId}`) as HTMLElement);
}

// ═════════════════════════════════════════════════════════════════════════════

describe('/roster — #296 reorderPending across a collective switch', () => {
	it("STALE DISABLE / CLEARED ON SWITCH: with collective A's reorder WRITE still in flight, collective B renders NO busy region and its structural controls are enabled — A's unresolved write is not B's business", async () => {
		const gate = deferred();
		reorderMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await keyboardMoveDown(container, 'sec-sop', 1);
		await switchToOtherChoirArrange(container);

		// Pre-fix `reorderPending` is still true (the reset callback never
		// clears it — unlike `reorderError`/`reorderStatus` three lines above it
		// in the same callback): the page-level "moving…" status region renders
		// on B from first paint, and `structuralWritePending` (derived from the
		// flag) disables/undrags every structural control across B's whole tree.
		expect(
			q(container, 'section-reorder-pending'),
			"B must not render A's in-flight busy region"
		).toBeNull();
		expect(
			(q(container, 'arrange-indent-sec-b2') as HTMLButtonElement).disabled,
			"B's indent control must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			q(container, 'arrange-row-sec-b1')?.getAttribute('draggable'),
			"B's rows must be draggable — no structural write is in flight HERE"
		).toBe('true');

		// Settle A's orphaned write cleanly before teardown.
		gate.resolve();
		await flush();
	});

	it("LATE-SETTLE CLOBBER (performReorder finally): A's stale reorder settles AFTER a genuine reorder has started on B — B's busy state survives, B's controls stay frozen, no third write can fire", async () => {
		const gateA = deferred();
		const gateB = deferred();
		reorderMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await keyboardMoveDown(container, 'sec-sop', 1);
		await switchToOtherChoirArrange(container);

		// Precondition (= the STALE DISABLE pin): B must be usable at all, or no
		// genuine write can ever start here.
		expect(
			q(container, 'section-reorder-pending'),
			"precondition: B renders no busy region after the switch"
		).toBeNull();

		// A GENUINE reorder on B, held on its own gate.
		await keyboardMoveDown(container, 'sec-b1', 2);

		// NOW A's stale promise settles (success — its success branch is already
		// guarded, #264). The unguarded `finally` would clobber B's live
		// `reorderPending` back to false: busy region unmounts, B's structural
		// controls re-enable mid-write, single-flight is broken.
		gateA.resolve();
		await flush();

		expect(
			q(container, 'section-reorder-pending'),
			"B's write is STILL in flight — the busy region must survive A's stale settle"
		).not.toBeNull();
		// #296 GREEN correction: B's own keyboard move already committed the
		// OPTIMISTIC reorder [Bass II, Bass I] the instant ArrowDown was
		// pressed (before this drop's write even settles) — `sec-b2` is now
		// FIRST and so has no previous sibling to nest under, `canIndent`
		// alone disables its indent button forever after this move, whatever
		// `reorderPending` holds. `sec-b1` (now SECOND) is the row whose
		// indent-disabled state actually tracks the pending flag — probe that
		// one, both here and below.
		expect(
			(q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled,
			"B's structural controls stay frozen while B's own write is in flight"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b1')?.getAttribute('draggable')).toBe('false');

		// Double-submit probe: an indent tapped now must be refused by the
		// single-flight gate, not start a concurrent structural write.
		await fireEvent.click(q(container, 'arrange-indent-sec-b1') as HTMLElement);
		(q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).click();
		await flush();
		expect(reparentMock).not.toHaveBeenCalled();

		// B's own write completes HONESTLY: announced with B's section, controls
		// released. (Trap detector: an over-broad guard — e.g. one consumed by
		// A's settle — would leave B frozen forever.)
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(q(container, 'section-reorder-pending')).toBeNull();
		// #296 GREEN correction: the KEYBOARD drop path's committed announcement
		// is `roster_section_dropped`, not `roster_section_moved` — `moved` is
		// the PROVISIONAL word this same drop already spoke on the ArrowDown
		// press (`toggleGrab`'s own comment above it), and the commit
		// deliberately overwrites it with the "saved" wording so the two never
		// read as the same thing (page.roster-arrange-stale-success.spec.ts's
		// own comment names this explicitly). `roster_section_moved` is the
		// DRAG path's committed word, not this keyboard driver's.
		expect(reorderStatusText(container)).toContain('roster_section_dropped');
		expect(reorderStatusText(container)).toContain('Bass I');
		expect(reorderStatusText(container)).not.toContain('Soprano');
		expect(reorderMock).toHaveBeenCalledTimes(2);
	});

	it("LATE-SETTLE CLOBBER (performReparent finally): A's stale reparent settles AFTER a genuine reorder has started on B — B's busy state survives and B completes honestly", async () => {
		const gateA = deferred();
		reparentMock.mockImplementation(() => gateA.promise);
		const gateB = deferred();
		reorderMock.mockImplementation(() => gateB.promise);
		const container = await renderInArrangeMode();

		// Indent Alto under Soprano on collective A; the reparent write is held.
		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		// Precondition (= the STALE DISABLE pin, reparent-writer flavour).
		expect(
			q(container, 'section-reorder-pending'),
			"precondition: B renders no busy region after the switch"
		).toBeNull();

		// A GENUINE reorder on B, held on its own gate.
		await keyboardMoveDown(container, 'sec-b1', 1);

		// A's stale reparent settles (success). Its success branch bails at the
		// guarded checkpoint (no follow-up renumber — already pinned by #264),
		// but the unguarded `finally` still clobbers B's live flag.
		gateA.resolve();
		await flush();

		expect(
			q(container, 'section-reorder-pending'),
			"B's write is STILL in flight — the busy region must survive A's stale reparent settle"
		).not.toBeNull();
		// #296 GREEN correction: same as the performReorder-finally test above
		// — B's keyboard move already committed [Bass II, Bass I] optimistically,
		// so `sec-b2` (now first) is structurally un-indentable regardless of
		// `reorderPending`. `sec-b1` (now second) is the row whose
		// indent-disabled state actually tracks the pending flag.
		expect(
			(q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled,
			"B's structural controls stay frozen while B's own write is in flight"
		).toBe(true);

		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(reorderStatusText(container)).toContain('Bass I');
		// A's guarded success never fired its renumber: B's drop owns the only
		// reorderSections call; A's held reparent stays the only reparent call.
		expect(reorderMock).toHaveBeenCalledTimes(1);
		expect(reparentMock).toHaveBeenCalledTimes(1);
	});
});

describe('/roster — #296 amendment: reorderError catch-writes across a collective switch', () => {
	it("NO CROSS-COLLECTIVE BANNER (performReorder catch): A's reorder FAILURE settling after the switch paints no page-level failure banner over B, and B's tree is untouched", async () => {
		const gate = deferred();
		reorderMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await keyboardMoveDown(container, 'sec-sop', 1);
		await switchToOtherChoirArrange(container);

		gate.reject(new Error('write failed'));
		await flush();

		// THE pin: pre-fix the catch sets `reorderError = true` with no
		// generation check, one line above a refetch that IS guarded with the
		// same `g` — so a user standing in collective B reads "the order
		// couldn't be saved" about a collective they have left.
		expect(
			q(container, 'section-reorder-error'),
			"A's stale failure must not raise the page-level reorder banner over B"
		).toBeNull();
		expect(reorderStatusText(container)).toBe('');
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
	});

	it("NO CROSS-COLLECTIVE BANNER (performReparent catch): A's reparent FAILURE settling after the switch paints no page-level failure banner over B", async () => {
		const gate = deferred();
		reparentMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		await switchToOtherChoirArrange(container);

		gate.reject(new Error('write failed'));
		await flush();

		// Same pin, second writer: `performReparent`'s catch also sets
		// `reorderError = true` (and decides partial/full wording) unguarded.
		expect(
			q(container, 'section-reorder-error'),
			"A's stale reparent failure must not raise the page-level banner over B"
		).toBeNull();
		expect(reorderStatusText(container)).toBe('');
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
		// The failed reparent's guarded refetch/renumber wrote nothing for B:
		// no reorderSections call ever fired.
		expect(reorderMock).not.toHaveBeenCalled();
	});
});

describe('/roster — #296 reinstatePending across a collective switch', () => {
	it("STALE DISABLE / CLEARED ON SWITCH: with collective A's reinstate WRITE still in flight, collective B's reinstate button renders ENABLED — the flag holds A's memberId and must not gate B", async () => {
		const gate = deferred();
		reinstateMemberMock.mockImplementation(() => gate.promise);
		const container = await renderGroupsRoster();

		await openInactivePanel(container, 'm-ina');
		await fireEvent.click(q(container, 'member-reinstate-m-ina') as HTMLElement);
		await waitFor(() => {
			expect(reinstateMemberMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await openInactivePanel(container, 'm-inb');

		// Pre-fix `reinstatePending` still holds 'm-ina' (the reset callback
		// never clears it), and EVERY reinstate button disables off
		// `reinstatePending !== null` — so B's whole inactive panel is dead for
		// the life of A's held write.
		expect(
			(q(container, 'member-reinstate-m-inb') as HTMLButtonElement).disabled,
			"B's reinstate button must not be disabled by A's in-flight write"
		).toBe(false);

		// Settle A's orphaned write cleanly (failure path — no reload side
		// effects) before teardown.
		gate.reject(new Error('write failed'));
		await flush();
	});

	it("LATE-SETTLE CLOBBER: A's stale reinstate settles AFTER a genuine reinstate has started on B — B's button stays disabled, B's write cannot double-fire, and B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		reinstateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderGroupsRoster();

		await openInactivePanel(container, 'm-ina');
		await fireEvent.click(q(container, 'member-reinstate-m-ina') as HTMLElement);
		await waitFor(() => {
			expect(reinstateMemberMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await openInactivePanel(container, 'm-inb');

		// Precondition (= the STALE DISABLE pin).
		expect(
			(q(container, 'member-reinstate-m-inb') as HTMLButtonElement).disabled,
			"B's reinstate button must be enabled after the switch"
		).toBe(false);

		// A GENUINE reinstate on B, held on its own gate.
		await fireEvent.click(q(container, 'member-reinstate-m-inb') as HTMLElement);
		await waitFor(() => {
			expect(reinstateMemberMock).toHaveBeenCalledTimes(2);
		});

		// A's stale promise settles (failure — straight to catch + finally).
		// `handleReinstate` has NO generation capture anywhere: its unguarded
		// `finally` nulls `reinstatePending` out from under B's live write —
		// and because the flag is the memberId-keyed single-flight gate, that
		// both re-enables every reinstate button mid-write AND reopens the
		// double-fire window `reinstateMember`'s atomic-overwrite contract
		// cannot survive (two concurrent runs = duplicated status values).
		gateA.reject(new Error('write failed'));
		await flush();

		const btnB = q(container, 'member-reinstate-m-inb') as HTMLButtonElement;
		expect(
			btnB.disabled,
			"B's write is STILL in flight — its reinstate button stays disabled"
		).toBe(true);

		// Double-submit probe: nothing fires a third write.
		await fireEvent.click(btnB);
		btnB.click();
		await flush();
		expect(reinstateMemberMock).toHaveBeenCalledTimes(2);
		expect(reinstateMemberMock.mock.calls[1][1]).toBe('m-inb');

		// B's own write completes HONESTLY: the panel refreshes to B's new
		// inactive set and its buttons are USABLE again. (Trap detector: a
		// guard that never releases — or a fix that skips clearing the flag on
		// B's own settle — leaves 'm-inb2' dead forever.)
		loadInactiveRosterMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(
				cfg.db === 'polyphony'
					? inactiveA()
					: [{ memberId: 'm-inb2', personId: 'p-inb2', name: 'Berta Gone', email: 'berta@x.com', sectionIds: [], dbEntityId: ORG_B }]
			)
		);
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect(q(container, 'member-reinstate-m-inb2')).not.toBeNull();
		});
		expect((q(container, 'member-reinstate-m-inb2') as HTMLButtonElement).disabled).toBe(false);
		expect(reinstateMemberMock).toHaveBeenCalledTimes(2);
	});
});

describe('/roster — #296 deactivateActionError writer catches across a collective switch', () => {
	it("NO CROSS-COLLECTIVE CLOBBER (handleReinstate's catch): B's OWN reinstate-failure alert survives A's stale reinstate failure settling after the switch", async () => {
		const gateA = deferred();
		reinstateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => Promise.reject(new Error('B write failed')));
		const container = await renderGroupsRoster();

		await openInactivePanel(container, 'm-ina');
		await fireEvent.click(q(container, 'member-reinstate-m-ina') as HTMLElement);
		await waitFor(() => {
			expect(reinstateMemberMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await openInactivePanel(container, 'm-inb');

		// Precondition (= the reinstatePending STALE DISABLE pin — B must be
		// able to act at all).
		expect(
			(q(container, 'member-reinstate-m-inb') as HTMLButtonElement).disabled,
			"B's reinstate button must be enabled after the switch"
		).toBe(false);

		// A GENUINE failure on B: its alert renders — this is the live state
		// the stale settle must not touch.
		await fireEvent.click(q(container, 'member-reinstate-m-inb') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'member-reinstate-failed-m-inb')).not.toBeNull();
		});

		// A's stale failure settles. Pre-fix its unguarded catch writes
		// `deactivateActionError = { memberId: 'm-ina', kind: 'reinstate' }`,
		// CLOBBERING the slot: m-inb's alert unmounts (the render condition
		// matches on memberId), leaving B's failed tap looking like nothing
		// happened — the exact silent-dead-button state #255 F2 closed.
		gateA.reject(new Error('A write failed'));
		await flush();

		expect(
			q(container, 'member-reinstate-failed-m-inb'),
			"B's own failure alert must survive A's stale settle"
		).not.toBeNull();
		// And A's stale failure gained no surface of its own anywhere on B.
		expect(q(container, 'member-reinstate-failed-m-ina')).toBeNull();
	});

	// #302 GUARD-DELETION CHECK (ruled on-issue, REQUIRED at GREEN): after the
	// drive-path edit (armAndConfirmDeactivate now opens the card first),
	// delete the guard this test pins — the generation check on
	// `handleDeactivateConfirm`'s CATCH-write of `deactivateActionError`
	// (roster/+page.svelte, #296) — confirm THIS test FAILS, restore, confirm
	// it passes. Opening editors must not have detached the race from the
	// guard. [GREEN 2026-09-10: guard (line 1203, `if (gEntry !== routeLoad.generation)
	// return;` before the catch-write of `deactivateActionError`) commented
	// out — this test FAILED ("B's own failure alert must survive A's stale
	// settle" — null). Restored — test PASSES.]
	it("NO CROSS-COLLECTIVE CLOBBER (handleDeactivateConfirm's catch): B's OWN deactivate-failure alert survives A's stale deactivate failure settling after the switch", async () => {
		const gateA = deferred();
		deactivateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => Promise.reject(new Error('B write failed')));
		const container = await renderGroupsRoster();

		// Hold A's deactivate WRITE on Ada.
		await armAndConfirmDeactivate(container, 'm-ada');
		await waitFor(() => {
			expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);

		// A GENUINE failure on B: Bob's deactivate fails loudly, the pair stays
		// armed beside the alert for a direct retry (#286).
		await armAndConfirmDeactivate(container, 'm-bob');
		await waitFor(() => {
			expect(q(container, 'member-deactivate-failed-m-bob')).not.toBeNull();
		});

		// A's stale failure settles. This catch DOES have `gEntry` in scope
		// (captured at function entry, already used by the success checkpoint
		// and the finally — #287); only the catch-write itself is unguarded.
		// Pre-fix it clobbers the slot with { memberId: 'm-ada' } and Bob's
		// alert unmounts mid-retry.
		gateA.reject(new Error('A write failed'));
		await flush();

		expect(
			q(container, 'member-deactivate-failed-m-bob'),
			"B's own failure alert must survive A's stale settle"
		).not.toBeNull();
		// The armed retry pair beside it is untouched too.
		expect(q(container, 'member-deactivate-confirm-m-bob')).not.toBeNull();
		expect(q(container, 'member-deactivate-failed-m-ada')).toBeNull();
	});
});

describe('/roster — #296 amendment: deactivateRefusal refusal branch across a collective switch', () => {
	// #302 GUARD-DELETION CHECK (ruled on-issue, REQUIRED at GREEN): after the
	// drive-path edit, delete the guard this test pins — the generation check
	// on the REFUSAL-branch write of `deactivateRefusal` in
	// `handleDeactivateConfirm` (roster/+page.svelte, #296 amendment) —
	// confirm THIS test FAILS, restore, confirm it passes.
	// [GREEN 2026-09-10: guard (line 1137, `if (gEntry !== routeLoad.generation)
	// return;` before the refusal-branch write of `deactivateRefusal`)
	// commented out — this test FAILED ("B's own refusal must survive A's
	// stale refusal settle" — null). Restored — test PASSES.]
	it("NO CROSS-COLLECTIVE CLOBBER (the REFUSAL branch, not the catch): B's OWN grant-holder refusal survives A's stale refusal settling after the switch", async () => {
		// The refusal is the designed NON-ERROR outcome: the blockers read
		// resolves non-empty and the write is refused before it starts. A spec
		// that only drives failures never reaches this write — this test holds
		// the BLOCKERS READ itself (the second await inside the `try`, after
		// which the ungated `deactivateRefusal` write sits).
		const gateA = deferred<{ role: 'admin' | 'librarian' }[]>();
		listDeactivateBlockersMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => Promise.resolve([{ role: 'admin' }]));
		const container = await renderGroupsRoster();

		// Confirm Ada's deactivate on A — held mid-`try` at the blockers read.
		await armAndConfirmDeactivate(container, 'm-ada');
		await waitFor(() => {
			expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);

		// A GENUINE refusal on B: Bob holds an admin grant, the refusal renders
		// naming the remedy, and the pair stays armed beside it.
		await armAndConfirmDeactivate(container, 'm-bob');
		await waitFor(() => {
			expect(q(container, 'member-deactivate-refused-m-bob')).not.toBeNull();
		});

		// A's held blockers read now resolves NON-EMPTY: the stale run reaches
		// the refusal branch. Pre-fix that branch writes
		// `deactivateRefusal = { memberId: 'm-ada', blockers }` with no check —
		// even though this function's `gEntry` is captured at a usable
		// before-first-await scope — CLOBBERING Bob's live refusal off screen.
		gateA.resolve([{ role: 'admin' }]);
		await flush();

		expect(
			q(container, 'member-deactivate-refused-m-bob'),
			"B's own refusal must survive A's stale refusal settle"
		).not.toBeNull();
		// Bob's armed pair still stands beside it, re-enabled for the admin to
		// cancel out or retry after removing the grant.
		const confirmB = q(container, 'member-deactivate-confirm-m-bob') as HTMLButtonElement | null;
		expect(confirmB).not.toBeNull();
		expect(confirmB!.disabled).toBe(false);
		// No refusal ever renders for Ada on B's screen, and neither refusal
		// path ever reached the write.
		expect(q(container, 'member-deactivate-refused-m-ada')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — #296 RED incl. the issuecomment-5594599579 amendment
//  siblings; house deterministic-race method per #259/#264,
//  held-WRITE-across-switch construction from
//  page.roster-pending-collective-switch.spec.ts (#287), keyboard-reorder
//  driver from page.roster-arrange-stale-success.spec.ts)
