// @vitest-environment happy-dom
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal, { writes: true })
);
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: false })
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './roster/+page.svelte';
import { MemberRecordPartialSaveError, type MemberRecordLookup } from '$lib/roster/memberRecord';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { adminStore } from '$lib/nav/adminStore';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead } from '$lib/testing/listReadFixtures';
import { REDACT_ATTR } from '$lib/redact/redact';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	createMemberRecordMock,
	deactivateMemberMock,
	listDeactivateBlockersMock,
	listInactiveMembersMock,
	loadInactiveRosterMock,
	loadMemberRecordMock,
	loadRosterMock,
	reinstateMemberMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { altoSection, rosterTwo } from '$lib/testing/pages/rosterFixtures';
import {
	cleanupClearResetAdmin,
	flush,
	setAuthedWithOneCollective,
	setAuthedWithTwoCollectives
} from '$lib/testing/pages/roster';
import { renderRosterAs } from '$lib/testing/pages/rosterRender';

const rowsOther: RosterRow[] = [
	{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: 'db-b' }
];

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(rosterTwo));
	listSectionsMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
	createMemberRecordMock.mockResolvedValue('rec-new');
	updateMemberRecordMock.mockResolvedValue(undefined);
	listMyProfilesMock.mockResolvedValue([
		{ _id: 'pr-priv', name: 'Secret Private Name', email: 'berta@example.com', _sharing: 'private' },
		{ _id: 'pr-dom', name: 'Berta Bass', email: 'berta@example.com', _sharing: 'domain' }
	]);
});

afterEach(cleanupClearResetAdmin);

async function openEditor(container: HTMLElement, memberId: string) {
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `#302: collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card!);
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
const idCodeInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-id-code"]') as HTMLInputElement;

describe('(A) card activator — admin-only, whole-block, every display view (#302: pencil retired)', () => {
	it("admin sees the card activator on another member's row", async () => {
		const { container } = await renderRosterAs('admin');
		expect(q(container, 'roster-row-card-m2')).not.toBeNull();
	});

	it("the activator IS present on the admin's OWN row — the contract has no self-row exclusion (deactivate-guard copy-paste trap)", async () => {
		const { container } = await renderRosterAs('admin');
		expect(q(container, 'roster-row-card-m1')).not.toBeNull();
	});

	it('a non-admin sees NO activator anywhere — absent, not disabled (whole-block gating)', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid^="roster-row-card-"]')).toBeNull();
	});

	it('accessible name per #262: a static sr-only label composed with the row\'s visible member name INSIDE the button — never a templated aria-label', async () => {
		const { container } = await renderRosterAs('admin');
		const btn = q(container, 'roster-row-card-m2')!;
		expect(btn.textContent).toContain('[roster_record_edit_label]');
		expect(btn.textContent).toContain('Berta Bass');
		expect(btn.getAttribute('aria-label')).toBeNull();
	});

	it('flat (alphabetical) list call site: the activator renders there too', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle')!);
		await waitFor(() => expect(q(container, 'roster-flat-list')).not.toBeNull());
		expect(q(container, 'roster-row-card-m2')).not.toBeNull();
	});

	it('section-group call site: a member inside an expanded section group carries the activator', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadRosterMock.mockResolvedValue(toListRead([
			...rosterTwo,
			{ memberId: 'm3', personId: 'pp-3', name: 'Cara Cantus', email: 'cara@example.com', sectionIds: ['sec-alto'], dbEntityId: 'db-1' }
		]));
		const utils = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() => expect(q(utils.container, 'section-toggle-sec-alto')).not.toBeNull());
		await fireEvent.click(q(utils.container, 'section-toggle-sec-alto')!);
		await waitFor(() => expect(q(utils.container, 'roster-row-m3')).not.toBeNull());
		expect(q(utils.container, 'roster-row-card-m3')).not.toBeNull();
	});

	it('arrange mode renders no member rows — no activator by construction', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-view-chip-arrange')!);
		await waitFor(() => expect(q(container, 'roster-arrange-list')).not.toBeNull());
		expect(container.querySelector('[data-testid^="roster-row-card-"]')).toBeNull();
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

	it('opening runs the ONE record lookup for that member (the editor-open read only — since 0d1af3d the save re-reads independently)', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		expect(loadMemberRecordMock.mock.calls[0][0]).toEqual(
			expect.objectContaining({ db: 'sampledb' })
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
		loadRosterMock.mockResolvedValue(toListRead([
			rosterTwo[0],
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: '', sectionIds: [], dbEntityId: 'db-1' }
		]));
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
	it('surfaces a role=alert that names NO member and carries an EntuRef to the person, renders NO editor fields, and never writes', async () => {
		loadMemberRecordMock.mockResolvedValue({ state: 'damaged', count: 2 });
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(q(container, 'roster-row-card-m2')!);
		const alert = await waitFor(() => {
			const el = q(container, 'roster-record-damaged-m2');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect((alert.textContent ?? '').replace(/\s+/g, '')).toBe('[roster_record_damaged]pp-2');
		expect(alert.textContent).not.toContain('Berta Bass');
		expect(alert.textContent).not.toContain('berta@example.com');
		const links = alert.querySelectorAll('a');
		expect(links).toHaveLength(1);
		expect(links[0].textContent?.trim()).toBe('pp-2');
		expect(links[0].getAttribute('href')).toBe('https://entu.app/sampledb/pp-2');
		expect(links[0].getAttribute('title')).toBe('pp-2');
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
		expect(nameInput(container).value).toBe('Typed Secret Name');
		expect(phoneInput(container).value).toBe('+372 5550000');
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
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
		expect(alert.textContent).toContain('roster_record_save_partial');
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(alert.textContent).not.toContain('failed@secret.example');
		expect(emailInput(container).value).toBe('failed@secret.example');
	});

	it('review r3 F1 — a partial error that landed NOTHING gets the all-or-nothing copy: the empty landed list must never render "saved: " with nothing after it', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
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
		expect(alert.textContent).toContain('[roster_record_save_failed]');
		expect(alert.textContent).not.toContain('roster_record_save_partial');
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
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		consoleErrorSpy.mockRestore();
	});
});

describe('(E) collective switch — #259 a write settling after the switch changes nothing', () => {
	async function renderTwoCollectivesAsAdmin() {
		loadRosterMock.mockImplementation(async (cfg: { db: string }) =>
			toListRead(cfg.db === 'other-choir' ? rowsOther : rosterTwo)
		);
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		await waitFor(() => expect(q(utils.container, 'section-toggle-unassigned')).not.toBeNull());
		await fireEvent.click(q(utils.container, 'section-toggle-unassigned')!);
		await waitFor(() => expect(q(utils.container, 'roster-row-m2')).not.toBeNull());
		return utils;
	}

	it('a collective switch mid-edit CLOSES and discards the open editor', async () => {
		const { container } = await renderTwoCollectivesAsAdmin();
		await openEditor(container, 'm2');
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(container, 'roster-row-m2')).toBeNull());
		expect(container.querySelector('[data-testid="roster-record-name"]')).toBeNull();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});

	it('a held save SUCCESS settling after the switch writes NOTHING: no stale announcement, no reopened editor', async () => {
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

	it('a held save RE-READ settling after the switch writes NOTHING: neither create nor update fires (the pre-write guard on the fresh lookup, #279)', async () => {
		let release!: (v: MemberRecordLookup) => void;
		loadMemberRecordMock
			.mockResolvedValueOnce({ state: 'none' }) // the editor-open read
			.mockImplementationOnce(
				() => new Promise<MemberRecordLookup>((res) => (release = res))
			);
		const { container } = await renderTwoCollectivesAsAdmin();
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await tick(); // the save handler is now suspended on the held re-read
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => expect(q(container, 'roster-row-m2')).toBeNull());
		release({ state: 'none' });
		await flush();
		await tick();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
	});
});

describe('(E) review F2 — the required NAME is enforced where the write happens', () => {
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
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(nameInput(container)).not.toBeNull();
		expect(phoneInput(container).value).toBe('+372 5559876');
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
	});

	it('whitespace is not a name: "   " is refused exactly like ""', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: '   ' } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
	});
});

describe('(E) review F3 — the in-flight guard is ROW-SCOPED, never cleared by another row', () => {
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

		await openEditor(container, 'm1');
		const save = q(container, 'roster-record-save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		await fireEvent.click(save);
		await flush();
		await tick();
		expect(createMemberRecordMock).toHaveBeenCalledTimes(1);

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
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '' }
		});
		await openEditor(container, 'm2');
		expect(birthdateInput(container).value).toBe('');
	});
});

describe('(E) review r3 F2 — the one-record check runs AT THE SAVE, not at editor-open', () => {
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
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-raced', name: 'Berta Bass', phone: '', email: '', birthdate: '' }
		});
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock.mock.calls[0][1]).toBe('rec-raced');
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({});
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
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		expect(q(container, 'roster-record-save-error')).toBeNull();
	});
});

describe('(E) #280 — create-turned-update asserts ONLY touched fields; an untouched prefill never wins a write', () => {
	const racedRecord = {
		state: 'one' as const,
		record: {
			_id: 'rec-raced',
			name: 'Bertha B. Bass', // the other admin's entry — NOT the profile name
			phone: '+372 5550001',
			email: 'bertha@other.example',
			birthdate: '1980-01-02',
			id_code: '48001020001'
		}
	};

	it("nothing touched → updateMemberRecord carries {} — the other writer's name and email survive, and the save still COMPLETES (refusal was withdrawn)", async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2'); // 'none' — prefill fires on name+email
		loadMemberRecordMock.mockResolvedValue(racedRecord);
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock.mock.calls[0][1]).toBe('rec-raced');
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({});
		await waitFor(() => expect(nameInput(container)).toBeNull());
		expect(q(container, 'roster-member-record-status')!.textContent).toContain(
			'roster_record_saved'
		);
	});

	it('a TYPED name IS sent and wins; the still-untouched email prefill rides along with NOTHING', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: 'Corrected Name' } });
		loadMemberRecordMock.mockResolvedValue(racedRecord);
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({ name: 'Corrected Name' });
	});

	it('a TYPED blank field (phone) is sent; the untouched prefills AND the untouched blanks (birthdate, id code) all stay out', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(phoneInput(container), { target: { value: '+372 5559876' } });
		loadMemberRecordMock.mockResolvedValue(racedRecord);
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({ phone: '+372 5559876' });
	});

	it('edit-then-REVERT: a name typed and then restored to the exact prefilled value is NOT sent — the final value equals the display, so it asserts nothing (#280 pinned choice)', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(nameInput(container), { target: { value: 'Corrected Name' } });
		await fireEvent.input(nameInput(container), { target: { value: 'Berta Bass' } });
		loadMemberRecordMock.mockResolvedValue(racedRecord);
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(updateMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(updateMemberRecordMock.mock.calls[0][2]).toEqual({});
	});
});

describe('(F) privacy fence — non-admins never get the fields in the DOM', () => {
	it('no editor field testid exists anywhere for a non-admin (whole-block gating, not hidden/disabled)', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid="roster-record-name"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-phone"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-email"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-birthdate"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-record-id-code"]')).toBeNull();
	});
});

describe('(#283) environment smoke — the guard primitives hold in THIS environment, not by inference', () => {
	// target, Node 22, happy-dom via @vitest-environment above) — not inferred
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
		expect(alert.textContent).toContain('[roster_record_phone_invalid]');
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-record-cancel') as HTMLButtonElement).disabled).toBe(false);
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
});

describe("(#283) email guard — the browser's OWN constraint validation, weakest-rule fence", () => {
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
		loadRosterMock.mockResolvedValue(toListRead([
			rosterTwo[0],
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: '', sectionIds: [], dbEntityId: 'db-1' }
		]));
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

	it('disabled while a save is in flight, like every sibling field', async () => {
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
		expect(alert.textContent).toContain('[roster_record_id_code_invalid]');
		expect(alert.textContent).not.toContain('[roster_record_save_failed]');
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(loadMemberRecordMock).toHaveBeenCalledTimes(1);
		expect((q(container, 'roster-record-save') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'roster-record-cancel') as HTMLButtonElement).disabled).toBe(false);
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
});

// One row per save gate: a value it refuses, a value it lets through, and its alert key.
const GATES = [
	{ field: 'name', input: nameInput, bad: '', good: 'Berta Real', key: 'roster_record_name_required' },
	{ field: 'phone', input: phoneInput, bad: 'tel: 555', good: '+372 555', key: 'roster_record_phone_invalid' },
	{ field: 'email', input: emailInput, bad: 'not an email', good: 'b@example.com', key: 'roster_record_email_invalid' },
	{ field: 'id_code', input: idCodeInput, bad: '50001010011', good: '50001010017', key: 'roster_record_id_code_invalid' }
] as const;

describe.each(GATES)('(#283/#285) the $field gate refuses at the save, whatever comes after', (gate) => {
	const sibling = gate.field === 'email' ? phoneInput : emailInput;
	const siblingValue = gate.field === 'email' ? '+372 5550000' : 'kept@example.com';

	it("UPDATE path: a refused value on an EXISTING record — updateMemberRecord never fires, sibling typed change survives", async () => {
		loadMemberRecordMock.mockResolvedValue({
			state: 'one',
			record: { _id: 'rec-1', name: 'Recorded Name', phone: '', email: '', birthdate: '', id_code: '' }
		});
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(sibling(container), { target: { value: siblingValue } });
		await fireEvent.input(gate.input(container), { target: { value: gate.bad } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(`[${gate.key}]`);
		expect(updateMemberRecordMock).not.toHaveBeenCalled();
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		expect(sibling(container).value).toBe(siblingValue);
	});

	it('the refusal owns the live region: cleared-before-gate ordering — a stale "saved" cannot outlive it', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() =>
			expect(q(container, 'roster-member-record-status')!.textContent).toContain(
				'roster_record_saved'
			)
		);
		await openEditor(container, 'm1');
		await fireEvent.input(gate.input(container), { target: { value: gate.bad } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(q(container, 'roster-record-save-error')!.textContent).toContain(`[${gate.key}]`);
		expect((q(container, 'roster-member-record-status')!.textContent ?? '').trim()).toBe('');
		expect(createMemberRecordMock).toHaveBeenCalledTimes(1); // the FIRST save only
	});

	it('after fixing the value, the same save goes through — the refusal is a gate, not a dead end', async () => {
		const { container } = await renderRosterAs('admin');
		await openEditor(container, 'm2');
		await fireEvent.input(gate.input(container), { target: { value: gate.bad } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(q(container, 'roster-record-save-error')).not.toBeNull());
		expect(createMemberRecordMock).not.toHaveBeenCalled();
		await fireEvent.input(gate.input(container), { target: { value: gate.good } });
		await fireEvent.click(q(container, 'roster-record-save')!);
		await waitFor(() => expect(createMemberRecordMock).toHaveBeenCalledTimes(1));
		expect(createMemberRecordMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ [gate.field]: gate.good })
		);
	});
});

// crede real-PII law: each refusal copy is STATIC, so the typed value reaches no alert and no log.
it.each([
	{ field: 'phone', input: phoneInput, typed: 'õhtul helistada 555' },
	{ field: 'email', input: emailInput, typed: 'secret typo @ example' },
	{ field: 'id_code', input: idCodeInput, typed: '50001010011' }
])('PRIVACY: the $field refusal never echoes the typed value', async ({ input, typed }) => {
	const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	const { container } = await renderRosterAs('admin');
	await openEditor(container, 'm2');
	await fireEvent.input(input(container), { target: { value: typed } });
	await fireEvent.click(q(container, 'roster-record-save')!);
	const alert = await waitFor(() => {
		const el = q(container, 'roster-record-save-error');
		expect(el).not.toBeNull();
		return el!;
	});
	expect(alert.textContent).not.toContain(typed);
	const logged = [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]
		.map((c) => c.map(String).join(' '))
		.join(' ');
	expect(logged).not.toContain(typed);
	consoleErrorSpy.mockRestore();
	consoleLogSpy.mockRestore();
});

function textNodesContaining(root: Element, needle: string): Text[] {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const hits: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if ((n.textContent ?? '').includes(needle)) hits.push(n as Text);
	}
	return hits;
}

function expectTightlyMarked(root: Element, needle: string, where: string) {
	const hits = textNodesContaining(root, needle);
	expect(hits.length, `${where}: '${needle}' must render here`).toBeGreaterThan(0);
	for (const hit of hits) {
		const marker = hit.parentElement?.closest(`[${REDACT_ATTR}]`) ?? null;
		expect(marker, `${where}: '${needle}' must sit inside a [${REDACT_ATTR}] element`).not.toBeNull();
		expect(root.contains(marker), `${where}: the marker must be INSIDE the surface, not around it`).toBe(true);
		expect(marker!.textContent?.trim(), `${where}: the marker holds exactly the value`).toBe(needle);
	}
}

describe('#388 — the collapsed row\'s name and email and the sr-only edit label\'s name carry the capture marker', () => {
	it.each(['admin', 'not-admin'] as const)('%s: roster-row-name and roster-row-email each render their value inside a tight marker', async (role) => {
		const { container } = await renderRosterAs(role);
		for (const [memberId, name, email] of [
			['m1', 'Alice Alto', 'alice@example.com'],
			['m2', 'Berta Bass', 'berta@example.com']
		] as const) {
			const li = q(container, `roster-row-${memberId}`)!;
			const nameEl = li.querySelector('[data-testid="roster-row-name"]');
			const emailEl = li.querySelector('[data-testid="roster-row-email"]');
			expect(nameEl, `${memberId} roster-row-name`).not.toBeNull();
			expect(emailEl, `${memberId} roster-row-email`).not.toBeNull();
			expectTightlyMarked(nameEl!, name, `${memberId} roster-row-name`);
			expectTightlyMarked(emailEl!, email, `${memberId} roster-row-email`);
		}
	});

	it('admin: the card activator\'s sr-only label keeps its static copy OUTSIDE the marker and the member\'s name INSIDE it', async () => {
		const { container } = await renderRosterAs('admin');
		const card = q(container, 'roster-row-card-m2')!;
		expect(card).not.toBeNull();
		const label = card.querySelector('.sr-only');
		expect(label, 'the sr-only edit label renders inside the card').not.toBeNull();
		expect(label!.textContent).toContain('[roster_record_edit_label]');
		expectTightlyMarked(label!, 'Berta Bass', 'sr-only edit label');
		const copy = textNodesContaining(label!, '[roster_record_edit_label]');
		expect(copy).toHaveLength(1);
		expect(copy[0].parentElement?.closest(`[${REDACT_ATTR}]`) ?? null).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
