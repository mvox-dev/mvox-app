// @vitest-environment happy-dom
//
// #299 RED — the section CREATE paths have no collective-switch guard at all,
// and the page-create form's retained parent id is a cross-collective
// reference. TWO DISTINCT DEFECT CLASSES, deliberately not conflated:
//
//   CLASS B — SYNCHRONOUS (no race, no held promise — the sharpest bug on the
//   issue): `pageCreateParentId` survives a collective switch. Its <select>
//   rebuilds its options from B's collective-scoped tree, so no option matches
//   the retained value and the select DISPLAYS its first option — "top
//   level" — while the variable still holds A's section id. `submitPageCreate`
//   reads the VARIABLE, not the DOM: the admin reads "top level", submits, and
//   the section is parented into a collective they are not looking at. The pin
//   is therefore on the SUBMITTED PARENT (what `createSection` received), never
//   on the variable — a fix that resets state but still submits wrong must
//   fail it.
//
//   CLASS A — ASYNCHRONOUS: `handleCreate` and `submitPageCreate` capture no
//   generation and call no isCurrent() anywhere — unlike every other write
//   handler in the file, there is NO guard to be incomplete. A create confirmed
//   on collective A, settling after a switch to B, mutates B's section tree
//   (`sections = insertSectionNode(...)`) and writes error/status/form state
//   unconditionally. This is a state leak across collectives, not a stale
//   banner — the pins assert the TREE (and the follow-on writes), not just
//   messages.
//
// PO rulings folded in (issue #299 comment thread, read in full):
//   - ALL THREE page-create form vars clear on a collective switch
//     (`pageCreateParentId` because it is a cross-collective reference;
//     `pageCreateOpen`/`pageCreateName` because once the parent id must go,
//     keeping them would hand the user an open, named, parentless form they
//     never created — losing a draft on an explicit context switch is
//     expected, a half-form pointing at the wrong tree is not).
//   - `renameStatus`, `removeStatus` and `pageCreateStatus` all clear on a
//     collective switch, making all four status regions behave identically
//     (`reorderStatus`/`recordStatus` already do). The reason is that a status
//     region carries no collective context: a sentence about collective A,
//     rendered inside B, reads as a statement about B. Each handler clears its
//     own region at entry, so every same-collective write remains a genuine
//     '' → text change — that entry-clear discipline is untouched here.
//
// House method for the timing pins (#259's deterministic race construction,
// worked example: page.roster-pending-collective-switch.spec.ts): the WRITE
// mock itself is release-controlled — hold → switch → settle. Every assertion
// reads rendered DOM or mock call records, never component internals.
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
import { toListRead } from '$lib/testing/listReadFixtures';

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

// Every member UNASSIGNED: rows live under the Unassigned group's toggle, and
// each row renders its SectionPicker (the inline create entry `handleCreate`
// is reached through). All personIds differ from both viewers'.
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
		Promise.resolve(toListRead(cfg.db === 'polyphony' ? rowsA() : rowsB()))
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
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	createInviteMock.mockResolvedValue({ inviteId: 'inv-1', url: 'https://x.invalid/i/1' });
	mintSelfLinkInviteMock.mockResolvedValue({ inviteId: 'inv-2', url: 'https://x.invalid/i/2' });
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

// ── house helpers (fixtures/switch drivers: page.roster-pending-collective-
//    switch.spec.ts; deferred: page.roster-deactivate.spec.ts) ───────────────

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

function createStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-create-status')?.textContent ?? '').trim();
}

function removeStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-remove-status')?.textContent ?? '').trim();
}

function renameStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-rename-status')?.textContent ?? '').trim();
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

// Opens the page-level "+ New section" form (arrange mode, admin) and types a
// name into it. Parent selection, submit and switch are each test's own moves.
async function openPageCreateForm(container: HTMLElement, name: string) {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
	await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
		target: { value: name }
	});
}

// Drives a member row's SectionPicker inline create (the `handleCreate` entry):
// open picker → "+ New section" → name → submit. Top-level (no parent picked).
async function pickerCreate(container: HTMLElement, memberId: string, name: string) {
	await fireEvent.click(q(container, `section-picker-trigger-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-picker-new')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-create-name')).not.toBeNull();
	});
	await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
		target: { value: name }
	});
	await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);
}

// ═════════════════════════════════════════════════════════════════════════════

describe('/roster — #299 CLASS B: the retained page-create parent id (synchronous — no race required)', () => {
	it("LYING PARENT: submitting after a collective switch must never send the PREVIOUS collective's section id as parentId — the select displays 'top level' while the variable still holds A's node", async () => {
		const container = await renderInArrangeMode();

		// Open the form on A, name it, and pick a REAL parent from A's tree.
		await openPageCreateForm(container, 'Chorus');
		const parentSelect = q(container, 'roster-new-section-parent') as HTMLSelectElement;
		await fireEvent.change(parentSelect, { target: { value: 'sec-sop' } });
		expect(parentSelect.value).toBe('sec-sop');

		// Switch with the form open. Pre-fix nothing clears the form or the
		// retained parent id; the select's options are rebuilt from B's tree, so
		// the DOM shows "top level" while the variable still says sec-sop.
		await switchToOtherChoirArrange(container);

		// Submit whatever the UI still offers. Post-fix the switch closes the
		// form (see the ruling pin below) and no submit control exists — in that
		// world nothing is sent, which also satisfies this pin.
		const submit = q(container, 'roster-new-section-submit');
		if (submit) {
			await fireEvent.click(submit);
			await flush();
		}

		// THE pin: assert what `createSection` actually RECEIVED — never merely
		// that the variable was reset. A fix that resets state but still submits
		// A's id must fail here; a fix that keeps the form open but genuinely
		// submits a B-valid parent (or top level) passes.
		for (const call of createMock.mock.calls) {
			const input = call[1] as { name: string; parentId: string | null };
			expect(
				[null, 'sec-b1', 'sec-b2'],
				`createSection was handed parentId ${JSON.stringify(input.parentId)} — a section id from the collective the admin is no longer looking at`
			).toContain(input.parentId);
		}
	});

	it('the open create form does not survive the switch — pageCreateOpen, pageCreateName and pageCreateParentId all clear together (PO ruling)', async () => {
		// The ruling (issue #299, Gama): `pageCreateParentId` is a
		// cross-collective reference and MUST go; once it goes,
		// `pageCreateOpen`/`pageCreateName` go with it — keeping them would
		// produce an open, named, parentless form the user never created, a
		// worse intermediate state than a closed one. Losing a draft on an
		// explicit context switch is expected; being handed a half-form pointing
		// at the wrong tree is not.
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Draft name');
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLSelectElement, {
			target: { value: 'sec-sop' }
		});

		await switchToOtherChoirArrange(container);

		expect(
			q(container, 'roster-new-section-form'),
			"the form opened on A must not still be open on B — its typed name and retained parent belong to a tree that is no longer on screen"
		).toBeNull();
		// The affordance itself is intact: B offers a fresh "+ New section".
		expect(q(container, 'roster-new-section')).not.toBeNull();
	});
});

describe('/roster — #299 CLASS A: submitPageCreate has no collective-switch guard at all', () => {
	it("STALE SETTLE: A's page-level create resolving after the switch must not insert into B's tree, and announces nothing", async () => {
		const gate = deferred<string>();
		createMock.mockImplementationOnce(() => gate.promise);
		const container = await renderInArrangeMode();

		// Start the create on A (top level) and HOLD the write.
		await openPageCreateForm(container, 'Chorus');
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		// A's create is confirmed AFTER the switch. Pre-fix, `sections =
		// insertSectionNode(...)` runs against B's tree unconditionally — the
		// node even picks up B's org id (`currentDbEntityId` is read at settle
		// time), so it renders straight into B's arrange list.
		gate.resolve('sec-created');
		await flush();

		expect(
			q(container, 'arrange-row-sec-created'),
			"a section created on collective A must not appear in collective B's tree"
		).toBeNull();
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
		// A status region carries no collective context — a sentence about A,
		// rendered inside B, reads as a statement about B.
		expect(createStatusText(container)).toBe('');
	});

	it("STALE FAILURE: A's page-level create rejecting after the switch must not render a create error on B", async () => {
		const gate = deferred<string>();
		createMock.mockImplementationOnce(() => gate.promise);
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Chorus');
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		// The write fails after the switch. Pre-fix the catch writes
		// `pageCreateError` unconditionally AND the form (never reset) is still
		// open on B — so B shows a loud creation-failure alert for an attempt
		// made on a different collective.
		gate.reject(new Error('boom'));
		await flush();

		expect(
			q(container, 'roster-new-section-error'),
			"a create that failed on collective A must not put a failure alert on collective B's screen"
		).toBeNull();
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
});

describe('/roster — #299 CLASS A: handleCreate (picker create) has no collective-switch guard at all', () => {
	it("STALE SETTLE: A's picker create resolving after the switch must not touch B's tree, and must not fire the follow-on assign", async () => {
		const gate = deferred<string>();
		createMock.mockImplementationOnce(() => gate.promise);
		const container = await renderGroupsRoster();

		// Ada's inline "+ New section" on A — HOLD the create.
		await pickerCreate(container, 'm-ada', 'Chorus');
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});
		expect(assignMock).not.toHaveBeenCalled();

		await switchToOtherChoirGroups(container);

		gate.resolve('sec-created');
		await flush();

		// Pre-fix `sections = insertSectionNode(...)` pollutes B's tree state.
		// (The #124/F3 own-org filter happens to hide the stale root from B's
		// VIEW — its dbEntityId is A's org — so the DOM assertion alone would
		// stay green by accident of that filter. The DOM stays pinned anyway,
		// and the leak's observable half is the follow-on write below.)
		expect(
			q(container, 'section-toggle-sec-created'),
			"a section created on collective A must not appear in collective B's tree"
		).toBeNull();
		expect(q(container, 'section-toggle-sec-b1')).not.toBeNull();
		expect(q(container, 'section-toggle-sec-b2')).not.toBeNull();

		// THE red driver: pre-fix, handleCreate barrels on past the stale settle
		// into `assignMemberSection(cfgA, 'm-ada', 'sec-created')`. Once
		// superseded, the handler must write — and fire — nothing further.
		expect(
			assignMock,
			"a create superseded by a collective switch must not fire its follow-on member-assign"
		).not.toHaveBeenCalled();
	});

	it("LATE-SETTLE CLOBBER: A's create rejecting after B's own genuine create failure must not replace B's error banner", async () => {
		const gateA = deferred<string>();
		createMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => Promise.reject(new Error('boom-b')));
		const container = await renderGroupsRoster();

		// Ada's create on A — HELD.
		await pickerCreate(container, 'm-ada', 'Chorus A');
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);

		// A GENUINE create on B that fails fast: Bob's row shows its own banner.
		await pickerCreate(container, 'm-bob', 'Chorus B');
		await waitFor(() => {
			expect(q(container, 'section-write-error-m-bob')).not.toBeNull();
		});

		// NOW A's stale create rejects. Pre-fix its catch writes
		// `sectionWriteError = { memberId: 'm-ada', … }` unconditionally —
		// there is ONE error slot, so B's genuine banner unmounts.
		gateA.reject(new Error('stale-a'));
		await flush();

		expect(
			q(container, 'section-write-error-m-bob'),
			"B's own failure banner must survive A's stale settle"
		).not.toBeNull();
		expect(q(container, 'section-write-error-m-ada')).toBeNull();
	});

	it('sectionWriteError clears on a collective switch: a failure from a previous visit must not still be on screen after leaving and returning', async () => {
		// No held promise here — this pins the reset half (#299 done-when:
		// `sectionWriteError` cleared on switch), independent of the settle
		// guard the two tests above force.
		createMock.mockImplementationOnce(() => Promise.reject(new Error('boom-a')));
		const container = await renderGroupsRoster();

		// A genuine, same-collective failure on A: Ada's banner renders. Correct.
		await pickerCreate(container, 'm-ada', 'Chorus');
		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});

		// Leave for B, come back to A.
		await switchToOtherChoirGroups(container);
		selectedCollectiveDbStore.set('polyphony');
		await waitFor(() => {
			expect(q(container, 'section-toggle-sec-sop')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-toggle-unassigned') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});

		// Pre-fix `sectionWriteError` is absent from the route-load reset, so the
		// stale banner from the PREVIOUS visit re-renders as if it just happened.
		expect(
			q(container, 'section-write-error-m-ada'),
			'a create failure from a previous visit to this collective must not resurface after a round-trip switch'
		).toBeNull();
	});
});

describe('/roster — #299 status regions clear on a collective switch (PO amendment)', () => {
	// One shape, three regions. The reason is the same each time: a status
	// region carries no collective context, so a sentence about collective A,
	// rendered inside B, reads as a statement about B. With these three joining
	// `reorderStatus`/`recordStatus`, all four regions behave identically and
	// the per-region exception (whose reasoning lived only in a review thread)
	// is gone. Handler-entry clears are untouched: every same-collective write
	// remains a genuine '' → text change.

	it("pageCreateStatus: A's create announcement is not still in the region after switching to B", async () => {
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Chorus');
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
		await waitFor(() => {
			expect(createStatusText(container)).toContain('roster_section_created');
		});

		await switchToOtherChoirArrange(container);

		expect(
			createStatusText(container),
			"'Chorus created' is a fact about collective A — rendered without context inside B it reads as a fact about B"
		).toBe('');
	});

	it("removeStatus: A's removal announcement is not still in the region after switching to B", async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(removeStatusText(container)).toContain('roster_section_removed');
		});

		await switchToOtherChoirArrange(container);

		expect(
			removeStatusText(container),
			"'Tenor removed' is a fact about collective A — rendered without context inside B it reads as a fact about B"
		).toBe('');
	});

	it("renameStatus: A's rename announcement is not still in the region after switching to B", async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'arrange-rename-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-sop')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'arrange-rename-input-sec-sop') as HTMLElement, {
			target: { value: 'Sopranos' }
		});
		await fireEvent.keyDown(q(container, 'arrange-rename-input-sec-sop') as HTMLElement, {
			key: 'Enter'
		});
		await waitFor(() => {
			expect(renameStatusText(container)).toContain('roster_section_renamed');
		});

		await switchToOtherChoirArrange(container);

		expect(
			renameStatusText(container),
			"'Sopranos renamed' is a fact about collective A — rendered without context inside B it reads as a fact about B"
		).toBe('');
	});
});

describe("/roster — #299 handleRemoveSection's terminal failure writes", () => {
	it("a wrong-collective removal-failure banner cannot appear: A's remove rejecting after the switch renders no section-remove-error on B", async () => {
		// DEFENSIVE PIN, stated honestly: at HEAD the terminal `removeError`/
		// `failedRemoveId` writes carry no generation check of their own — they
		// are shielded only by the early returns inside the catch's refetch
		// reconcile (both of which happen to sit upstream on every stale path).
		// That protection is positional accident, not stated intent; #299's
		// done-when adds the explicit re-check beside the writes (reusing the
		// `g` captured at entry). This pin may already hold at HEAD — it exists
		// so the protection survives the restructure and can never regress to
		// a banner about A's section rendering on B.
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		gate.reject(new Error('boom'));
		await flush();

		expect(
			q(container, 'section-remove-error'),
			"a removal that failed on collective A must not put a failure alert on collective B's screen"
		).toBeNull();
		// …and neither reconcile branch touched B's tree.
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-tenor')).toBeNull();
	});
});

// (*MVOX:Tallis* — #299 RED, house deterministic-race method per #259/#287;
//  the Class B lying-parent pin asserts the SUBMITTED parent, per the PO
//  amendment on the issue; harness/fixtures/switch drivers from
//  page.roster-pending-collective-switch.spec.ts)
