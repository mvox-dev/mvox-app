// @vitest-environment happy-dom
// The roster record editor: the phone, email and isikukood guards at save.
import { fireEvent, waitFor } from '@testing-library/svelte';
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

// (*MVOX:Tallis*) (*MVOX:Josquin*)
