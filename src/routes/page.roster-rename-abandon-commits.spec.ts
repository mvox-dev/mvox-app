// @vitest-environment happy-dom
//
// #303 RED — an abandoned section rename COMMITS; Escape is the ONLY discard.
//
// [DECISION-Mihkel, 2026-09-09, via Gama on #303]: option (b), in full. Losing
// focus from the section-name input commits the rename; starting a rename on
// another section commits the outgoing one first; a collective switch (or any
// unmount of an open rename) commits too. The reset callback's silent null-out
// of an open rename is the discard path this ruling REMOVES. Escape stays the
// one deliberate discard, byte-for-byte its old behaviour.
//
// At HEAD none of this exists: the rename input has `oninput` + `onkeydown`
// ONLY (no blur wiring), `startRename` silently overwrites an open edit, and
// the route-load reset unconditionally nulls `renamingSectionId`/`renameValue`
// (roster/+page.svelte:203-206) — every non-Escape exit is a silent discard.
//
// ── CALL COUNT is the criterion, never the final name ───────────────────────
// Gama's amendment, verbatim: "Both rewrites are to the same value, so they
// succeed, look correct, and leave the right name on screen. A test asserting
// the final name passes in every case." Three commit triggers (Enter, blur,
// switch) plus an unmount that may itself fire blur = every double-commit path
// here asserts `renameMock` call counts. A blur handler that closes over
// `row.id`/`renameValue` directly (rather than re-deriving from live state
// through `submitRename`'s own guards) fires a second, value-identical write
// that ONLY a call-count assertion can see.
//
// ── THE GENERATION HAZARD (research-303, source-confirmed) ──────────────────
// routeLoad.ts `loadForSelected()` bumps `generation` (line 96) BEFORE calling
// `opts.reset?.()` (line 103). A switch-commit naively wired as
// reset() → submitRename() captures the ALREADY-BUMPED generation — so the
// OUTGOING collective's success announcement passes the `g !==
// routeLoad.generation` guard and lands in the NEW collective's live region BY
// CONSTRUCTION, defeating #297's cross-collective guard on every switch. The
// GENERATION HAZARD test below fails against exactly that wiring: the commit
// path must carry an EXPLICIT pre-bump generation (parameter or snapshot),
// NOT reorder routeLoad's bump (routeLoad is shared by roster/library/profile
// — do not touch it unless all three consumers are proven safe).
//
// ── Empirical environment fact (probed in-suite, see UNMOUNT PROBE below) ───
// In THIS test environment (happy-dom), removing a focused input does NOT fire
// blur/focusout — only focusing another element does. Real browsers DO fire
// blur/focusout when a focused node is removed. So the removal-fires-blur
// double-commit paths are driven here by dispatching blur on the (detached)
// input manually — exactly the event a browser would deliver — while the
// UNMOUNT PROBE test pins the environment fact so a happy-dom behaviour change
// surfaces loudly instead of silently double-covering.
//
// House method (#259/#264/#287/#297): release-controlled write mock (hold →
// act → settle), real page render, assertions on rendered DOM + mock call
// counts, never on flags.
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

// ── two collectives, two disjoint fixtures (verbatim from the #297 spec) ────

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

const CFG_A = { db: 'polyphony', token: 'jwt-abc' };

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
	// `vi.clearAllMocks()` clears calls but NOT queued implementations — the
	// held-gate tests install `mockImplementation`s that would hand the NEXT
	// test a dead, never-resolved gate. Reset the implementation queues
	// explicitly (same as page.roster-rename-collective-switch.spec.ts).
	renameMock.mockReset();
	deleteMock.mockReset();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

// ── house helpers (verbatim / adapted from the #297 spec) ───────────────────

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

// Opens the inline rename on `sectionId` WITHOUT typing — the opened/no-edit
// scenarios need an input that never saw an `input` event.
async function openRenameRaw(container: HTMLElement, sectionId: string): Promise<HTMLInputElement> {
	await fireEvent.click(q(container, `arrange-rename-${sectionId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `arrange-rename-input-${sectionId}`)).not.toBeNull();
	});
	return q(container, `arrange-rename-input-${sectionId}`) as HTMLInputElement;
}

async function openRename(container: HTMLElement, sectionId: string, newName: string) {
	const input = await openRenameRaw(container, sectionId);
	await fireEvent.input(input, { target: { value: newName } });
	return input;
}

// ═════════════════════════════════════════════════════════════════════════════

describe('/roster — #303 blur COMMITS the open rename', () => {
	it('BLUR COMMITS: losing focus writes renameSection(cfg, id, trimmed) exactly ONCE, closes the input, shows the new name, and ANNOUNCES exactly as Enter does', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', '  Contralto  ');

		await fireEvent.blur(input);

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		// Same wire shape as the Enter path — cfg, id, TRIMMED value.
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Contralto');
		// "A commit triggered by blur … announces exactly as one triggered by
		// Enter" — the amended spec, verbatim.
		const status = q(container, 'roster-section-rename-status');
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(renameStatusText(container)).toContain('roster_section_renamed');
		});
		expect(renameStatusText(container)).toContain('Contralto');
		// One commit trigger fired, one write — the input's own unmount (which a
		// real browser answers with a second blur) must not have added another.
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('BLUR COMMIT DOES NOT STEAL FOCUS: the settle leaves focus where the user put it — the Enter path’s trigger-refocus must not yank it back', async () => {
		// `submitRename`'s `finally` unconditionally refocuses the rename
		// trigger — correct for Enter/Escape (the input the user was IN just
		// unmounted; WCAG 2.4.3), wrong for blur: the user has already put focus
		// somewhere else deliberately, and stealing it back is a focus trap.
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		// The user moves on: focus lands on another row's control, blur fires on
		// the input (this is the order a real browser delivers).
		const elsewhere = q(container, 'arrange-rename-sec-tenor') as HTMLButtonElement;
		elsewhere.focus();
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

		gate.resolve();
		await flush();
		await flush(); // settle's own `await tick()` before its focus write

		expect(
			document.activeElement,
			'a blur-triggered commit must not steal focus back to the rename trigger'
		).toBe(elsewhere);
	});

	it('BLUR ON AN UNCHANGED VALUE: no write (nothing to commit), the input closes, no residue, no announcement', async () => {
		// Decision pinned here (#303 "decide-and-pin"): opened but never edited,
		// focus lost → there is nothing to commit. A value-identical write is
		// noise on the wire and a phantom "renamed" announcement to a
		// screen-reader user. The editor just closes.
		const container = await renderInArrangeMode();
		const input = await openRenameRaw(container, 'sec-alto');
		expect(input.value).toBe('Alto');

		await fireEvent.blur(input);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(renameStatusText(container)).toBe('');
	});

	it('BLUR WITH BLANK/WHITESPACE: refuses without writing, the input closes, the ORIGINAL name stands, no announcement', async () => {
		// Decision pinned here (#303 "reconcile blank with blur"): on ENTER a
		// blank refuses and STAYS OPEN — the user is still in the field and can
		// fix it (that pin is page.roster-arrange-crud.spec.ts, unchanged). On
		// BLUR the user has LEFT: an open, unfocused editor holding whitespace
		// is residue, and nothing real is lost by closing it — the original name
		// simply stands. Refuse the write, close, restore.
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', '   ');

		await fireEvent.blur(input);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(renameStatusText(container)).toBe('');
	});

	it('BLUR WHILE ANOTHER STRUCTURAL WRITE IS IN FLIGHT: refuses without writing and KEEPS the input and its text — never a silent discard, never a second write', async () => {
		// "A commit while another structural write is outstanding still refuses
		// without writing — unchanged." And under ruling (b) the typed text may
		// not be thrown away either (Escape is the only discard) — so the input
		// stays open, text intact, exactly the Enter-refusal shape.
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		// Arm + confirm a delete on ANOTHER row; the write is held in flight.
		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(1);
		});

		await fireEvent.blur(input);
		await flush();

		expect(renameMock).not.toHaveBeenCalled();
		const stillOpen = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(stillOpen, 'the refused rename stays open — its text is not discardable').not.toBeNull();
		expect(stillOpen.value).toBe('Contralto');

		// Once the delete settles, the preserved text commits normally.
		gate.resolve();
		await flush();
		await fireEvent.keyDown(stillOpen, { key: 'Enter' });
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
	});
});

describe('/roster — #303 the double-commit traps (call count, never final state)', () => {
	it('BLUR AFTER ENTER: the unmount-blur a browser fires after submit adds NO second write', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		// The optimistic close unmounted the input; a real browser answers that
		// removal with blur ON THE REMOVED NODE. happy-dom does not (see the
		// UNMOUNT PROBE below), so deliver exactly that event by hand. A blur
		// handler that closes over row.id/renameValue instead of routing through
		// submitRename's live-state guards fires a second, value-identical write
		// here — visible ONLY as a call count.
		expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		await fireEvent.blur(input);
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);

		gate.resolve();
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(renameStatusText(container)).toContain('Contralto');
		});
	});

	it('BLUR AFTER ESCAPE: Escape discarded — the unmount-blur must not resurrect the discarded text as a write', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Discarded Name');

		await fireEvent.keyDown(input, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		// Escape's unmount fires blur in a real browser — on a handler closing
		// over the row's id and the typed value, that COMMITS what the user just
		// explicitly threw away.
		await fireEvent.blur(input);
		await flush();

		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).not.toContain('Discarded');
	});

	it('UNMOUNT PROBE: in THIS environment, unmounting the genuinely-FOCUSED input fires no blur — one Enter, one write; the environment fact is pinned so a change surfaces loudly', async () => {
		// Research left "does removal fire blur here?" open. Settled empirically
		// (probe, 2026-09-10): happy-dom fires NO blur/focusout on removing a
		// focused element (real browsers do; that path is the manual-dispatch
		// test above). Pinned as an assertion: if happy-dom ever starts firing
		// removal-blur, this test fails and tells the reader the manual-dispatch
		// tests are now doubled natively — update BOTH deliberately.
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		let removalBlurs = 0;
		input.addEventListener('blur', () => removalBlurs++);
		input.addEventListener('focusout', () => removalBlurs++);

		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		await flush();
		expect(removalBlurs, 'happy-dom fired blur/focusout on unmount — re-check the manual-dispatch coverage').toBe(0);
		expect(renameMock).toHaveBeenCalledTimes(1);

		gate.resolve();
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});
});

describe('/roster — #303 starting a rename on ANOTHER section commits the outgoing one', () => {
	it('SECTION SWITCH COMMITS (no preceding blur — the programmatic path): the outgoing rename writes ONCE, then the new row arms pre-filled — the silent overwrite is gone', async () => {
		// A click that arrives WITHOUT the input having blurred first: not an
		// order a browser produces for a mouse (see the real-browser-order test
		// below), but the shape a scripted/synthetic activation takes, and the
		// one `startRename`'s own switch-commit branch exists for.
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Contralto');

		// At HEAD `startRename` silently overwrites the open edit: no write,
		// 'Contralto' evaporates. Under the ruling it commits first, then arms.
		await fireEvent.click(q(container, 'arrange-rename-sec-tenor') as HTMLElement);

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-tenor')).not.toBeNull();
		});
		expect((q(container, 'arrange-rename-input-sec-tenor') as HTMLInputElement).value).toBe(
			'Tenor'
		);
		// The committed name is on the outgoing row (optimistic, same as Enter).
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Contralto');
		// The new editor is where the user is now working: focus belongs there,
		// not yanked back to the just-committed row's trigger by the settle.
		await flush();
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-rename-input-sec-tenor'));
		});
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('SECTION SWITCH COMMITS IN REAL-BROWSER ORDER (blur, THEN click): the commit must not swallow the click that caused it — the new row still arms, pre-filled and focused', async () => {
		// #303 review F1. A browser fires the open input's blur during MOUSEDOWN,
		// BEFORE the click handler on the row being clicked runs. So by the time
		// the new row's rename trigger would receive the click, the blur-commit
		// has already flipped `renamePending` true synchronously. A trigger gated
		// on the page-wide `structuralWritePending` is disabled by then, a
		// disabled button receives no click, and the user's click is eaten: the
		// outgoing rename commits, but the new editor never opens and they must
		// click a second time. Held gate — the write must still be IN FLIGHT at
		// the moment of the click, or the flag has already cleared and the test
		// proves nothing.
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		await fireEvent.blur(input);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		await flush(); // let the DOM catch up with the flag the commit just set

		const tenorTrigger = q(container, 'arrange-rename-sec-tenor') as HTMLButtonElement;
		expect(
			tenorTrigger.disabled,
			'the outgoing commit must not disable the trigger the user is clicking toward'
		).toBe(false);
		await fireEvent.click(tenorTrigger);

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-tenor')).not.toBeNull();
		});
		expect((q(container, 'arrange-rename-input-sec-tenor') as HTMLInputElement).value).toBe(
			'Tenor'
		);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-rename-input-sec-tenor'));
		});
		// The blur was the only commit trigger — the click must not add a second
		// write for the same section.
		expect(renameMock).toHaveBeenCalledTimes(1);
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');

		// The outgoing write settles under the new editor: still one write, the
		// committed name on the outgoing row, and focus left where the user is
		// now working.
		gate.resolve();
		await flush();
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
		expect(q(container, 'arrange-rename-sec-alto')?.textContent).toContain('Contralto');
		expect(document.activeElement).toBe(q(container, 'arrange-rename-input-sec-tenor'));
	});

	it('SWITCH REFUSED IS NOT A DISCARD: when the outgoing commit is refused, the FIRST editor keeps its text and the second row does NOT arm over it', async () => {
		// The switch-commit calls `submitRename`, which refuses whenever another
		// structural action holds the floor (here: an armed-but-unconfirmed
		// delete). Arming the new row ANYWAY would drop the refused text on the
		// floor — precisely the discard ruling (b) removes. `submitRename` runs
		// its guards synchronously, so `renamingSectionId` still naming the
		// outgoing row when the call returns IS the refusal signal.
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Contralto');

		// Arm — do NOT confirm — a delete on a third row.
		await fireEvent.click(q(container, 'section-remove-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-sop')).not.toBeNull();
		});

		const tenorTrigger = q(container, 'arrange-rename-sec-tenor') as HTMLButtonElement;
		expect(tenorTrigger.disabled).toBe(false);
		await fireEvent.click(tenorTrigger);
		await flush();

		expect(renameMock).not.toHaveBeenCalled();
		expect(
			q(container, 'arrange-rename-input-sec-tenor'),
			'the new row must not arm over a rename that could not be committed'
		).toBeNull();
		const stillOpen = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(stillOpen, 'the refused rename stays open — its text is not discardable').not.toBeNull();
		expect(stillOpen.value).toBe('Contralto');
	});
});

describe('/roster — #303 an armed-but-unconfirmed delete holds the floor', () => {
	it('AN ARMED-BUT-UNCONFIRMED DELETE HOLDS THE FLOOR: Enter in an open rename refuses without writing and keeps the text; cancelling the delete releases it', async () => {
		// #303 review F2 — the `pendingRemoveId !== null` refusal, pinned on the
		// path a user can actually reach, rather than left as an artifact of
		// happy-dom's focus ordering. The confirm/cancel pair is
		// `disabled={structuralWritePending}`, so starting a rename write under
		// an armed pair would disable the answer the user is reaching for.
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		// Arm — do NOT confirm — a delete on another row.
		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe(
			'Contralto'
		);

		// Enter, back in the still-open input: refused the same way. Nothing
		// written, nothing discarded.
		input.focus();
		await fireEvent.keyDown(input, { key: 'Enter' });
		await flush();
		expect(renameMock).not.toHaveBeenCalled();
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe(
			'Contralto'
		);

		// Blur is refused identically — the editor stays open, text intact. (Doing
		// this deliberately also parks focus OUTSIDE the input, so the cancel
		// below cannot fire an incidental blur-commit through `disarmRemove`'s own
		// focus placement.)
		(q(container, 'arrange-rename-sec-sop') as HTMLElement).focus();
		await fireEvent.blur(input);
		await flush();
		expect(renameMock).not.toHaveBeenCalled();
		expect((q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement).value).toBe(
			'Contralto'
		);

		// Cancel the delete — the floor is free and the preserved text commits.
		await fireEvent.click(q(container, 'section-remove-cancel-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).toBeNull();
		});
		const reopened = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(reopened).not.toBeNull();
		reopened.focus();
		await fireEvent.keyDown(reopened, { key: 'Enter' });
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Contralto');
	});
});

describe('/roster — #303 a collective switch commits the open rename (and the generation hazard)', () => {
	it('COLLECTIVE SWITCH COMMITS: exactly ONE write, to the OUTGOING collective’s cfg, with the typed value', async () => {
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Half-typed');

		await switchToOtherChoirArrange(container);

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(CFG_A, 'sec-alto', 'Half-typed');
		expect(anyRenameInput(container)).toBeNull();

		// The switch replaced the tree and unmounted the input — a browser
		// answers that removal with blur; deliver it. ONE commit trigger already
		// fired (the switch); the removal must not add a second write.
		await fireEvent.blur(input);
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('GENERATION HAZARD: the switch-commit’s success settles into SILENCE — the outgoing collective’s announcement must not land in B’s live region, and B’s controls are free meanwhile', async () => {
		// routeLoad bumps `generation` BEFORE reset() runs — so a switch-commit
		// naively wired as reset() → submitRename() captures the NEW generation
		// and its success announcement passes the #297 guard by construction,
		// telling a screen-reader user standing in B that a section of A was
		// renamed. The commit path must carry the PRE-bump generation
		// explicitly. This test fails against the naive wiring.
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Half-typed');

		await switchToOtherChoirArrange(container);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

		// A's commit is STILL IN FLIGHT — and is not B's business (#297 STALE
		// DISABLE): B's structural controls render enabled from load.
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's switch-commit in flight"
		).toBe(false);
		expect(q(container, 'arrange-row-sec-b1')?.getAttribute('draggable')).toBe('true');

		gate.resolve();
		await flush();

		expect(
			renameStatusText(container),
			"A's switch-commit success must announce NOTHING into B's live region"
		).toBe('');
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});

	it('SWITCH-COMMIT REJECTION: no failure alert on B, no A-tree clobber of B, and nothing resurfaces on A after switching back', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		await openRename(container, 'sec-alto', 'Half-typed');

		await switchToOtherChoirArrange(container);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

		gate.reject(new Error('403'));
		await flush();
		await flush(); // catch → refetch (one more microtask hop) → guards

		expect(
			anyRenameErrorAlert(container),
			'no rename-failure alert may render against collective B'
		).toBeNull();
		expect(renameStatusText(container)).toBe('');
		// The failure path refetches A's tree — a superseded settle must not
		// paint it over B's (the naive post-bump generation would).
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();

		await switchBackToPolyphonyArrange(container);
		expect(
			anyRenameErrorAlert(container),
			"a superseded switch-commit failure must not resurface on A's row"
		).toBeNull();
		expect(anyRenameInput(container)).toBeNull();
		consoleSpy.mockRestore();
	});

	it('SWITCH DURING A BLUR-COMMIT: the reset finds nothing left to commit — exactly ONE write, and the stale settle announces nothing into B', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();
		const input = await openRename(container, 'sec-alto', 'Contralto');

		// Blur starts the commit; the write is held in flight.
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});

		// The user switches while the blur-commit is in flight. The switch's
		// own commit-on-reset must see there is no OPEN rename any more — not
		// fire a second write for the same section.
		await switchToOtherChoirArrange(container);
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(1);
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's controls must not be frozen by A's in-flight blur-commit"
		).toBe(false);

		// The blur-commit settles AFTER the switch: superseded — silence.
		gate.resolve();
		await flush();
		expect(renameStatusText(container)).toBe('');
		expect(renameMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — #303 RED. Ruling (b) in full per Gama's amendment on the
//  issue: blur commits, section-switch commits, collective-switch commits,
//  Escape is the only discard. Harness verbatim from
//  page.roster-rename-collective-switch.spec.ts; the sibling rewrite there
//  flips its CLEARED-ON-SWITCH open-rename pin to COMMITTED-ON-SWITCH. Every
//  double-commit trap asserts renameMock call counts — both rewrites land the
//  same value, so final-state assertions pass straight through the bug.)
