// @vitest-environment happy-dom
//
// #294 RED — roster join state + owner-only invite controls, at the ROUTE
// level, so GREEN cannot satisfy the data layer without wiring the feature
// into the actual /roster page.
//
// The contract, from the issue's rulings (they supersede the body — the
// body's "an admin cannot read another member's redemption state" premise was
// DISPROVED by live probe):
//
//   STATE (per row, read from person.entu_user CONTENTS, never presence —
//   producer: listJoinStates, pinned in linkedIdentities.joinStates.spec.ts):
//     absent  → never invited        → control: kutsu
//     invited → live unredeemed link → controls: saada uuesti + tühista kutse
//     joined  → bound identity       → no controls
//   `kutsu` reachable on a row that already has a live link is a
//   STATE-ROUTING BUG, not a case to handle — pinned as unreachable.
//
//   WHO SEES WHAT (PO ruling 2026-09-09, probe-verified): the three-state
//   DISPLAY is for EVERY admin (`admin === 'admin'`, i.e. `_owner` OR
//   `_editor` on the database entity, adminStore.ts:84-86 — a `_viewer`-level
//   read already returns the placeholder shape, so an editor-admin loses
//   nothing). The three CONTROLS are `_owner` ONLY (probe: `_owner` mint →
//   HTTP 200; `_editor` → HTTP 403 "User not in _owner property"). An
//   editor-admin gets ONE LINE where the controls would be — NOT three
//   disabled buttons, NOT three failing buttons, NOT silence.
//
//   ACTIONS: kutsu and saada uuesti mint onto the EXISTING person via
//   mintSelfLinkInvite (sweep-then-mint — the one-live-link invariant is
//   pinned at the wire in inviteData.withdraw.spec.ts); the roster NEVER
//   calls createInvite (that creates a second person+member). tühista kutse
//   is withdrawInvite — all-or-report; on success the row collapses to the
//   never-invited state (Mihkel ruling: withdrawn and never-invited are the
//   SAME state — the person REAPPEARS in the needs-inviting population, and
//   that is correct).
//
// Out of scope, deliberately: listActiveMembers' fail-loud throw on an
// unreadable `person` reference (rosterData.ts:123) is a DIFFERENT field and
// stays untouched; no test here asserts the invite token's lifetime (source
// says 7d, #23 measured 24h live — unresolved, neither number may be pinned).
//
// Copy (kutsu / saada uuesti / tühista kutse) rides the paraglide keys the
// i18n phase adds; the testids below are this suite's contract.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const {
	loadRosterMock,
	listSectionsMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock,
	withdrawInviteMock,
	listJoinStatesMock,
	resolveOwnerTierMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn(),
	withdrawInviteMock: vi.fn(),
	listJoinStatesMock: vi.fn(),
	resolveOwnerTierMock: vi.fn()
}));

vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
// The three controls' producers. createInvite is mocked as a TRAP: the roster
// acts on EXISTING persons, so it must never run from this page — a call is a
// duplicate person+member, caught here as a call rather than a network error.
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: createInviteMock,
	mintSelfLinkInvite: mintSelfLinkInviteMock,
	withdrawInvite: withdrawInviteMock
}));
vi.mock('$lib/profile/linkedIdentities', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/linkedIdentities')>()),
	listJoinStates: listJoinStatesMock
}));
vi.mock('$lib/nav/adminStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/nav/adminStore')>()),
	resolveOwnerTier: resolveOwnerTierMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import type { SectionNode } from '$lib/sections/sectionData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── two collectives (the #287 bug class: per-row state must not survive a
//    switch), disjoint fixtures ─────────────────────────────────────────────

const ORG_A = 'org-a';
const ORG_B = 'org-b';

// m1 is the VIEWER's own membership; m2 joined, m3 invited-unredeemed, m4
// never invited — one row per state, all unassigned (rows live under the
// Unassigned toggle; groups default collapsed).
function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm3', personId: 'pp-3', name: 'Carl Cantor', email: 'carl@example.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm4', personId: 'pp-4', name: 'Dora Descant', email: 'dora@example.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B }
	];
}

function treeA(): SectionNode[] {
	return [
		{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

function treeB(): SectionNode[] {
	return [
		{ id: 'sec-b1', name: 'Bass I', displayOrder: 1, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] }
	];
}

type JoinState = 'absent' | 'invited' | 'joined';

// Mutable per-test join-state fixture: action tests flip a person's state here
// and the pinned REFRESH re-read makes the row follow the CONTENTS.
let joinStatesByDb: Record<string, Record<string, JoinState>>;

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
	joinStatesByDb = {
		polyphony: { 'person-p': 'joined', 'pp-2': 'joined', 'pp-3': 'invited', 'pp-4': 'absent' },
		'other-choir': { 'p-bob': 'absent' }
	};
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'polyphony' ? rowsA() : rowsB())
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'polyphony' ? treeA() : treeB())
	);
	listJoinStatesMock.mockImplementation((cfg: { db: string }, personIds: string[]) =>
		Promise.resolve(
			Object.fromEntries(
				personIds.map((id) => [id, joinStatesByDb[cfg.db]?.[id] ?? 'absent'])
			)
		)
	);
	resolveOwnerTierMock.mockResolvedValue('owner');
	mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: 'tok-fresh-1' });
	withdrawInviteMock.mockResolvedValue(undefined);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue([]);
	listInactiveMembersMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
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

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Every invite-control element on the page, whatever row it sits on. */
function allControls(container: HTMLElement): Element[] {
	return [
		...container.querySelectorAll(
			'[data-testid^="roster-member-invite-"], [data-testid^="roster-member-reinvite-"], [data-testid^="roster-member-withdraw-"]'
		)
	];
}

async function renderRoster(
	opts: { admin?: 'admin' | 'not-admin'; tier?: 'owner' | 'editor' | 'none' | 'error' } = {}
) {
	resolveOwnerTierMock.mockResolvedValue(opts.tier ?? 'owner');
	const utils = render(Page);
	setAuthedWithTwoCollectives();
	adminStore.set(opts.admin ?? 'admin');
	await waitFor(() =>
		expect(
			utils.container.querySelector('[data-testid="section-toggle-unassigned"]')
		).not.toBeNull()
	);
	await fireEvent.click(
		utils.container.querySelector('[data-testid="section-toggle-unassigned"]')!
	);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="roster-row-m2"]')).not.toBeNull()
	);
	return utils;
}

async function switchToOtherChoir(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => expect(q(container, 'section-toggle-sec-b1')).not.toBeNull());
	await fireEvent.click(q(container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(container, 'roster-row-m-bob')).not.toBeNull());
}

// ═════════════════════════════════════════════════════════════════════════════

describe('(A) three-state display — every admin, contents not presence', () => {
	it('an owner-admin sees one badge per row, each carrying the state read from entu_user CONTENTS', async () => {
		const { container } = await renderRoster();
		await waitFor(() =>
			expect(q(container, 'roster-row-join-state-m2')).not.toBeNull()
		);
		expect(q(container, 'roster-row-join-state-m2')!.getAttribute('data-join-state')).toBe('joined');
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
		expect(q(container, 'roster-row-join-state-m4')!.getAttribute('data-join-state')).toBe('absent');
	});

	it('the presence-check trap, pinned at the surface: an invited-but-never-joined member renders INVITED, never joined', async () => {
		// The issue body's premise failed exactly here — every invited person HAS
		// an entu_user entry. m3 (placeholder, no uid) is the population the
		// controls exist for; a presence check would badge her "joined".
		const { container } = await renderRoster();
		await waitFor(() =>
			expect(q(container, 'roster-row-join-state-m3')).not.toBeNull()
		);
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).not.toBe('joined');
	});

	it('an EDITOR-admin sees the same three badges — the display is for every admin (PO ruling 2026-09-09)', async () => {
		const { container } = await renderRoster({ tier: 'editor' });
		await waitFor(() =>
			expect(q(container, 'roster-row-join-state-m2')).not.toBeNull()
		);
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
		expect(q(container, 'roster-row-join-state-m4')!.getAttribute('data-join-state')).toBe('absent');
	});

	it('a NON-admin sees no join-state badge on any row', async () => {
		const { container } = await renderRoster({ admin: 'not-admin' });
		expect(container.querySelectorAll('[data-testid^="roster-row-join-state-"]')).toHaveLength(0);
	});

	it("INTEGRATION: the route calls listJoinStates with the selected collective's cfg and the rendered rows' personIds", async () => {
		await renderRoster();
		await waitFor(() => expect(listJoinStatesMock).toHaveBeenCalled());
		const matching = listJoinStatesMock.mock.calls.some((call) => {
			const [cfg, ids] = call as [{ db: string }, string[]];
			return cfg.db === 'polyphony' && ['pp-2', 'pp-3', 'pp-4'].every((id) => ids.includes(id));
		});
		expect(matching).toBe(true);
	});
});

describe('(B) controls route by state — owner-admin', () => {
	it('never-invited row (m4): kutsu, and ONLY kutsu', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		expect(q(container, 'roster-member-reinvite-m4')).toBeNull();
		expect(q(container, 'roster-member-withdraw-m4')).toBeNull();
	});

	it('invited row (m3): saada uuesti AND tühista kutse — and kutsu is UNREACHABLE (a kutsu on a live-link row is a state-routing bug)', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull());
		expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m3')).toBeNull();
	});

	it('joined rows (m1, m2): no controls at all', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		for (const memberId of ['m1', 'm2']) {
			expect(q(container, `roster-member-invite-${memberId}`)).toBeNull();
			expect(q(container, `roster-member-reinvite-${memberId}`)).toBeNull();
			expect(q(container, `roster-member-withdraw-${memberId}`)).toBeNull();
		}
	});
});

describe('(C) the controls gate on _owner ONLY — PO ruling 2026-09-09, probe-observed boundary', () => {
	it('an editor-admin gets ZERO control elements — not three disabled buttons, not three failing buttons — and ONE LINE saying invites require owner rights, not silence', async () => {
		const { container } = await renderRoster({ tier: 'editor' });
		// The display still renders (previous block) — wait on it so the controls
		// had their chance to appear before we assert their absence.
		await waitFor(() =>
			expect(q(container, 'roster-row-join-state-m3')).not.toBeNull()
		);
		expect(allControls(container)).toHaveLength(0);
		const notes = container.querySelectorAll('[data-testid="roster-invite-owner-note"]');
		expect(notes.length).toBeGreaterThanOrEqual(1);
		expect((notes[0].textContent ?? '').trim()).not.toBe('');
	});

	it('an owner-admin gets the controls and NO owner-rights note', async () => {
		const { container } = await renderRoster({ tier: 'owner' });
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		expect(q(container, 'roster-invite-owner-note')).toBeNull();
	});

	it('a NON-admin gets neither controls nor the note', async () => {
		const { container } = await renderRoster({ admin: 'not-admin' });
		expect(allControls(container)).toHaveLength(0);
		expect(q(container, 'roster-invite-owner-note')).toBeNull();
	});

	it("a tier-resolution 'error' fails CLOSED: no controls", async () => {
		const { container } = await renderRoster({ tier: 'error' });
		await waitFor(() =>
			expect(q(container, 'roster-row-join-state-m3')).not.toBeNull()
		);
		expect(allControls(container)).toHaveLength(0);
	});

	it("INTEGRATION: the route resolves the owner tier for the selected collective's viewer", async () => {
		await renderRoster();
		await waitFor(() => expect(resolveOwnerTierMock).toHaveBeenCalled());
		const matching = resolveOwnerTierMock.mock.calls.some((call) => {
			const [cfg, personId] = call as [{ db: string }, string];
			return cfg.db === 'polyphony' && personId === 'person-p';
		});
		expect(matching).toBe(true);
	});
});

describe('(D) kutsu — first invite, minted onto the EXISTING person', () => {
	it('calls mintSelfLinkInvite (sweep-then-mint) for THAT person, NEVER createInvite, and surfaces the fresh link — the token is the deliverable', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		expect(mintSelfLinkInviteMock.mock.calls[0][0].db).toBe('polyphony');
		expect(mintSelfLinkInviteMock.mock.calls[0][1]).toBe('pp-4');
		// A createInvite here would manufacture a SECOND person+member for Dora.
		expect(createInviteMock).not.toHaveBeenCalled();
		const link = await waitFor(() => {
			const el = q(container, 'roster-invite-link-m4');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(link.textContent).toContain('tok-fresh-1');
	});

	it('after the mint the state is RE-READ and the row follows the contents: kutsu gone, saada uuesti + tühista kutse on', async () => {
		mintSelfLinkInviteMock.mockImplementation(async (_cfg: unknown, personId: string) => {
			joinStatesByDb.polyphony[personId] = 'invited';
			return { inviteToken: 'tok-fresh-1' };
		});
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m4')).not.toBeNull());
		expect(q(container, 'roster-member-withdraw-m4')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m4')).toBeNull();
		expect(q(container, 'roster-row-join-state-m4')!.getAttribute('data-join-state')).toBe('invited');
	});

	it('a mint failure surfaces as an inline role="alert" on the row — no link panel, and kutsu stays for a retry', async () => {
		mintSelfLinkInviteMock.mockRejectedValue(
			new Error('self-link mint refused: HTTP 403 — the person lacks self-_editor')
		);
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		const alertEl = await waitFor(() => {
			const el = q(container, 'roster-invite-error-m4');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alertEl.getAttribute('role')).toBe('alert');
		expect(q(container, 'roster-invite-link-m4')).toBeNull();
		expect(q(container, 'roster-member-invite-m4')).not.toBeNull();
	});
});

describe('(E) saada uuesti — atomic replace via the sweep-then-mint producer', () => {
	it('calls mintSelfLinkInvite for the invited person (the invariant — old link dies in the same action — is pinned at the wire in inviteData.withdraw.spec.ts), never createInvite, and surfaces the fresh link', async () => {
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-reinvite-m3')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		expect(mintSelfLinkInviteMock.mock.calls[0][1]).toBe('pp-3');
		expect(createInviteMock).not.toHaveBeenCalled();
		const link = await waitFor(() => {
			const el = q(container, 'roster-invite-link-m3');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(link.textContent).toContain('tok-fresh-1');
	});
});

describe('(F) tühista kutse — a revocation; withdrawn collapses to never-invited', () => {
	it('calls withdrawInvite for THAT person, mints NOTHING, and on success the row REAPPEARS in the needs-inviting population: badge absent, kutsu on (Mihkel ruling — same state, no marker)', async () => {
		withdrawInviteMock.mockImplementation(async (_cfg: unknown, personId: string) => {
			joinStatesByDb.polyphony[personId] = 'absent';
		});
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-withdraw-m3')!);
		await waitFor(() => expect(withdrawInviteMock).toHaveBeenCalledTimes(1));
		expect(withdrawInviteMock.mock.calls[0][0].db).toBe('polyphony');
		expect(withdrawInviteMock.mock.calls[0][1]).toBe('pp-3');
		expect(mintSelfLinkInviteMock).not.toHaveBeenCalled();
		await waitFor(() => expect(q(container, 'roster-member-invite-m3')).not.toBeNull());
		expect(q(container, 'roster-member-reinvite-m3')).toBeNull();
		expect(q(container, 'roster-member-withdraw-m3')).toBeNull();
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('absent');
	});

	it('a withdraw failure is FAILURE: inline role="alert", and the row is NOT rendered as withdrawn — the live-credential controls stay (never a partial success rendered as done)', async () => {
		withdrawInviteMock.mockRejectedValue(
			new Error('withdraw failed: HTTP 500 on property eu-old-2 — a placeholder survives')
		);
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-withdraw-m3')!);
		const alertEl = await waitFor(() => {
			const el = q(container, 'roster-withdraw-error-m3');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alertEl.getAttribute('role')).toBe('alert');
		// The truthful state: the link may still be live, so the row still says so.
		expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull();
		expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m3')).toBeNull();
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
	});
});

describe('(G) collective switch — the #287 bug class, kept out of the new feature', () => {
	it("a minted link from collective A does not survive the switch, and B's join states are read fresh with B's cfg", async () => {
		// entu_user is PER-COLLECTIVE (a person entity exists per db): nothing
		// read or minted under A may leak into B's rows. Any armed/minted-link
		// state belongs in routeLoad's reset({isSwitch}) block
		// (roster/+page.svelte:116) alongside the #287 resets.
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(q(container, 'roster-invite-link-m4')).not.toBeNull());

		await switchToOtherChoir(container);
		expect(
			container.querySelectorAll('[data-testid^="roster-invite-link-"]')
		).toHaveLength(0);
		await waitFor(() =>
			expect(
				listJoinStatesMock.mock.calls.some((call) => {
					const [cfg, ids] = call as [{ db: string }, string[]];
					return cfg.db === 'other-choir' && ids.includes('p-bob');
				})
			).toBe(true)
		);
	});
});


// ═════════════════════════════════════════════════════════════════════════════

describe('(H) a superseded load\'s join-state tail writes NOTHING', () => {
	/** Renders with collective A's join-state fan-out held open, then switches to
	 *  B and lets B settle fully. Returns the settle function for A's tail. */
	async function renderWithHeldFanOut(
		aTail: (
			resolve: (v: Record<string, JoinState>) => void,
			reject: (e: unknown) => void
		) => () => void
	) {
		let settleA: () => void = () => {};
		listJoinStatesMock.mockImplementation((cfg: { db: string }, personIds: string[]) => {
			if (cfg.db === 'polyphony') {
				return new Promise<Record<string, JoinState>>((resolve, reject) => {
					settleA = aTail(resolve, reject);
				});
			}
			return Promise.resolve(
				Object.fromEntries(personIds.map((id) => [id, joinStatesByDb[cfg.db]?.[id] ?? 'absent']))
			);
		});
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		// A's fan-out is now in flight and blocking A's own load body.
		await waitFor(() =>
			expect(
				listJoinStatesMock.mock.calls.some((c) => (c[0] as { db: string }).db === 'polyphony')
			).toBe(true)
		);
		// Switch to B and let it complete END TO END — rows, join states, controls.
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull());
		await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
		await waitFor(() => expect(q(utils.container, 'roster-row-join-state-m-bob')).not.toBeNull());
		expect(q(utils.container, 'roster-member-invite-m-bob')).not.toBeNull();
		return { ...utils, settleA };
	}

	/** Let the released tail run its continuation and any resulting render. */
	async function flush() {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}

	it("A's fan-out RESOLVING after the switch does not overwrite B's join states — B keeps every badge and control", async () => {
		const { container, settleA } = await renderWithHeldFanOut((resolve) => () =>
			resolve({ 'person-p': 'joined', 'pp-2': 'joined', 'pp-3': 'invited', 'pp-4': 'absent' })
		);
		settleA();
		await flush();
		// Person entities are PER-DB, so A's personId-keyed record shares no key
		// with B's rows: writing it here would blank m-bob's badge and all three
		// controls until the next load, with nothing to heal it.
		expect(q(container, 'roster-row-join-state-m-bob')).not.toBeNull();
		expect(q(container, 'roster-row-join-state-m-bob')!.getAttribute('data-join-state')).toBe(
			'absent'
		);
		expect(q(container, 'roster-member-invite-m-bob')).not.toBeNull();
	});

	it("A's fan-out REJECTING after the switch does not blank B's join states either", async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container, settleA } = await renderWithHeldFanOut((_resolve, reject) => () =>
			reject(new Error('join-state fan-out failed for the collective we already left'))
		);
		settleA();
		await flush();
		expect(q(container, 'roster-row-join-state-m-bob')).not.toBeNull();
		expect(q(container, 'roster-row-join-state-m-bob')!.getAttribute('data-join-state')).toBe(
			'absent'
		);
		expect(q(container, 'roster-member-invite-m-bob')).not.toBeNull();
		// A superseded load's failure is not this page's failure to report.
		expect(
			errSpy.mock.calls.some((c) => String(c[0]).includes('join-state load failed'))
		).toBe(false);
		errSpy.mockRestore();
	});
});

describe('(I) a generation bump during an in-flight invite write re-enables the controls (#287 discipline)', () => {
	/** Holds mintSelfLinkInvite open so `inviteActionPending` is true across the
	 *  bump; the write's own `finally` is generation-guarded and will not clear
	 *  it, so only the route-load reset can. */
	function heldMint() {
		let release: () => void = () => {};
		mintSelfLinkInviteMock.mockImplementation(
			() =>
				new Promise<{ inviteToken: string }>((resolve) => {
					release = () => resolve({ inviteToken: 'tok-fresh-1' });
				})
		);
		return () => release();
	}

	it('a COLLECTIVE SWITCH mid-mint leaves the new roster\'s controls enabled, not permanently disabled', async () => {
		const release = heldMint();
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));

		await switchToOtherChoir(container);
		release();
		await new Promise((r) => setTimeout(r, 0));
		await tick();

		const control = q(container, 'roster-member-invite-m-bob');
		expect(control).not.toBeNull();
		expect((control as HTMLButtonElement).disabled).toBe(false);
	});

	it('a SAME-COLLECTIVE refresh mid-mint (a deactivate reload) leaves the controls enabled too', async () => {
		const release = heldMint();
		const { container } = await renderRoster();
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));

		// Any successful deactivate calls loadForSelected() — a generation bump
		// with no collective switch at all.
		await fireEvent.click(q(container, 'member-deactivate-m2')!);
		await waitFor(() => expect(q(container, 'member-deactivate-confirm-m2')).not.toBeNull());
		await fireEvent.click(q(container, 'member-deactivate-confirm-m2')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		// The reload re-derives the tree, so the groups come back collapsed.
		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(2));
		release();
		await new Promise((r) => setTimeout(r, 0));
		await tick();
		if (!q(container, 'roster-row-m4')) {
			await fireEvent.click(q(container, 'section-toggle-unassigned')!);
		}
		await waitFor(() => expect(q(container, 'roster-row-m4')).not.toBeNull());

		const control = q(container, 'roster-member-invite-m4');
		expect(control).not.toBeNull();
		expect((control as HTMLButtonElement).disabled).toBe(false);
	});
});

// (*MVOX:Tallis* — #294 RED: route-level wiring for three-state display,
//  owner-only controls, mint/resend/withdraw actions, and switch hygiene;
//  fixtures/idiom from page.roster-deactivate.spec.ts and
//  page.roster-pending-collective-switch.spec.ts)
// (*MVOX:Byrd* — #294 review fixes: blocks (H) and (I) pin the two stale-load
//  seams — a superseded join-state fan-out (resolve OR reject) writing last,
//  and a generation bump stranding `inviteActionPending`)
