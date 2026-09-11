// @vitest-environment happy-dom
//
// #297 RED — the rename state machine survives a collective switch, and its
// settle is not generation-guarded (the #260/#287 class, on the rename flags).
//
// At HEAD the route-load `reset` callback clears NONE of the five rename vars
// (`renamingSectionId`, `renameValue`, `renamePending`, `renameError`,
// `renameStatus`), and `submitRename` carries three ungated writes past its
// (usable, captured-before-first-await) generation capture `g`:
//
//   (1) `renameStatus = m.roster_section_renamed({ name })` — the SUCCESS
//       ANNOUNCEMENT, inside the `try`, no check at all. A rename confirmed on
//       collective A settling after a switch announces A's section into B's
//       live region — a screen-reader user standing in B is told a section of
//       A was renamed. The primary pin of this file.
//   (2) `renameError = { id, name }` at the end of the `catch` — structurally
//       ungated. (At HEAD it happens to be unreachable on a superseded settle
//       ONLY because the refetch guards above it early-return first; the pin
//       here holds that behavior through the restructure the fix makes, and
//       the genuinely-RED renameError defect is its SURVIVAL across a switch,
//       pinned in the CLEARED-ON-SWITCH block below.)
//   (3) `renamePending = false` in the `finally` — unconditional. Clearing on
//       switch alone is NOT enough: A's stale promise can settle AFTER a
//       genuine new rename has started on B and clobber B's live flag,
//       re-enabling B's structural controls mid-write.
//
// THE CONSTRAINT the fix must not break: `submitRename`'s `finally` also does
// `await tick()` + refocus of the rename trigger, and that must stay
// UNCONDITIONAL. `renamingSectionId` is cleared optimistically at submit, so
// the input unmounts immediately — on ANY settle, superseded or not, focus is
// already off the input and would fall to <body> if the block returned early.
// Gate the FLAG WRITE, not the block (the `finally` guard shape: conditional
// write; `try`/`catch` guard shape: early return — per the amendment adopted
// on #297). The FOCUS pin below fails a fix that early-returns in `finally`.
//
// `renameStatus`'s on-switch treatment is deliberately NOT pinned here either
// way: the reset callback's #287-era comment groups it with `removeStatus`/
// `pageCreateStatus` as not-cleared-on-switch, and the per-variable decision
// belongs to the fix. This file pins only that no STALE SETTLE may write it.
//
// House method (#259/#264/#287, page.roster-pending-collective-switch.spec.ts
// is the worked example this file's machinery comes from): the WRITE mock is
// release-controlled — hold → switch → (arm B / switch back) → settle. Flags
// are not exported: every assertion reads rendered DOM state (`disabled`,
// `draggable`, live-region text, mounted inputs/alerts, `document.activeElement`)
// and mock call counts, never the flags.
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

// ── two collectives, two disjoint fixtures (verbatim from the #287 spec) ────

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
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
});

afterEach(() => {
	cleanup();
	// `vi.clearAllMocks()` clears calls but NOT queued `mockImplementationOnce`s
	// — and the LATE-SETTLE CLOBBER test queues two. If that test aborts on an
	// assertion before consuming both (it does, pre-fix, at its precondition),
	// the leftover once-impl would hand the NEXT test's rename write a dead,
	// never-resolved gate. Reset the implementation queue explicitly (same as
	// page.roster-arrange-crud.spec.ts's afterEach); beforeEach re-arms the
	// default.
	renameMock.mockReset();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

// ── house helpers (verbatim / adapted from the #287 spec) ───────────────────

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

function renameStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-rename-status')?.textContent ?? '').trim();
}

// ANY rename-failure alert, on any row — covers a render-site move by the fix.
function anyRenameErrorAlert(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-error-"]');
}

function anyRenameInput(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-input-"]');
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
	expect(q(container, 'arrange-row-sec-sop')).toBeNull();
}

async function switchBackToPolyphonyArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('polyphony');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-sop')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-b1')).toBeNull();
}

// Opens the inline rename on `sectionId`, types `newName`, and (optionally)
// submits it with Enter into the mock — which the caller has typically HELD.
async function openRename(container: HTMLElement, sectionId: string, newName: string) {
	await fireEvent.click(q(container, `arrange-rename-${sectionId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `arrange-rename-input-${sectionId}`)).not.toBeNull();
	});
	const input = q(container, `arrange-rename-input-${sectionId}`) as HTMLInputElement;
	await fireEvent.input(input, { target: { value: newName } });
	return input;
}

async function submitHeldRename(
	container: HTMLElement,
	sectionId: string,
	newName: string,
	nthWrite: number
) {
	const input = await openRename(container, sectionId, newName);
	await fireEvent.keyDown(input, { key: 'Enter' });
	await waitFor(() => {
		expect(renameMock).toHaveBeenCalledTimes(nthWrite);
	});
	// The optimistic close: the input unmounts the instant the write starts.
	expect(q(container, `arrange-rename-input-${sectionId}`)).toBeNull();
}

// ═════════════════════════════════════════════════════════════════════════════

describe('/roster — #297 rename settle across a collective switch', () => {
	it("CROSS-COLLECTIVE ANNOUNCEMENT: A's rename SUCCESS settling after the switch leaves roster-section-rename-status EMPTY — it must not name A's section into B's live region", async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		gate.resolve();
		await flush();

		// THE pin: pre-fix the success branch writes
		// `renameStatus = roster_section_renamed({name: 'Contralto'})` with no
		// generation check at all — a screen-reader user standing in collective
		// B is told a section of collective A was renamed.
		expect(renameStatusText(container)).toBe('');
		// …and B's tree is untouched by the stale settle.
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
	});

	it("STALE DISABLE: with collective A's rename WRITE still in flight, collective B's structural controls render ENABLED from load — A's unresolved write is not B's business", async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);

		// Switch while the write is held. Pre-fix, `renamePending` is still
		// true (the reset callback never clears it), `structuralWritePending`
		// is derived page-wide from it, and every control below renders
		// disabled / undraggable on B from FIRST PAINT.
		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must not be disabled by A's in-flight write"
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

	it("CROSS-COLLECTIVE ERROR: A's rename REJECTING after the switch paints no rename-failure alert — not on B, and not on A after switching back", async () => {
		// NOTE: at HEAD the catch's `renameError = { id, name }` is structurally
		// ungated but happens to be unreachable on a superseded settle, because
		// the refetch guards above it early-return first. This pin holds the
		// no-alert behavior through the fix's restructure of the catch (an early
		// return per the guard-shape amendment), on both trees.
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		gate.reject(new Error('403'));
		await flush();
		await flush(); // catch → refetch (one more microtask hop) → guards

		expect(
			anyRenameErrorAlert(container),
			'no rename-failure alert may render against collective B'
		).toBeNull();
		expect(renameStatusText(container)).toBe('');
		// B's tree is untouched by the stale settle's refetch of A.
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();

		// A superseded settle must not have parked a stale `renameError` either:
		// back on A — where sec-alto's row exists again — still no alert.
		await switchBackToPolyphonyArrange(container);
		expect(
			anyRenameErrorAlert(container),
			"a superseded rename failure must not resurface on A's row after switching back"
		).toBeNull();
	});
});

describe('/roster — #297/#303 rename state across a collective switch: settled failures clear, open edits commit', () => {
	it('CLEARED ON SWITCH (renameError): a rename failure fully settled ON A does not resurface on its row after a round-trip through B', async () => {
		renameMock.mockRejectedValueOnce(new Error('403'));
		const container = await renderInArrangeMode();

		// Fail a rename entirely while ON collective A: the alert renders.
		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-error-sec-alto')).not.toBeNull();
		});

		// On B the alert is off screen (row-scoped) …
		await switchToOtherChoirArrange(container);
		expect(anyRenameErrorAlert(container)).toBeNull();

		// … and pre-fix it comes BACK when A's row re-renders: the reset
		// callback never clears `renameError`, so a failure message about a
		// tree that was replaced outlives the replacement (same reasoning the
		// reset callback already records for `removeError`).
		await switchBackToPolyphonyArrange(container);
		expect(
			q(container, 'arrange-rename-error-sec-alto'),
			'a rename failure from before the switch must not survive it'
		).toBeNull();
	});

	it('#303 COMMITTED ON SWITCH (renamingSectionId/renameValue): an OPEN rename abandoned at switch time commits ONCE to the outgoing collective, and no editor re-mounts after a round-trip through B', async () => {
		// REWRITTEN under #303 ruling (b) [DECISION-Mihkel, 2026-09-09]: this
		// test used to pin the switch's SILENT CLEAR of an open rename — that
		// clear is the discard path the ruling removes. A switch now COMMITS
		// the open rename; Escape is the only discard. The no-residue half of
		// the old pin stands unchanged below: committed is not "still armed".
		// (The full #303 suite is page.roster-rename-abandon-commits.spec.ts.)
		const container = await renderInArrangeMode();

		// Open the inline editor on A and type into it — do NOT submit.
		await openRename(container, 'sec-alto', 'Half-typed');

		// The switch commits the open rename: exactly ONE write, to the
		// OUTGOING collective's cfg, with the typed value. Call count, not
		// final state — a double-commit rewrites the same value and passes any
		// name assertion.
		await switchToOtherChoirArrange(container);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(
			{ db: 'polyphony', token: 'jwt-abc' },
			'sec-alto',
			'Half-typed'
		);
		expect(anyRenameInput(container)).toBeNull();

		// Committed is not "still armed": returning to A re-mounts NO editor
		// (same no-residue contract the old pin carried), and no further write
		// fires on the round-trip.
		await switchBackToPolyphonyArrange(container);
		expect(
			anyRenameInput(container),
			'a committed rename must not leave the editor armed across a collective round-trip'
		).toBeNull();
		expect(q(container, 'arrange-row-sec-alto')).not.toBeNull();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});
});

describe('/roster — #297 late settle vs a live write, and the focus contract', () => {
	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new rename has started on B — B's controls stay frozen, nothing announces A, and B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		renameMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		// Precondition (= the STALE DISABLE pin): B's rename trigger must be
		// usable at all, or no genuine write can ever start here.
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must be enabled after the switch"
		).toBe(false);

		// A GENUINE new rename on B, held on its own gate.
		//
		// #303 review F1 moved the freeze observable: the RENAME TRIGGER is no
		// longer disabled by an in-flight rename (arming an editor is local state,
		// not a write, and gating it page-wide made a blur-commit swallow the very
		// click that caused it — a browser blurs the open input on MOUSEDOWN,
		// before the next row's click handler runs). Every genuine WRITE control
		// still freezes, and the write seam still refuses — both asserted below.
		await submitHeldRename(container, 'sec-b1', 'Bass Uno', 2);
		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's own write is in flight — its structural controls are frozen"
		).toBe(true);

		// NOW A's stale promise settles. An unguarded `finally` would clobber
		// B's live `renamePending` back to false — re-enabling B's structural
		// controls mid-write and reopening the start-another-write window the
		// single-flight set exists to close — and the unguarded success branch
		// would announce A's section. Neither may happen. (This is why clearing
		// the flags on switch ALONE is insufficient: the guard on the settle
		// itself is the other half.)
		gateA.resolve();
		await flush();

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's write is STILL in flight — structural controls stay frozen"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b2')?.getAttribute('draggable')).toBe('false');
		expect(renameStatusText(container)).toBe('');

		// Double-fire probe, at the WRITE seam (#303 review F1): the editor may
		// open on another row, but committing it while B's write is in flight is
		// refused — no third write, and the refused text is kept, not discarded.
		await fireEvent.click(q(container, 'arrange-rename-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-b2')).not.toBeNull();
		});
		const probeInput = q(container, 'arrange-rename-input-sec-b2') as HTMLInputElement;
		await fireEvent.input(probeInput, { target: { value: 'Bass Due' } });
		await fireEvent.keyDown(probeInput, { key: 'Enter' });
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(2);
		expect(
			(q(container, 'arrange-rename-input-sec-b2') as HTMLInputElement)?.value,
			'the refused rename stays open — its text is not discardable'
		).toBe('Bass Due');
		// Escape out, so the trigger's own `renamingSectionId === row.id` disable
		// cannot be mistaken for the in-flight freeze in the release check below.
		await fireEvent.keyDown(probeInput, { key: 'Escape' });
		await waitFor(() => {
			expect(anyRenameInput(container)).toBeNull();
		});

		// B's own write completes HONESTLY: announced with B's name, controls
		// released. (Trap detector: an over-broad guard — one consumed by A's
		// settle — would leave B frozen forever or swallow B's announcement.)
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled).toBe(false);
		});
		expect((q(container, 'arrange-rename-sec-b2') as HTMLButtonElement).disabled).toBe(false);
		expect(renameStatusText(container)).toContain('roster_section_renamed');
		expect(renameStatusText(container)).toContain('Bass Uno');
		expect(renameStatusText(container)).not.toContain('Contralto');
		expect(q(container, 'arrange-rename-sec-b1')?.textContent).toContain('Bass Uno');
		expect(renameMock).toHaveBeenCalledTimes(2);
	});

	it('FOCUS ON A SUPERSEDED SETTLE: the settle still lands focus on the rename trigger — and still announces NOTHING (gate the flag write, not the finally block)', async () => {
		// A → B → A: the generation the settle captured is two bumps old, so it
		// is superseded — but A's tree (and sec-alto's rename trigger) is back
		// on screen. `renamingSectionId` was cleared optimistically at submit,
		// so the input unmounted long ago: if the `finally` early-returned on
		// the guard, focus would fall to <body>. The focus restoration must run
		// on EVERY settle; only the `renamePending` write is gated. A fix that
		// guards the whole `finally` block passes every flag assertion in this
		// file and fails HERE.
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);
		await switchBackToPolyphonyArrange(container);

		gate.resolve();
		await flush();

		// The superseded settle says nothing (RED at HEAD: the ungated success
		// write announces into the live region) …
		expect(renameStatusText(container)).toBe('');
		// … but its focus restoration still runs: WCAG 2.4.3, success, failure
		// and supersession alike. Not <body>.
		await waitFor(() => {
			expect(document.activeElement?.getAttribute('data-testid')).toBe(
				'arrange-rename-sec-alto'
			);
		});
		expect(document.activeElement).not.toBe(document.body);
	});
});

// (*MVOX:Tallis* — #297 RED; house deterministic-race method per #259/#264/
//  #287; mocks/fixtures/switch driver verbatim from
//  page.roster-pending-collective-switch.spec.ts, rename driver from
//  page.roster-arrange-crud.spec.ts. The round-trip A→B→A construction is new
//  here: it is the only way to observe row-scoped stale state — renameError,
//  renamingSectionId — through the DOM, and the only superseded settle whose
//  focus target is back on screen.)
