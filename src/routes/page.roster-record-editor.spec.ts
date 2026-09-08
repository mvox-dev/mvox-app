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
// #285 — KEBAB testid, the file's unbroken convention ('roster-record-idcode'
// would be its only violation).
const idCodeInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-id-code"]') as HTMLInputElement;

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
			birthdate: '',
			// #285 — the fifth field rides in the create input, empty here (no
			// prefill source exists for it; empty-as-empty like birthdate).
			id_code: ''
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
		// #285 — the fifth field is fenced identically: absent, not disabled.
		expect(container.querySelector('[data-testid="roster-record-id-code"]')).toBeNull();
	});
});

describe('(#283) environment smoke — the guard primitives hold in THIS environment, not by inference', () => {
	// Toolchain note: `/\p{L}/u` has ZERO precedent in this codebase, so its
	// behaviour is pinned HERE, inside the suite's own environment (esnext
	// target, Node 22, happy-dom via @vitest-environment above) — not inferred
	// from spec sheets.
	it('/\\p{L}/u matches letters in ANY alphabet (õ, š, Cyrillic А) and rejects digits, +, spaces, parens, hyphens and dots', () => {
		expect(/\p{L}/u.test('õ')).toBe(true);
		expect(/\p{L}/u.test('š')).toBe(true);
		expect(/\p{L}/u.test('А')).toBe(true); // CYRILLIC CAPITAL A, not Latin
		expect(/\p{L}/u.test('0123456789')).toBe(false);
		expect(/\p{L}/u.test('+372 5555 5555')).toBe(false);
		expect(/\p{L}/u.test('+44 (0)20 7946 0958')).toBe(false);
		expect(/\p{L}/u.test('372.5555.5555')).toBe(false);
		expect(/\p{L}/u.test('+1-555-0100')).toBe(false);
	});

	// Gama's #283 ruling routes the email guard through the BROWSER'S OWN
	// constraint validation — `checkValidity()` on the type=email element, no
	// hand-rolled regex. That only works if this suite's DOM implementation
	// actually computes email validity; pin it directly so a happy-dom upgrade
	// that stops validating turns THIS test red instead of silently hollowing
	// out the guard tests below.
	it("happy-dom computes type=email validity: 'not an email' invalid, 'a@b' valid, '' valid (optional-field semantics), 'a@b@c' invalid", () => {
		const el = document.createElement('input');
		el.type = 'email';
		el.value = 'not an email';
		expect(el.checkValidity()).toBe(false);
		el.value = 'a@b';
		expect(el.checkValidity()).toBe(true);
		el.value = '';
		expect(el.checkValidity()).toBe(true);
		el.value = 'a@b@c';
		expect(el.checkValidity()).toBe(false);
	});
});

describe('(#283) phone guard — letters refuse the save; + and friends survive (name-required idiom)', () => {
	// Joosep, verbatim: "ei luba tähti salvestada aga + märki lubab" — a guard
	// on the WRITE, not a filter on typing. The rule is rejection-of-letters
	// ONLY (`/\p{L}/u`): the issue explicitly forbids an allowlist, because an
	// allowlist that forgets a legitimate character rejects a valid number
	// while claiming to be a fix. Placement is the name-required slot in
	// `saveRecordEditor`: a refusal is NOT a write — it must never arm the
	// single-flight lock, never reach the fresh-lookup re-read, never touch
	// the partial/damaged/failed error kinds.
	it("CREATE path: 'tel: 555' refuses the save — its OWN role=alert copy, no write, no lookup re-read, no single-flight arming; sibling typed fields survive", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1); // the editor open
		await fireEvent.input(nameInput(container), { target: { value: 'Berta Real' } });
		await fireEvent.input(birthdateInput(container), { target: { value: '1990-03-15' } });
		await fireEvent.input(phoneInput(container), { target: { value: 'tel: 555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		// The guard's OWN copy — never the all-or-nothing failure message.
		expect(alert.textContent).toContain('[roster_record_phone_invalid]');
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		// PLACEMENT: the refusal fired BEFORE the fresh-lookup suspension point —
		// still only the editor-open read.
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		// PLACEMENT: the single-flight lock was never armed — save re-armable,
		// the row's own cancel never went disabled.
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-record-cancel') as HTMLButtonElement).disabled).toBe(false);
		// Editor stays open with everything the admin typed still in it.
		expect(nameInput(container).value).toBe('Berta Real');
		expect(birthdateInput(container).value).toBe('1990-03-15');
		expect(phoneInput(container).value).toBe('tel: 555');
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
	});

	it("'õhtul helistada' is refused — Estonian letters are letters (a /[a-z]/i check would pass õäöü)", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: 'õhtul helistada' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_phone_invalid]'
		);
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});

	it("'тел 555' is refused — Cyrillic letters are letters too, any alphabet", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: 'тел 555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_phone_invalid]'
		);
		expect(createMemberRecordMock).not.toHaveBeenCalled();
	});

	it('PRIVACY (crede real-PII law): the refusal copy is a STATIC string naming the field — the typed value appears in no alert and no console output', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: 'õhtul helistada 555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.textContent).not.toContain('õhtul helistada 555');
		const logged = [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]
			.map((c) => c.map(String).join(' '))
			.join(' ');
		expect(logged).not.toContain('õhtul helistada 555');
		consoleErrorSpy.mockRestore();
		consoleLogSpy.mockRestore();
	});

	it("'+372 5555 5555' saves UNCHANGED — + survives by construction (foreign travel is the normal case, #282)", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5555 5555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual({
			dbEntityId: 'db-1',
			personId: 'pp-2',
			name: 'Berta Bass',
			phone: '+372 5555 5555',
			email: 'berta@example.com',
			birthdate: '',
			id_code: '' // #285 — 5-field create-input shape
		});
	});

	// NO ALLOWLIST — the issue's explicit trap warning: spaces, parens, hyphens
	// and dots are not letters, so every one of these legitimate shapes passes.
	it.each(['+44 (0)20 7946 0958', '372.5555.5555', '+1-555-0100'])(
		"'%s' saves verbatim — rejection-of-letters only, never an allowlist",
		async (phone) => {
			const { container } = await renderRosterAs('admin');
			await openEditor(container, 'm2');
			await fireEvent.input(phoneInput(container), { target: { value: phone } });
			await fireEvent.click(q(container, 'roster-record-save')!);
			await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
			expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
				expect.objectContaining({ phone })
			);
		}
	);

	it('an EMPTY phone still saves — the field is optional and stays so', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(phoneInput(container).value).toBe('');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ phone: '' })
		);
	});

	it("UPDATE path: letters in an EXISTING record's phone refuse too — updateMemberRecord never fires, sibling typed change survives", async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), { target: { value: 'kept@example.com' } });
		await fireEvent.input(phoneInput(container), { target: { value: 'mob. 555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_phone_invalid]'
		);
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(emailInput(container).value).toBe('kept@example.com');
	});

	it('the phone REFUSAL owns the live region too: cleared-before-gate ordering — a stale "saved" cannot outlive it', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() =>
			expect(q(container, 'roster-member-record-status')!.textContent).toContain(
				'roster_record_saved'
			)
		);
		await openEditor(container, 'm1');
		await fireEvent.input(phoneInput(container), { target: { value: 'tel: 555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_phone_invalid]'
		);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		expect(createMemberRecordMock).toHaveBeenCalledTimes(1); // the FIRST save only
	});

	it('after removing the letters, the same save goes through — the refusal is a gate, not a dead end', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: 'tel: 555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		await fireEvent.input(phoneInput(container), { target: { value: '+372 555' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ phone: '+372 555' })
		);
	});
});

describe("(#283) email guard — the browser's OWN constraint validation, weakest-rule fence", () => {
	// Gama's ruling on #283: the guard is `emailInputEl && !emailInputEl.
	// checkValidity()` — the browser's deliberately-permissive email rule, NO
	// hand-rolled regex of ours to write, argue about, or later "improve".
	it("'not an email' refuses the save — its OWN role=alert copy, no write, no lookup re-read, no single-flight arming", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		await fireEvent.input(emailInput(container), { target: { value: 'not an email' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[roster_record_email_invalid]');
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1); // no fresh-lookup re-read
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-record-cancel') as HTMLButtonElement).disabled).toBe(false);
		expect(emailInput(container).value).toBe('not an email');
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
	});

	// WEAKEST-RULE FENCE (Gama, #283, verbatim law): "The rule must stay the
	// weakest thing that closes the reported hole." A future guard that rejects
	// 'a@b' is a CONTRACT VIOLATION — it would start rejecting real addresses
	// to catch a class of typo nobody has reported. This passing pin IS the
	// fence: improvement is refused on sight, with a reason.
	it("WEAKEST-RULE FENCE: 'a@b' SAVES — a stricter guard that rejects it is a regression, not an improvement", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), { target: { value: 'a@b' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual({
			dbEntityId: 'db-1',
			personId: 'pp-2',
			name: 'Berta Bass',
			phone: '',
			email: 'a@b',
			birthdate: '',
			id_code: '' // #285 — 5-field create-input shape
		});
		expect(q(container, 'roster-record-save-error')).toBeNull();
	});

	it("'a@b@c' is refused — the browser's rule catches it, no regex of ours involved", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), { target: { value: 'a@b@c' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_email_invalid]'
		);
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});

	it('an EMPTY email still saves — the field is optional and stays so (optional-field semantics of checkValidity)', async () => {
		loadRosterMock.mockResolvedValue([
			rosterTwo[0],
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: '', sectionIds: [], dbEntityId: 'db-1' }
		]);
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(emailInput(container).value).toBe('');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ email: '' })
		);
	});

	it('a normal address saves unchanged — plus-addressing and subdomains included', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), {
			target: { value: 'mari.tamm+koor@mail.example.co.uk' }
		});
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ email: 'mari.tamm+koor@mail.example.co.uk' })
		);
	});

	it("UPDATE path: a malformed email on an EXISTING record refuses too — updateMemberRecord never fires", async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5550000' } });
		await fireEvent.input(emailInput(container), { target: { value: 'not an email' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_email_invalid]'
		);
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(phoneInput(container).value).toBe('+372 5550000');
	});

	it('PRIVACY (crede real-PII law): the email refusal copy is STATIC — the typed value appears in no alert and no console output', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), { target: { value: 'secret typo @ example' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.textContent).not.toContain('secret typo @ example');
		const logged = [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]
			.map((c) => c.map(String).join(' '))
			.join(' ');
		expect(logged).not.toContain('secret typo @ example');
		consoleErrorSpy.mockRestore();
		consoleLogSpy.mockRestore();
	});

	it('after fixing the address, the same save goes through — the refusal is a gate, not a dead end', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), { target: { value: 'not an email' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		await fireEvent.input(emailInput(container), { target: { value: 'berta@example.com' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
	});
});

describe('(#285) the FIFTH field — Isikukood, after Sünnikuupäev, #239 idiom, no prefill', () => {
	it('renders inside the open editor: type=text, kebab testid roster-record-id-code, wrapping label whose visible text ([roster_record_id_code_label]) is the SOLE accessible name — no aria-label', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		const input = idCodeInput(container);
		expect(input).not.toBeNull();
		expect(input.tagName).toBe('INPUT');
		expect(input.type).toBe('text');
		expect(input.getAttribute('aria-label')).toBeNull();
		const label = input.closest('label');
		expect(label).not.toBeNull();
		expect(label!.textContent).toContain('[roster_record_id_code_label]');
	});

	it('sits INSIDE the same <li> as the rest of the editor (whole-block admin gate inherited — no per-field gating), AFTER the birthdate block in DOM order (ordinal 6)', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		const li = q(container, 'roster-row-m2')!;
		const idCode = li.querySelector('[data-testid="roster-record-id-code"]');
		expect(idCode).not.toBeNull();
		const birthdate = li.querySelector('[data-testid="roster-record-birthdate"]')!;
		expect(
			birthdate.compareDocumentPosition(idCode!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('NO PREFILL on the no-record path: opens EMPTY (nothing to prefill from — the profile layer has no such field) even while name/email prefill from the row', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(nameInput(container).value).toBe('Berta Bass'); // siblings DO prefill
		expect(idCodeInput(container).value).toBe('');
	});

	it('record path, record without an id_code: opens EMPTY too — never invented, never merged from anywhere', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '', id_code: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(idCodeInput(container).value).toBe('');
	});

	it('record path, record WITH an id_code: the editor shows the RECORD value (record display, not prefill)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: {
				_id: 'rec-1',
				name: 'Recorded Name',
				phone: '',
				email: '',
				birthdate: '',
				id_code: '50001010017'
			}
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(idCodeInput(container).value).toBe('50001010017');
	});

	it('disabled while a save is in flight — same recordSavingMemberId binding as every sibling field', async () => {
		let release!: () => void;
		createMemberRecordMock.mockImplementation(
			() => new Promise<string>((res) => (release = () => res('rec-new')))
		);
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick();
		expect(idCodeInput(container).disabled).toBe(true);
		release();
		await waitFor(() => expect(nameInput(container)).toBeNull());
	});

	it('UPDATE path: a changed id_code reaches updateMemberRecord as the single changed field (string shape — the changes-detection treats it like phone)', async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '', id_code: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: '50001010017' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(updateMemberRecordMock.mock.calls[0][1]).toBe('rec-1');
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({ id_code: '50001010017' });
		expect(createMemberRecordMock).not.toHaveBeenCalled();
	});
});

describe('(#285) isikukood checksum guard — THIRD in the refusal slot, strict where the spec is closed', () => {
	// The promotion comment's framing, kept visible: this is a third guard in
	// the ESTABLISHED slot (after the #283 email guard, BEFORE the generation
	// capture and single-flight arm), not new machinery. And the strictness is
	// deliberate where #283's email leniency was deliberate: an isikukood has a
	// precise, closed, checksummable specification; an email address does not.
	// Do NOT harmonise them — 'a@b' keeps saving three lines away while
	// '5000101001' is refused here.
	it("CREATE path: a wrong check digit ('50001010011' — stage 1 says 7) refuses the save — its OWN role=alert copy, no write, no lookup re-read, no single-flight arming; sibling typed fields survive", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1); // the editor open
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5559876' } });
		await fireEvent.input(idCodeInput(container), { target: { value: '50001010011' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		// The guard's OWN copy — never the all-or-nothing failure message.
		expect(alert.textContent).toContain('[roster_record_id_code_invalid]');
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		// A REFUSAL IS NOT A WRITE (the #283 shapes, all four):
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		// …it never reaches the fresh-lookup re-read…
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		// …never arms the single-flight lock…
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-record-cancel') as HTMLButtonElement).disabled).toBe(false);
		// …and keeps the editor open with everything typed still in it.
		expect(phoneInput(container).value).toBe('+372 5559876');
		expect(idCodeInput(container).value).toBe('50001010011');
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
	});

	it.each([
		['5000101001', '10 digits'],
		['500010100178', '12 digits'],
		['5000101001a', 'a letter'],
		[' 50001010017', 'a leading space — exact digits, no trimming leniency']
	])("'%s' (%s) refuses the save — the format arm of the rule", async (typed) => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: typed } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_id_code_invalid]'
		);
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});

	it("a valid stage-1 code ('50001010017', remainder 7) SAVES — full create input, id_code carried", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: '50001010017' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual({
			dbEntityId: 'db-1',
			personId: 'pp-2',
			name: 'Berta Bass',
			phone: '',
			email: 'berta@example.com',
			birthdate: '',
			id_code: '50001010017'
		});
		expect(q(container, 'roster-record-save-error')).toBeNull();
	});

	it("a valid stage-2 code ('10000000098': stage 1 remainder 10, stage 2 = 30 % 11 = 8) SAVES", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: '10000000098' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ id_code: '10000000098' })
		);
	});

	it("DOUBLE FALLBACK at the route: '80001010010' (stage 1 = 21 % 11 = 10, stage 2 = 43 % 11 = 10 → check digit 0) SAVES — the branch most likely miscoded, pinned end-to-end", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: '80001010010' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ id_code: '80001010010' })
		);
	});

	it("OVER-VALIDATION CANARY: '90002310022' — leading digit 9 (no assigned century/sex), \"31 February\", but checksum-VALID ([9,0,0,0,2,3,1,0,0,2]·[1,2,3,4,5,6,7,8,9,1] = 46; 46 % 11 = 2 = check digit) — MUST SAVE: plausibility checks are outside the commission", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: '90002310022' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ id_code: '90002310022' })
		);
		expect(q(container, 'roster-record-save-error')).toBeNull();
	});

	it('an EMPTY isikukood still saves — the field is optional and stays so (the guard skips empty)', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(idCodeInput(container).value).toBe('');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ id_code: '' })
		);
		expect(q(container, 'roster-record-save-error')).toBeNull();
	});

	it("UPDATE path: an invalid code on an EXISTING record refuses too — updateMemberRecord never fires, sibling typed change survives", async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '', id_code: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(emailInput(container), { target: { value: 'kept@example.com' } });
		await fireEvent.input(idCodeInput(container), { target: { value: '50001010011' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_id_code_invalid]'
		);
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(emailInput(container).value).toBe('kept@example.com');
	});

	it('NEVER-ECHO (crede real-PII law — this field needs it more than any other): the refusal copy is STATIC and the typed value appears in NO alert and NO console output', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: '50001010011' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-save-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.textContent).not.toContain('50001010011');
		const logged = [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]
			.map((c) => c.map(String).join(' '))
			.join(' ');
		expect(logged).not.toContain('50001010011');
		consoleErrorSpy.mockRestore();
		consoleLogSpy.mockRestore();
	});

	it('the id-code REFUSAL owns the live region too: cleared-before-gate ordering — a stale "saved" cannot outlive it', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() =>
			expect(q(container, 'roster-member-record-status')!.textContent).toContain(
				'roster_record_saved'
			)
		);
		await openEditor(container, 'm1');
		await fireEvent.input(idCodeInput(container), { target: { value: '5000101001' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(
			'[roster_record_id_code_invalid]'
		);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		expect(createMemberRecordMock).toHaveBeenCalledTimes(1); // the FIRST save only
	});

	it('after fixing the code, the same save goes through — the refusal is a gate, not a dead end', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(idCodeInput(container), { target: { value: '50001010011' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		await fireEvent.input(idCodeInput(container), { target: { value: '50001010017' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ id_code: '50001010017' })
		);
	});
});

// (*MVOX:Tallis* — #268 RED, route-level)
// (*MVOX:Josquin* — #268 review F1/F2/F3 pins)
// (*MVOX:Josquin* — #268 review r3 pins: empty-landed failure copy, save-time
//  existence check)
// (*MVOX:Tallis* — #283 RED: phone letters + email checkValidity save guards,
//  weakest-rule fence)
// (*MVOX:Tallis* — #285 RED: Isikukood fifth field + checksum guard, third in
//  the refusal slot; over-validation canary)
