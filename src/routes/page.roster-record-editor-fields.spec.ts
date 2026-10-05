// @vitest-environment happy-dom
// The roster record editor: its five fields, their labels and the prefill.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal, { writes: true })
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { toListRead } from '$lib/testing/listReadFixtures';
import {
	createMemberRecordMock,
	loadMemberRecordMock,
	loadRosterMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { rosterTwo } from '$lib/testing/pages/rosterFixtures';
import { renderRosterAs } from '$lib/testing/pages/rosterRender';
import {
	birthdateInput,
	emailInput,
	idCodeInput,
	nameInput,
	openEditor,
	phoneInput,
	q,
	useRecordEditorPage
} from '$lib/testing/pages/rosterRecordEditor';

useRecordEditorPage();

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

// (*MVOX:Tallis*) (*MVOX:Josquin*)
