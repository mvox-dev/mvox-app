// @vitest-environment happy-dom
//
// #268 RED — admin member records: the in-row editor on the roster (real name,
// phone, email, date of birth), pinned at the ROUTE level so GREEN cannot
// satisfy the unit layer without wiring the feature into the actual page.
// Contract: issue #268 body + release comment ("in-row expansion, roster only,
// labels as proposed").
//
//   (A) Pencil affordance `roster-row-record-edit-{memberId}` on the member
//       row, admin-only via whole-block gating (ABSENT — not disabled — for
//       non-admin/loading/error, the page's fail-closed precedent). NO
//       self-row exclusion: the contract doesn't ask for one, so the pencil is
//       pinned PRESENT on the admin's OWN row (guards against copy-pasting the
//       deactivate control's self-exclusion). Accessible name per the #262
//       lesson: static sr-only label composed with the row's visible name
//       INSIDE the button — never a templated aria-label.
//   (B) Editor opens IN PLACE inside the same <li> (#222 same-frame idiom —
//       no drawer/dialog/overlay; SectionPicker's dropdown is the WRONG
//       precedent). One editor open at a time. Close-without-save creates
//       nothing.
//   (C) Prefill (first open, no-record only — R4): name from the ROSTER'S OWN
//       domain-or-public resolution (row.name — exactly the name the roster
//       shows; NEVER resolveField, which prefers private-first and would
//       promote a private-only profile name into the domain-shared record
//       name — the #28/#58 leak class, ruling confirmed 2026-09-07). Email
//       matches the roster's email column. Phone + date of birth start EMPTY.
//       Once a record EXISTS the editor shows the RECORD only — never
//       re-prefills, never merges, never overwrites a cleared field.
//   (D) One record per member: >1 found = DAMAGED DATA — loud role=alert
//       naming the member, no writes, no self-repair (#264).
//   (E) Saves are server-confirmed, never optimistic; #259 generation guard;
//       collective switch mid-edit closes/discards; success announces via a
//       NEW fifth sr-only role=status region (roster-member-record-status);
//       failure tells the truth and keeps the typed values; partial failure
//       says exactly what landed (#253).
//   (F) Privacy fences: no field value in logs; editor fields absent from the
//       DOM for non-admins.
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
	loadMemberRecordMock,
	createMemberRecordMock,
	updateMemberRecordMock,
	listMyProfilesMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	loadMemberRecordMock: vi.fn(),
	createMemberRecordMock: vi.fn(),
	updateMemberRecordMock: vi.fn(),
	listMyProfilesMock: vi.fn()
}));
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer; the SHARED,
// profile-names-only `loadRoster` belongs to the agenda / event page / admin roles
// (Henry's roster-only scope ruling — see rosterData.ts for both contracts).
vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
// The record data layer is MOCKED at the module seam — these assertions are the
// integration pins that force GREEN to call the real module from the page.
// importActual keeps MemberRecordPartialSaveError real for the partial-failure
// case.
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: loadMemberRecordMock,
	createMemberRecord: createMemberRecordMock,
	updateMemberRecord: updateMemberRecordMock
}));
// LEAK GUARD (prefill C): if GREEN wrongly re-resolves the name via
// listMyProfiles + resolveField (private-first), it will surface 'Secret
// Private Name' — the pins below fail on that. A GREEN that prefills from
// row.name never calls this mock and passes.
vi.mock('$lib/profile/profileData', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/profileData')>()),
	listMyProfiles: listMyProfilesMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: vi.fn(),
	mintSelfLinkInvite: vi.fn()
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { MemberRecordPartialSaveError } from '$lib/roster/memberRecord';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import type { RosterRow } from '$lib/roster/rosterData';

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

// m1 is the VIEWER's own membership; m2 is another member (unassigned).
const rosterTwo: RosterRow[] = [
	{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: 'db-1' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
];

const altoSection = {
	id: 'sec-alto',
	name: 'Alto',
	displayOrder: 0,
	parentId: null,
	dbEntityId: 'db-1',
	depth: 0,
	children: []
};

const rowsOther: RosterRow[] = [
	{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: 'db-b' }
];

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	loadRosterMock.mockResolvedValue(rosterTwo);
	listSectionsMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue([]);
	listInactiveMembersMock.mockResolvedValue([]);
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
	createMemberRecordMock.mockResolvedValue('rec-new');
	updateMemberRecordMock.mockResolvedValue(undefined);
	// Leak-guard fixture: the person's PRIVATE profile carries a name she never
	// shared beyond private tier. The roster shows 'Berta Bass' (domain).
	listMyProfilesMock.mockResolvedValue([
		{ _id: 'pr-priv', name: 'Secret Private Name', email: 'berta@example.com', _sharing: 'private' },
		{ _id: 'pr-dom', name: 'Berta Bass', email: 'berta@example.com', _sharing: 'domain' }
	]);
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

// Groups default COLLAPSED — expand Unassigned (fixture members land there).
async function renderRosterAs(admin: 'admin' | 'not-admin') {
	const utils = render(Page);
	setAuthedWithOneCollective();
	adminStore.set(admin);
	await waitFor(() =>
		expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull()
	);
	await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(utils.container, 'roster-row-m2')).not.toBeNull());
	return utils;
}

async function openEditor(container: HTMLElement, memberId: string) {
	await fireEvent.click(q(container, `roster-row-record-edit-${memberId}`)!);
	await waitFor(() => {
		const li = q(container, `roster-row-${memberId}`)!;
		expect(li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
	});
}

const nameInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-name"]') as HTMLInputElement;
const phoneInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-phone"]') as HTMLInputElement;
const emailInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-email"]') as HTMLInputElement;
const birthdateInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-birthdate"]') as HTMLInputElement;

describe('(A) pencil affordance — admin-only, whole-block, every display view', () => {
	it("admin sees the pencil on another member's row", async () => {
		const { container } = await renderRosterAs('admin');
		expect(q(container, 'roster-row-record-edit-m2')).not.toBeNull();
	});

	it("the pencil IS present on the admin's OWN row — the contract has no self-row exclusion (deactivate-guard copy-paste trap)", async () => {
		const { container } = await renderRosterAs('admin');
		expect(q(container, 'roster-row-record-edit-m1')).not.toBeNull();
	});

	it('a non-admin sees NO pencil anywhere — absent, not disabled (whole-block gating)', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid^="roster-row-record-edit-"]')).toBeNull();
	});

	it('accessible name per #262: a static sr-only label composed with the row\'s visible member name INSIDE the button — never a templated aria-label', async () => {
		const { container } = await renderRosterAs('admin');
		const btn = q(container, 'roster-row-record-edit-m2')!;
		expect(btn.textContent).toContain('[roster_record_edit_label]');
		expect(btn.textContent).toContain('Berta Bass');
		// aria-label would OVERRIDE descendant content and swallow the name.
		expect(btn.getAttribute('aria-label')).toBeNull();
	});

	it('flat (alphabetical) list call site: the pencil renders there too', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle')!);
		await waitFor(() => expect(q(container, 'roster-flat-list')).not.toBeNull());
		expect(q(container, 'roster-row-record-edit-m2')).not.toBeNull();
	});

	it('section-group call site: a member inside an expanded section group carries the pencil', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadRosterMock.mockResolvedValue([
			...rosterTwo,
			{ memberId: 'm3', personId: 'pp-3', name: 'Cara Cantus', email: 'cara@example.com', sectionIds: ['sec-alto'], dbEntityId: 'db-1' }
		]);
		const utils = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() => expect(q(utils.container, 'section-toggle-sec-alto')).not.toBeNull());
		await fireEvent.click(q(utils.container, 'section-toggle-sec-alto')!);
		await waitFor(() => expect(q(utils.container, 'roster-row-m3')).not.toBeNull());
		expect(q(utils.container, 'roster-row-record-edit-m3')).not.toBeNull();
	});

	it('arrange mode renders no member rows — no pencil by construction', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-view-chip-arrange')!);
		await waitFor(() => expect(q(container, 'roster-arrange-list')).not.toBeNull());
		expect(container.querySelector('[data-testid^="roster-row-record-edit-"]')).toBeNull();
	});
});

describe('(B) editor opens IN PLACE — #222 same-frame idiom, one at a time', () => {
	it('the editor renders INSIDE the member\'s own <li> — no dialog/drawer/overlay anywhere', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		const li = q(container, 'roster-row-m2')!;
		expect(li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="roster-record-phone"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="roster-record-email"]')).not.toBeNull();
		expect(li.querySelector('[data-testid="roster-record-birthdate"]')).not.toBeNull();
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opening runs the ONE record lookup for that member (check-then-create + editor load share the query)', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		expect(loadMemberRecordMock.mock.calls[0][0]).toEqual(
			expect.objectContaining({ db: 'polyphony' })
		);
		expect(loadMemberRecordMock.mock.calls[0][1]).toBe('pp-2');
	});

	it('ONE editor open at a time: opening a second row\'s editor closes the first', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await openEditor(container, 'm1');
		const m2li = q(container, 'roster-row-m2')!;
		expect(m2li.querySelector('[data-testid="roster-record-name"]')).toBeNull();
		const m1li = q(container, 'roster-row-m1')!;
		expect(m1li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
	});

	it('close-without-save creates nothing and writes nothing', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-cancel')!);
		await waitFor(() => expect(nameInput(container)).toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});
});

describe('(B) four fields — #239 idiom: wrapping label whose visible span IS the sole accessible name', () => {
	it('name: required text input, label roster_record_name_label, no aria-label doubling', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		const input = nameInput(container);
		expect(input.tagName).toBe('INPUT');
		expect(input.required).toBe(true);
		expect(input.getAttribute('aria-label')).toBeNull();
		const label = input.closest('label');
		expect(label).not.toBeNull();
		expect(label!.textContent).toContain('[roster_record_name_label]');
	});

	it('phone: type=tel; email: type=email; birthdate: NATIVE date input (#207) — each with its own wrapping label, none with aria-label', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		const phone = phoneInput(container);
		expect(phone.type).toBe('tel');
		expect(phone.closest('label')!.textContent).toContain('[roster_record_phone_label]');
		expect(phone.getAttribute('aria-label')).toBeNull();
		const email = emailInput(container);
		expect(email.type).toBe('email');
		expect(email.closest('label')!.textContent).toContain('[roster_record_email_label]');
		expect(email.getAttribute('aria-label')).toBeNull();
		const birthdate = birthdateInput(container);
		expect(birthdate.tagName).toBe('INPUT');
		expect(birthdate.type).toBe('date');
		expect(birthdate.closest('label')!.textContent).toContain('[roster_record_birthdate_label]');
		expect(birthdate.getAttribute('aria-label')).toBeNull();
	});
});

describe('(C) prefill — first open, no-record only (R4)', () => {
	it('no record: name = the name the ROSTER shows (row.name), email = the roster\'s email column, phone and date of birth EMPTY', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(nameInput(container).value).toBe('Berta Bass');
		expect(emailInput(container).value).toBe('berta@example.com');
		expect(phoneInput(container).value).toBe('');
		expect(birthdateInput(container).value).toBe('');
	});

	it("LEAK GUARD: the name prefill NEVER surfaces a private-tier profile name — resolveField's private-first ordering is the wrong resolver for a domain-shared destination (#28/#58 class)", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(nameInput(container).value).toBe('Berta Bass');
		expect(nameInput(container).value).not.toBe('Secret Private Name');
	});

	it('a row with no email opens with an EMPTY email field — no placeholder-as-value', async () => {
		loadRosterMock.mockResolvedValue([
			rosterTwo[0],
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: '', sectionIds: [], dbEntityId: 'db-1' }
		]);
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(emailInput(container).value).toBe('');
	});

	it('record EXISTS: the editor shows the RECORD only — record name differs from the roster/profile name and the RECORD name is shown', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(nameInput(container).value).toBe('Recorded Name');
	});

	it('record EXISTS with cleared fields: empty phone/email reopen EMPTY — never re-prefilled, never merged (row.email has a value; the record wins)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(phoneInput(container).value).toBe('');
		expect(emailInput(container).value).toBe('');
	});

	it('record EXISTS with a birthdate: the date input shows the stored DATE PART verbatim (no day shift, no time component)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '1985-11-02' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(birthdateInput(container).value).toBe('1985-11-02');
	});
});

describe('(D) damaged data — more than one record (#264: loud, no guessing, no writes)', () => {
	it('surfaces a role=alert naming the member, renders NO editor fields, and never writes', async () => {
		loadMemberRecordMock.mockResolvedValue({ state: 'damaged', count: 2 });
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-row-record-edit-m2')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-damaged-m2');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('roster_record_damaged');
		// The i18n params proxy stringifies — the member must be NAMED.
		expect(alert.textContent).toContain('Berta Bass');
		expect(nameInput(container)).toBeNull();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});
});

describe('(E) save — lazy create, server-confirmed, announced', () => {
	it('the fifth sr-only role=status region roster-member-record-status is mounted from first render, empty', async () => {
		const { container } = await renderRosterAs('admin');
		const region = q(container, 'roster-member-record-status')!;
		expect(region).not.toBeNull();
		expect(region.getAttribute('role')).toBe('status');
		expect(region.getAttribute('aria-live')).toBe('polite');
		expect(region.className).toContain('sr-only');
		expect((region.textContent ?? '').trim()).toBe('');
	});

	it('no record + save → createMemberRecord ONCE with the full input (db parent, person, prefilled name/email, typed phone, empty birthdate omitted-as-empty) — and NEVER update', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5559876' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual({
			dbEntityId: 'db-1',
			personId: 'pp-2',
			name: 'Berta Bass',
			phone: '+372 5559876',
			email: 'berta@example.com',
			birthdate: ''
		});
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});

	it('SERVER-CONFIRMED, never optimistic: save disabled in flight, editor stays open and status stays silent until the create resolves; then collapse + announce', async () => {
		let release!: () => void;
		createMemberRecordMock.mockImplementation(
			() => new Promise<string>((res) => (release = () => res('rec-new')))
		);
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick();
		const save = q(container, 'roster-record-save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect(nameInput(container)).not.toBeNull();
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		release();
		await waitFor(() => expect(nameInput(container)).toBeNull());
		expect(q(container, 'roster-member-record-status')!.textContent).toContain(
			'roster_record_saved'
		);
	});

	it('a SECOND consecutive success RE-ANNOUNCES: the fresh attempt clears the live region first, so the identical text is a real DOM mutation and not a silent no-op', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() =>
			expect(q(container, 'roster-member-record-status')!.textContent).toContain(
				'roster_record_saved'
			)
		);
		// Second member, second save. A deferred create lets us look at the region
		// BETWEEN the two announcements: with the stale "Member details saved."
		// still sitting there, the success below would reassign the IDENTICAL
		// string, the text node would never change, and aria-live="polite" would
		// announce NOTHING for the admin's second successful save.
		let release!: () => void;
		createMemberRecordMock.mockImplementation(
			() => new Promise<string>((res) => (release = () => res('rec-2')))
		);
		await openEditor(container, 'm1');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick();
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		release();
		await waitFor(() =>
			expect(q(container, 'roster-member-record-status')!.textContent).toContain(
				'roster_record_saved'
			)
		);
	});

	it('record exists + save → updateMemberRecord with the record id and ONLY the changed fields; createMemberRecord never fires (no second record)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: 'Uus Nimi' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(updateMemberRecordMock.mock.calls[0][1]).toBe('rec-1');
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({ name: 'Uus Nimi' });
		expect(createMemberRecordMock).not.toHaveBeenCalled();
	});

	it('birthdate round-trip at the page seam: typing 1990-03-15 saves the DATE STRING (wire anchoring is the data layer\'s, render never day-shifts)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(birthdateInput(container), { target: { value: '1990-03-15' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({ birthdate: '1990-03-15' });
	});
});

describe('(E) failure tells the truth — typed values stay, nothing pretends to have landed', () => {
	it('a failed update: role=alert says nothing was saved, typed values STAY in the form, the form re-enables, the status region stays silent — and no field value reaches console output', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		updateMemberRecordMock.mockRejectedValue(new Error('memberRecord update failed: 500'));
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: 'Typed Secret Name' } });
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5550000' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[roster_record_save_failed]');
		// FAILURE TELLS THE TRUTH: values kept, no retyping.
		expect(nameInput(container).value).toBe('Typed Secret Name');
		expect(phoneInput(container).value).toBe('+372 5550000');
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		// PRIVACY FENCE: static strings + status codes only — never field values.
		const logged = consoleErrorSpy.mock.calls.map((c) => c.map(String).join(' ')).join(' ');
		expect(logged).not.toContain('Typed Secret Name');
		expect(logged).not.toContain('+372 5550000');
		consoleErrorSpy.mockRestore();
	});

	it('a create failure: the alert says nothing was saved and the typed values stay', async () => {
		createMemberRecordMock.mockRejectedValue(new Error('memberRecord create failed: 500'));
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5559876' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_save_failed]'
		);
		expect(phoneInput(container).value).toBe('+372 5559876');
		expect(nameInput(container)).not.toBeNull();
	});

	it('PARTIAL failure (two fields, second fails): says exactly what landed (#253) — and never echoes the failed field\'s typed VALUE', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		updateMemberRecordMock.mockRejectedValue(new MemberRecordPartialSaveError(['name'], 'email'));
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: 'Landed Name' } });
		await fireEvent.input(emailInput(container), { target: { value: 'failed@secret.example' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		// Distinct copy naming what landed — NOT the all-or-nothing message.
		expect(alert.textContent).toContain('roster_record_save_partial');
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(alert.textContent).not.toContain('failed@secret.example');
		// Typed values still in the form.
		expect(emailInput(container).value).toBe('failed@secret.example');
	});

	it('review r3 F1 — a partial error that landed NOTHING gets the all-or-nothing copy: the empty landed list must never render "saved: " with nothing after it', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		// The commonest failure there is: a single changed field whose one write
		// 500s. `updateMemberRecord` throws with landedFields === [].
		updateMemberRecordMock.mockRejectedValue(new MemberRecordPartialSaveError([], 'phone'));
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5550000' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		// Nothing landed, so the message says nothing was saved — NOT the partial
		// copy with an empty field list (#253 lying-banner class).
		expect(alert.textContent).toContain('[roster_record_save_failed]');
		expect(alert.textContent).not.toContain('roster_record_save_partial');
		// The typed value stays and the failed FIELD is still what gets logged.
		expect(phoneInput(container).value).toBe('+372 5550000');
		const logged = consoleErrorSpy.mock.calls.map((c) => c.map(String).join(' ')).join(' ');
		expect(logged).toContain('phone');
		expect(logged).not.toContain('+372 5550000');
		consoleErrorSpy.mockRestore();
	});

	it('a failure NEVER sits beside a stale success: the earlier "saved" is gone from the live region while the alert says nothing was saved (#253 lying-banner class)', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() =>
			expect(q(container, 'roster-member-record-status')!.textContent).toContain(
				'roster_record_saved'
			)
		);
		createMemberRecordMock.mockRejectedValue(new Error('memberRecord create failed: 500'));
		await openEditor(container, 'm1');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_save_failed]'
		);
		// The accessibility tree must not carry both stories at once.
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		consoleErrorSpy.mockRestore();
	});

	it('the required-name REFUSAL owns the live region too: the clear happens before the gate, so a stale "saved" cannot outlive it', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() =>
			expect(q(container, 'roster-member-record-status')!.textContent).toContain(
				'roster_record_saved'
			)
		);
		await openEditor(container, 'm1');
		await fireEvent.input(nameInput(container), { target: { value: '' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_name_required]'
		);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		expect(createMemberRecordMock).toHaveBeenCalledTimes(1); // the FIRST save only
	});
});

describe('(E) collective switch — #259 generation discipline', () => {
	async function renderTwoCollectivesAsAdmin() {
		loadRosterMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'other-choir' ? rowsOther : rosterTwo
		);
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		await waitFor(() => expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull());
		await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
		await waitFor(() => expect(q(utils.container, 'roster-row-m2')).not.toBeNull());
		return utils;
	}

	it('a collective switch mid-edit CLOSES and discards the open editor (reset({isSwitch}) carries the new state)', async () => {
		const { container } = await renderTwoCollectivesAsAdmin();
		await openEditor(container, 'm2');
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(container, 'roster-row-m2')).toBeNull());
		expect(container.querySelector('[data-testid="roster-record-name"]')).toBeNull();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});

	it('a held save SUCCESS settling after the switch writes NOTHING: no stale announcement, no reopened editor (generation captured after triggering, checked before every state write)', async () => {
		let release!: () => void;
		createMemberRecordMock.mockImplementation(
			() => new Promise<string>((res) => (release = () => res('rec-new')))
		);
		const { container } = await renderTwoCollectivesAsAdmin();
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick();
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(container, 'roster-row-m2')).toBeNull());
		release();
		await flush();
		await tick();
		expect((q(container, 'roster-member-record-status')?.textContent ?? '').trim()).toBe('');
		expect(container.querySelector('[data-testid="roster-record-name"]')).toBeNull();
	});
});

describe('(E) review F2 — the required NAME is enforced where the write happens', () => {
	// `required` on the input is inert: the editor is not wrapped in a <form>
	// and the save control is a type="button" with an onclick, so browser
	// constraint validation never runs. Entu's `mandatory` prop-def flag is a UI
	// hint too. The gate therefore has to live in the save handler — and `name`
	// is the DOMAIN-shared field, so an empty one would publish a nameless
	// domain-visible record.
	it('CREATE path: an emptied name refuses the save — createMemberRecord never fires, the refusal is a role=alert, and the other typed values stay', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5559876' } });
		await fireEvent.input(nameInput(container), { target: { value: '' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[roster_record_name_required]');
		// Its OWN copy — not the all-or-nothing failure message.
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		// Editor stays open, typed values intact, save re-armable.
		expect(nameInput(container)).not.toBeNull();
		expect(phoneInput(container).value).toBe('+372 5559876');
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
	});

	it('UPDATE path: clearing the name of an EXISTING record refuses too — updateMemberRecord never fires', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), { target: { value: 'kept@example.com' } });
		await fireEvent.input(nameInput(container), { target: { value: '' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_name_required]'
		);
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(emailInput(container).value).toBe('kept@example.com');
	});

	it('whitespace is not a name: "   " is refused exactly like ""', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: '   ' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
	});

	it('after filling the name back in, the same save goes through — the refusal is a gate, not a dead end', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: '' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		await fireEvent.input(nameInput(container), { target: { value: 'Berta Real' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ name: 'Berta Real' })
		);
	});
});

describe('(E) review F3 — the in-flight guard is ROW-SCOPED, never cleared by another row', () => {
	// replaceProperty.ts's header: the atomic overwrite is NOT a compare-and-
	// swap, so two overlapping replaces of the same property both land 200 and
	// leave a duplicate value. The calling surface's single-flight guard is the
	// only thing left standing between a double-fire and that duplicate — so it
	// must not be clearable by a path that knows nothing about the write.
	it("opening a DIFFERENT row's editor does not free the guard: the second row's save stays disabled and refuses to fire while the first write is on the wire", async () => {
		let release!: () => void;
		createMemberRecordMock.mockImplementation(
			() => new Promise<string>((res) => (release = () => res('rec-new')))
		);
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick();
		expect(createMemberRecordMock).toHaveBeenCalledTimes(1);

		// The pencil on the OTHER row — the path that used to reset the flag.
		await openEditor(container, 'm1');
		const save = q(container, 'roster-record-save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		await fireEvent.click(save);
		await flush();
		await tick();
		// Still exactly the FIRST row's create — the second never started.
		expect(createMemberRecordMock).toHaveBeenCalledTimes(1);

		// Once the in-flight write settles the guard frees itself, and only then.
		release();
		await waitFor(() =>
			expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false)
		);
	});

	it("cancel stays live on another row while a write is in flight — closing an editor writes nothing, so the admin is never trapped", async () => {
		createMemberRecordMock.mockImplementation(() => new Promise<string>(() => {}));
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick();
		await openEditor(container, 'm1');
		const cancel = q(container, 'roster-record-cancel') as HTMLButtonElement;
		expect(cancel.disabled).toBe(false);
		await fireEvent.click(cancel);
		await waitFor(() => expect(nameInput(container)).toBeNull());
	});

	it("the saving row's OWN cancel is disabled while its write is in flight", async () => {
		createMemberRecordMock.mockImplementation(() => new Promise<string>(() => {}));
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick();
		expect((q(container, 'roster-record-cancel') as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('(E) review F1 — clearing the date of birth reaches the data layer as a CLEAR', () => {
	it('emptying the date input sends birthdate: "" as the changed field (the data layer turns that into a property REMOVAL, never a datetime: "" overwrite)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '1985-11-02' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(birthdateInput(container).value).toBe('1985-11-02');
		await fireEvent.input(birthdateInput(container), { target: { value: '' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({ birthdate: '' });
	});

	it('reopening after the clear shows an EMPTY date input — a cleared date of birth stays cleared (R4)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '1985-11-02' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(birthdateInput(container), { target: { value: '' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(nameInput(container)).toBeNull());
		// The record now reads back with no birthdate.
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		await openEditor(container, 'm2');
		expect(birthdateInput(container).value).toBe('');
	});
});

describe('(E) review r3 F2 — the one-record check runs AT THE SAVE, not at editor-open', () => {
	// #268's check-then-create invariant guards the WRITE. Branching on the
	// lookup cached when the editor opened let a create fire on a stale reading:
	// a retry after an ambiguous create failure, or a second admin saving the
	// same pre-record member, produced a SECOND record — `state: 'damaged'`,
	// which #264 forbids the app to repair. The save therefore re-reads first.
	it('the save re-reads the record before writing — a second lookup for the same person', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(2);
		expect(loadMemberRecordMock.mock.calls[1][1]).toBe('pp-2');
	});

	it('a record that appeared AFTER the editor opened turns the save into an UPDATE against the freshly-read id — createMemberRecord never fires, so no duplicate is ever made', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2'); // opened on 'none' — the create path
		// Between open and save the record came into existence: the admin's own
		// retry after an ambiguous create failure, or a second admin's save.
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-raced', name: 'Berta Bass', phone: '', email: '', birthdate: '' }
		});
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock.mock.calls[0][1]).toBe('rec-raced');
		// No cached baseline on this path (the editor opened expecting a create),
		// so the write carries the prefilled values it holds — and nothing more:
		// a field left empty never blanks a value this editor never saw.
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({
			name: 'Berta Bass',
			email: 'berta@example.com'
		});
		// Server-confirmed all the same: editor collapses, success announced.
		await waitFor(() => expect(nameInput(container)).toBeNull());
		expect(q(container, 'roster-member-record-status')!.textContent).toContain(
			'roster_record_saved'
		);
	});

	it('a save whose fresh lookup comes back DAMAGED writes NOTHING and hands the row to the damaged alert (#264: no guessing, no self-repair)', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5559876' } });
		loadMemberRecordMock.mockResolvedValue({ state: 'damaged', count: 2 });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-damaged-m2');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		// Nothing pretends to have been saved, and the save guard frees itself.
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		expect(q(container, 'roster-record-save-error')).toBeNull();
	});
});

describe('(F) privacy fence — non-admins never get the fields in the DOM', () => {
	it('no editor field testid exists anywhere for a non-admin (whole-block gating, not hidden/disabled)', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid="roster-record-name"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-phone"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-email"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-birthdate"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — #268 RED, route-level)
// (*MVOX:Josquin* — #268 review F1/F2/F3 pins)
// (*MVOX:Josquin* — #268 review r3 pins: empty-landed failure copy, save-time
//  existence check)
