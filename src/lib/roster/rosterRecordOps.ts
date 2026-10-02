// The roster's member-record editor handlers.
import { m } from '$lib/paraglide/messages.js';
import type { RosterRow } from '$lib/roster/rosterData';
import type { MemberRecord } from '$lib/roster/memberRecord';
import { isValidIdCode } from '$lib/roster/idCode';
import { emptyRecordForm } from '$lib/roster/rosterPageState';
import type { MemberOpsDeps } from '$lib/roster/rosterMemberOps';

export function createRecordOps<Halves>(deps: MemberOpsDeps<Halves>) {
	const { mo, actions, generation, isCurrent, isOffline } = deps;

	async function openRecordEditor(row: RosterRow): Promise<void> {
		const cfg = deps.cfg();
		if (!cfg) return;
		const memberId = row.memberId;
		mo.recordEditorMemberId = memberId;
		mo.recordEditorLookup = null;
		mo.recordSaveError = null;
		mo.recordEditorOriginal = null;
		mo.recordForm = emptyRecordForm();
		const g = generation();
		try {
			const result = await actions.loadMemberRecord(cfg, row.personId);
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			mo.recordEditorLookup = result;
			if (result.state === 'none') {
				mo.recordForm = {
					name: row.profileName ?? row.name,
					phone: '',
					email: row.email,
					birthdate: '',
					id_code: ''
				};
				mo.recordEditorOriginal = { ...mo.recordForm };
			} else if (result.state === 'one') {
				mo.recordForm = {
					name: result.record.name,
					phone: result.record.phone,
					email: result.record.email,
					birthdate: result.record.birthdate,
					id_code: result.record.id_code ?? ''
				};
				mo.recordEditorOriginal = { ...mo.recordForm };
			}
		} catch (e) {
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			console.error('roster: member record load failed', memberId, e);
			mo.recordEditorMemberId = null;
		}
	}

	function cancelRecordEditor(): void {
		mo.recordEditorMemberId = null;
		mo.recordEditorLookup = null;
		mo.recordSaveError = null;
		mo.recordEditorOriginal = null;
	}

	async function saveRecordEditor(row: RosterRow): Promise<void> {
		if (mo.recordSavingMemberId !== null) return;
		if (isOffline()) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		const lookup = mo.recordEditorLookup;
		if (!lookup || lookup.state === 'damaged') return;
		const memberId = row.memberId;
		const form = mo.recordForm;
		mo.recordSaveError = null;
		mo.recordStatus = '';
		if (form.name.trim() === '') {
			mo.recordSaveError = { memberId, kind: 'name-required' };
			return;
		}
		if (/\p{L}/u.test(form.phone)) {
			mo.recordSaveError = { memberId, kind: 'phone-invalid' };
			return;
		}
		if (mo.emailInputEl && !mo.emailInputEl.checkValidity()) {
			mo.recordSaveError = { memberId, kind: 'email-invalid' };
			return;
		}
		if (!isValidIdCode(form.id_code)) {
			mo.recordSaveError = { memberId, kind: 'id-code-invalid' };
			return;
		}
		const g = generation();
		mo.recordSavingMemberId = memberId;
		try {
			const fresh = await actions.loadMemberRecord(cfg, row.personId);
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			if (fresh.state === 'damaged') {
				mo.recordEditorLookup = fresh;
				return;
			}
			const current = mo.recordForm;
			if (fresh.state === 'none') {
				const dbEntityId = row.dbEntityId ?? deps.currentDbEntityId();
				if (!dbEntityId) {
					throw new Error(`roster: cannot resolve the database entity id for member ${memberId}`);
				}
				await actions.createMemberRecord(cfg, {
					dbEntityId,
					personId: row.personId,
					name: current.name,
					phone: current.phone,
					email: current.email,
					birthdate: current.birthdate,
					id_code: current.id_code
				});
			} else {
				const original = mo.recordEditorOriginal ?? emptyRecordForm();
				const changes: Partial<
					Pick<MemberRecord, 'name' | 'phone' | 'email' | 'birthdate' | 'id_code'>
				> = {};
				if (current.name !== original.name) changes.name = current.name;
				if (current.phone !== original.phone) changes.phone = current.phone;
				if (current.email !== original.email) changes.email = current.email;
				if (current.birthdate !== original.birthdate) changes.birthdate = current.birthdate;
				if (current.id_code !== original.id_code) changes.id_code = current.id_code;
				await actions.updateMemberRecord(cfg, fresh.record._id, changes);
			}
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			mo.recordEditorMemberId = null;
			mo.recordEditorLookup = null;
			mo.recordEditorOriginal = null;
			mo.recordStatus = m.roster_record_saved();
		} catch (e) {
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			if (actions.isPartialSaveError(e)) {
				console.error('roster: member record save incomplete', memberId, e.failedField);
				mo.recordSaveError =
					e.landedFields.length > 0
						? { memberId, kind: 'partial', savedFields: e.landedFields }
						: { memberId, kind: 'failed' };
			} else {
				console.error('roster: member record save failed', memberId, e);
				mo.recordSaveError = { memberId, kind: 'failed' };
			}
		} finally {
			if (mo.recordSavingMemberId === memberId) mo.recordSavingMemberId = null;
		}
	}

	return { openRecordEditor, cancelRecordEditor, saveRecordEditor };
}
