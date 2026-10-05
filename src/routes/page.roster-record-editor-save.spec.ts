// @vitest-environment happy-dom
// The roster record editor: saving, failure and a collective switch mid-write.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
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

import Page from './roster/+page.svelte';
import { MemberRecordPartialSaveError, type MemberRecordLookup } from '$lib/roster/memberRecord';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { adminStore } from '$lib/nav/adminStore';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead } from '$lib/testing/listReadFixtures';
import {
	createMemberRecordMock,
	loadMemberRecordMock,
	loadRosterMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { rosterTwo } from '$lib/testing/pages/rosterFixtures';
import { flush, setAuthedWithTwoCollectives } from '$lib/testing/pages/roster';
import { renderRosterAs } from '$lib/testing/pages/rosterRender';
import {
	birthdateInput,
	emailInput,
	nameInput,
	openEditor,
	phoneInput,
	q,
	useRecordEditorPage
} from '$lib/testing/pages/rosterRecordEditor';

useRecordEditorPage();

const rowsOther: RosterRow[] = [
	{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: 'db-b' }
];

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

// (*MVOX:Tallis*) (*MVOX:Josquin*)
