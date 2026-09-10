// @vitest-environment happy-dom
//
// #302 RED — the roster member card's interaction model, at the ROUTE level so
// GREEN cannot satisfy any of it without wiring the actual /roster page.
// Contract: issue #302 body + Gama's on-issue ruling (drive-path edits allowed
// in the pre-existing specs, assertion edits forbidden — this file carries the
// NEW claims; the frozen behaviour claims stay where they were written).
//
//   (1) CARD AS ACTIVATOR — the pencil (`roster-row-record-edit-{memberId}`)
//       is GONE. The collapsed card itself carries the interactive role:
//       `roster-row-card-{memberId}`, a REAL <button> (native Enter/Space +
//       tab-reachability — never a div-onclick), accessible name
//       content-derived per #262 (action label + THAT member's name inside the
//       element, no templated aria-label). The editor renders INSIDE the same
//       row block, so the collapsed card and the open editor are mutually
//       exclusive states: opening REPLACES the activator with the form —
//       interactive controls are never nested inside an interactive parent
//       (the arrange-row WCAG 4.1.2 lesson, roster/+page.svelte:4630+). The
//       record editor keeps NO self-row exclusion: the admin's own card opens.
//   (2) CHIPS — the join-state badge moves DIRECTLY under name+email (before
//       the section name). Joined is the SILENT default: no chip at all.
//       Not-invited and invited-awaiting keep DISTINCT chips — if both were
//       silent, the two states #294 exists to distinguish would collapse into
//       one. Still contents-derived via listJoinStates, still every admin.
//   (3) RELOCATION — the invite controls (kutsu / saada uuesti / tühista
//       kutse, owner-only, routed purely off state) and the deactivate
//       armed-pair render ONLY inside an opened record editor. The self-row
//       asymmetry survives the shared container: the admin's OWN card opens
//       but carries no deactivate control (`row.personId !== selected?.personId`
//       does not merge with the editor's deliberate no-exclusion). Handlers
//       and their generation guards are UNTOUCHED — this is a relocation; the
//       behaviour claims stay frozen in the #286/#287/#294/#296 specs, whose
//       drive paths gained only an open-the-editor step. The owner note
//       (`roster-invite-owner-note`) stays page-level.
//
//   ARMED-PAIR EXCEPTION (narrow, deliberate): this file pins the REST state
//   only — a collapsed row carries no deactivate control. It does NOT pin the
//   armed/in-flight state to the open editor: the #286 "second row cannot be
//   armed mid-flight" test (page.roster-deactivate.spec.ts) freezes the claim
//   that an in-flight row's confirm/cancel pair stays MOUNTED even while
//   another row's editor opens (opening another editor closes this one), so an
//   armed pair must survive its editor closing. Destructive in-flight UI never
//   silently unmounts.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
	resolveOwnerTierMock,
	loadMemberRecordMock
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
	resolveOwnerTierMock: vi.fn(),
	loadMemberRecordMock: vi.fn()
}));

vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
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
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: loadMemberRecordMock
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

// m1 is the VIEWER's own membership (person-p); m2 joined, m3 invited, m4
// never invited — all unassigned. m5 is invited AND carries a section, for the
// badge-before-section-name placement pin (flat view renders section names).
function rows(): RosterRow[] {
	return [
		{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: 'org-a' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'org-a' },
		{ memberId: 'm3', personId: 'pp-3', name: 'Carl Cantor', email: 'carl@example.com', sectionIds: [], dbEntityId: 'org-a' },
		{ memberId: 'm4', personId: 'pp-4', name: 'Dora Descant', email: 'dora@example.com', sectionIds: [], dbEntityId: 'org-a' },
		{ memberId: 'm5', personId: 'pp-5', name: 'Elsa Echo', email: 'elsa@example.com', sectionIds: ['sec-alto'], dbEntityId: 'org-a' }
	];
}

function tree(): SectionNode[] {
	return [
		{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, dbEntityId: 'org-a', depth: 0, children: [] }
	];
}

function setAuthed() {
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

beforeEach(() => {
	loadRosterMock.mockResolvedValue(rows());
	listSectionsMock.mockResolvedValue(tree());
	listJoinStatesMock.mockImplementation((_cfg: unknown, personIds: string[]) =>
		Promise.resolve(
			Object.fromEntries(
				personIds.map((id) => [
					id,
					({ 'person-p': 'joined', 'pp-2': 'joined', 'pp-3': 'invited', 'pp-4': 'absent', 'pp-5': 'invited' } as const)[
						id as 'person-p' | 'pp-2' | 'pp-3' | 'pp-4' | 'pp-5'
					] ?? 'absent'
				])
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
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
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

function rowLi(container: HTMLElement, memberId: string): HTMLElement {
	const li = q(container, `roster-row-${memberId}`);
	expect(li, `roster-row-${memberId} must render`).not.toBeNull();
	return li!;
}

// Groups default COLLAPSED — expand Unassigned (m1–m4 land there).
async function renderRosterAs(
	admin: 'admin' | 'not-admin',
	tier: 'owner' | 'editor' = 'owner'
) {
	resolveOwnerTierMock.mockResolvedValue(tier);
	const utils = render(Page);
	setAuthed();
	adminStore.set(admin);
	await waitFor(() => expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull());
	await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(utils.container, 'roster-row-m2')).not.toBeNull());
	return utils;
}

// The #302 drive: activate the collapsed card, wait for THAT row's editor.
async function openCard(container: HTMLElement, memberId: string) {
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `#302: collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card!);
	await waitFor(() => {
		expect(
			rowLi(container, memberId).querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull();
	});
}

const INVITE_CONTROL_SELECTOR =
	'[data-testid^="roster-member-invite-"], [data-testid^="roster-member-reinvite-"], [data-testid^="roster-member-withdraw-"]';
const DEACTIVATE_CONTROL_SELECTOR =
	'[data-testid^="member-deactivate-"]:not([data-testid^="member-deactivate-refused-"]):not([data-testid^="member-deactivate-failed-"])';

// ═════════════════════════════════════════════════════════════════════════════

describe('(1) the collapsed card is the activator — pencil gone, real button, content-derived name', () => {
	it('the pencil is GONE: no roster-row-record-edit-* element renders anywhere', async () => {
		const { container } = await renderRosterAs('admin');
		expect(container.querySelector('[data-testid^="roster-row-record-edit-"]')).toBeNull();
	});

	it("the collapsed card is a REAL <button type=button> — native Enter/Space and tab order, never a div-onclick", async () => {
		const { container } = await renderRosterAs('admin');
		const card = q(container, 'roster-row-card-m2');
		expect(card).not.toBeNull();
		expect(card!.tagName).toBe('BUTTON');
		expect(card!.getAttribute('type')).toBe('button');
	});

	it("accessible name per #262, scaled to the whole card: the action label AND that member's name are element CONTENT — no templated aria-label", async () => {
		const { container } = await renderRosterAs('admin');
		const card = q(container, 'roster-row-card-m2')!;
		expect(card.textContent).toContain('[roster_record_edit_label]');
		expect(card.textContent).toContain('Berta Bass');
		// aria-label would OVERRIDE descendant content with identical text for
		// every row — the exact defect #262 removed.
		expect(card.getAttribute('aria-label')).toBeNull();
	});

	it('the collapsed activator nests NO interactive element (WCAG 4.1.2 — the SectionPicker and all controls sit outside it)', async () => {
		const { container } = await renderRosterAs('admin');
		const card = q(container, 'roster-row-card-m2')!;
		expect(
			card.querySelector('button, input, select, textarea, a[href], [tabindex]')
		).toBeNull();
	});

	// #302 review F1 — the claim above ("nests nothing") is satisfied by TWO very
	// different shapes, and the first GREEN shipped the wrong one: a self-sized
	// sibling (`block w-full min-h-11`) that painted as an empty strip between
	// the section name and the picker. Every behavioural test in this file still
	// passed — they all click the activator by testid, which a blank strip
	// answers just as well as a real card — while a human clicking the member's
	// NAME got nothing. So the shape needs its own pin. happy-dom has no layout
	// engine and no Tailwind stylesheet, so the classes ARE the observable here;
	// asserting them is what makes "the whole card is the hit region" checkable
	// at this level at all.
	it('the activator COVERS the card: a stretched overlay over a positioned row, not a strip of its own', async () => {
		const { container } = await renderRosterAs('admin');
		const li = rowLi(container, 'm2');
		const card = q(container, 'roster-row-card-m2')!;
		// The row is the positioning context the overlay stretches over.
		expect(li.className.split(/\s+/)).toContain('relative');
		const cls = card.className.split(/\s+/);
		expect(cls).toContain('absolute');
		expect(cls).toContain('inset-0');
		// Any self-sizing utility means it is laying itself out as a sibling box
		// again — the regression this test exists for.
		for (const sizing of ['block', 'w-full', 'min-h-11', 'mt-1']) {
			expect(cls, `activator must not size itself (${sizing})`).not.toContain(sizing);
		}
		// The 44px touch-target floor moved to the row, since the overlay now
		// takes its height FROM the row.
		expect(li.className.split(/\s+/)).toContain('min-h-11');
		// It must stay visible at rest: the ✎ glyph it replaced was at least a
		// visible affordance, and a transparent overlay with no box of its own
		// would leave the card looking inert.
		expect(cls.some((c) => c === 'border' || c.startsWith('border-'))).toBe(true);
		expect(cls.some((c) => c.startsWith('focus-visible:'))).toBe(true);
	});

	// #302 review F1 — the overlay covers the WHOLE row, so anything still
	// interactive on a collapsed row has to be lifted above it or it is dead to
	// the pointer. Two things can: the SectionPicker (every admin row) and an
	// armed/in-flight deactivate pair (the armed-pair exception). Both are
	// lifted with a bare `relative` and both are written AFTER the activator —
	// positioned siblings at `z-index: auto` paint in tree order, so that is the
	// whole mechanism. Deliberately NOT `z-10`: a z-index would make each row a
	// stacking context and trap the picker's `absolute z-10` drop-down, which
	// must hang over the FOLLOWING rows, inside its own row.
	it('the SectionPicker on a collapsed row is lifted above the overlay, and comes after it in tree order', async () => {
		const { container } = await renderRosterAs('admin');
		const li = rowLi(container, 'm2');
		const card = q(container, 'roster-row-card-m2')!;
		const trigger = q(container, 'section-picker-trigger-m2');
		expect(trigger, 'the picker renders on a collapsed admin row').not.toBeNull();
		const lifted = trigger!.closest('.relative');
		expect(lifted, 'the picker must sit inside a positioned wrapper').not.toBeNull();
		expect(lifted!.className.split(/\s+/)).not.toContain('z-10');
		expect(
			card.compareDocumentPosition(lifted!) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the lifted picker must FOLLOW the activator in tree order'
		).toBeTruthy();
		expect(li.contains(lifted!)).toBe(true);
	});

	it('an armed deactivate pair left on a COLLAPSED row is lifted above the overlay', async () => {
		const { container } = await renderRosterAs('admin');
		// Arm m2 from its editor, then open m3's card — one editor at a time, so
		// m2 collapses while its armed pair stays mounted (#286).
		await openCard(container, 'm2');
		await fireEvent.click(q(container, 'member-deactivate-m2')!);
		await waitFor(() => expect(q(container, 'member-deactivate-confirm-m2')).not.toBeNull());
		await openCard(container, 'm3');

		const card = q(container, 'roster-row-card-m2');
		expect(card, 'm2 is collapsed again — its activator is back').not.toBeNull();
		const confirm = q(container, 'member-deactivate-confirm-m2');
		expect(confirm, "the armed pair survives its editor closing").not.toBeNull();
		const lifted = confirm!.closest('.relative');
		expect(lifted, 'the armed pair must sit inside a positioned wrapper').not.toBeNull();
		expect(lifted!.className.split(/\s+/)).not.toContain('z-10');
		expect(
			card!.compareDocumentPosition(lifted!) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the lifted pair must FOLLOW the activator in tree order'
		).toBeTruthy();
	});

	it("activating the card opens THAT member's record editor in place", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2');
		const li = rowLi(container, 'm2');
		expect(li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
		// One editor at a time — m3's row is untouched.
		expect(
			rowLi(container, 'm3').querySelector('[data-testid="roster-record-name"]')
		).toBeNull();
	});

	it('an OPEN card is a form, not a button: the activator is replaced, and no editor field sits inside an interactive parent', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2');
		// The collapsed activator and the open editor are mutually exclusive.
		expect(q(container, 'roster-row-card-m2')).toBeNull();
		for (const testid of [
			'roster-record-name',
			'roster-record-phone',
			'roster-record-email',
			'roster-record-birthdate',
			'roster-record-id-code',
			'roster-record-save',
			'roster-record-cancel'
		]) {
			const el = rowLi(container, 'm2').querySelector(`[data-testid="${testid}"]`);
			expect(el, `${testid} must render inside the open card`).not.toBeNull();
			expect(
				el!.closest('button, [role="button"]'),
				`${testid} must not be nested inside an interactive parent`
			).toBe(el!.tagName === 'BUTTON' ? el : null);
		}
	});

	it("the admin's OWN card opens — the record editor keeps its no-self-row-exclusion contract (deactivate-guard copy-paste trap)", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm1');
		expect(
			rowLi(container, 'm1').querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull();
	});

	it('a non-admin gets NO card activator anywhere — absent, not disabled', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid^="roster-row-card-"]')).toBeNull();
	});
});

describe('(2) chips — joined is silent; not-invited and invited-awaiting stay distinct; directly under name+email', () => {
	it('a JOINED member shows NO chip at all (m1, m2)', async () => {
		const { container } = await renderRosterAs('admin');
		// Readiness: an invited row's chip is on screen, so the fan-out landed.
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(q(container, 'roster-row-join-state-m1')).toBeNull();
		expect(q(container, 'roster-row-join-state-m2')).toBeNull();
	});

	it('not-invited and invited-awaiting each keep a DISTINCT chip — silent-both would collapse the two states #294 distinguishes', async () => {
		const { container } = await renderRosterAs('admin');
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
		expect(q(container, 'roster-row-join-state-m4')!.getAttribute('data-join-state')).toBe('absent');
	});

	it('the chip renders directly under name+email: after the email, BEFORE the section name', async () => {
		const { container } = await renderRosterAs('admin');
		// Flat view renders every row with its section name (m5: Alto, invited).
		await fireEvent.click(q(container, 'roster-sort-toggle')!);
		await waitFor(() => expect(q(container, 'roster-flat-list')).not.toBeNull());
		await waitFor(() => expect(q(container, 'roster-row-join-state-m5')).not.toBeNull());
		const li = rowLi(container, 'm5');
		const email = li.querySelector('[data-testid="roster-row-email"]')!;
		const badge = q(container, 'roster-row-join-state-m5')!;
		const section = li.querySelector('[data-testid="roster-row-section"]')!;
		expect(email, 'email span must render on m5').not.toBeNull();
		expect(section, 'section span must render on m5 in flat view').not.toBeNull();
		expect(
			email.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the chip must come AFTER the email'
		).toBeTruthy();
		expect(
			badge.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the chip must come BEFORE the section name'
		).toBeTruthy();
	});

	it('an EDITOR-admin still sees the chips — the display is for every admin (PO ruling 2026-09-09), only joined went silent', async () => {
		const { container } = await renderRosterAs('admin', 'editor');
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(q(container, 'roster-row-join-state-m3')!.getAttribute('data-join-state')).toBe('invited');
		expect(q(container, 'roster-row-join-state-m4')!.getAttribute('data-join-state')).toBe('absent');
		expect(q(container, 'roster-row-join-state-m2')).toBeNull();
	});
});

describe('(3) relocation — invite controls and the deactivate pair live inside the opened editor only', () => {
	it('the REST state: a collapsed row carries NO invite control and NO deactivate control, on any row', async () => {
		const { container } = await renderRosterAs('admin');
		await waitFor(() => expect(q(container, 'roster-row-join-state-m3')).not.toBeNull());
		expect(container.querySelectorAll(INVITE_CONTROL_SELECTOR)).toHaveLength(0);
		expect(container.querySelectorAll(DEACTIVATE_CONTROL_SELECTOR)).toHaveLength(0);
	});

	it("opening a never-invited member's card (owner-admin): kutsu renders INSIDE that row, and only kutsu — state routing unchanged", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm4');
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		expect(rowLi(container, 'm4').contains(q(container, 'roster-member-invite-m4'))).toBe(true);
		expect(q(container, 'roster-member-reinvite-m4')).toBeNull();
		expect(q(container, 'roster-member-withdraw-m4')).toBeNull();
	});

	it("opening an invited member's card: saada uuesti + tühista kutse inside the row, kutsu unreachable", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm3');
		await waitFor(() => expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull());
		expect(rowLi(container, 'm3').contains(q(container, 'roster-member-reinvite-m3'))).toBe(true);
		expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull();
		expect(q(container, 'roster-member-invite-m3')).toBeNull();
	});

	it("opening a joined member's card: NO invite controls, and the deactivate trigger renders inside the row", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2');
		await waitFor(() => expect(q(container, 'member-deactivate-m2')).not.toBeNull());
		expect(rowLi(container, 'm2').contains(q(container, 'member-deactivate-m2'))).toBe(true);
		expect(container.querySelectorAll(INVITE_CONTROL_SELECTOR)).toHaveLength(0);
	});

	it("SELF-ROW ASYMMETRY: the admin's OWN card opens, but no deactivate control renders in it — the two guards do not merge", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm1');
		// The editor is open (form on screen) …
		expect(
			rowLi(container, 'm1').querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull();
		// … and the deactivate surface is ABSENT here, by render condition.
		expect(q(container, 'member-deactivate-m1')).toBeNull();
		expect(q(container, 'member-deactivate-confirm-m1')).toBeNull();
	});

	it('an EDITOR-admin opening a card gets NO invite controls inside it — owner gating unchanged by the move', async () => {
		const { container } = await renderRosterAs('admin', 'editor');
		await openCard(container, 'm4');
		expect(container.querySelectorAll(INVITE_CONTROL_SELECTOR)).toHaveLength(0);
	});

	it('the owner note stays PAGE-LEVEL: rendered once for an editor-admin, outside every row, editor open or not', async () => {
		const { container } = await renderRosterAs('admin', 'editor');
		await waitFor(() => expect(q(container, 'roster-invite-owner-note')).not.toBeNull());
		const notes = container.querySelectorAll('[data-testid="roster-invite-owner-note"]');
		expect(notes).toHaveLength(1);
		expect(notes[0].closest('li[data-testid^="roster-row-"]')).toBeNull();
		// Opening a card neither moves nor duplicates it.
		await openCard(container, 'm4');
		expect(container.querySelectorAll('[data-testid="roster-invite-owner-note"]')).toHaveLength(1);
	});

	it('INTEGRATION: kutsu clicked inside the opened editor still drives the untouched handler — mintSelfLinkInvite for THAT person, never createInvite', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm4');
		await waitFor(() => expect(q(container, 'roster-member-invite-m4')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-member-invite-m4')!);
		await waitFor(() => expect(mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		expect(mintSelfLinkInviteMock.mock.calls[0][1]).toBe('pp-4');
		expect(createInviteMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — #302 RED: card-as-activator, silent-joined chips, control
//  relocation. Drive-path idiom (openCard) mirrored into the pre-existing
//  #286/#287/#294/#296 specs per the on-issue ruling; their assertions frozen.)
