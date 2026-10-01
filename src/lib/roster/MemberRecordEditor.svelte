<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import RedactedField from '$lib/components/RedactedField.svelte';
	import EntuRef from '$lib/components/EntuRef.svelte';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { MemberOpsState } from '$lib/roster/rosterPageState';
	import type { MemberOps } from '$lib/roster/rosterMemberOps';

	let {
		row,
		memberOps,
		ops,
		isOffline
	}: {
		row: RosterRow;
		memberOps: MemberOpsState;
		ops: MemberOps;
		isOffline: boolean;
	} = $props();

	const RECORD_FIELD_LABEL: Record<'name' | 'phone' | 'email' | 'birthdate' | 'id_code', () => string> = {
		name: m.roster_record_name_label,
		phone: m.roster_record_phone_label,
		email: m.roster_record_email_label,
		birthdate: m.roster_record_birthdate_label,
		id_code: m.roster_record_id_code_label
	};
</script>

{#if memberOps.recordEditorLookup?.state === 'damaged'}
	<FormError data-testid="roster-record-damaged-{row.memberId}" class="mt-1">
		{m.roster_record_damaged()}
		<EntuRef id={row.personId} />
	</FormError>
{:else if memberOps.recordEditorLookup !== null}
	<div class="mt-1 flex flex-col gap-2 rounded-md border border-ink-5 p-2">
		<RedactedField
			label={m.roster_record_name_label()}
			type="text"
			testid="roster-record-name"
			required
			bind:value={memberOps.recordForm.name}
			disabled={memberOps.recordSavingMemberId !== null}
		/>
		<RedactedField
			label={m.roster_record_phone_label()}
			type="tel"
			testid="roster-record-phone"
			bind:value={memberOps.recordForm.phone}
			disabled={memberOps.recordSavingMemberId !== null}
		/>
		<RedactedField
			label={m.roster_record_email_label()}
			type="email"
			testid="roster-record-email"
			bind:el={memberOps.emailInputEl}
			bind:value={memberOps.recordForm.email}
			disabled={memberOps.recordSavingMemberId !== null}
		/>
		<RedactedField
			label={m.roster_record_birthdate_label()}
			type="date"
			testid="roster-record-birthdate"
			bind:value={memberOps.recordForm.birthdate}
			disabled={memberOps.recordSavingMemberId !== null}
		/>
		<RedactedField
			label={m.roster_record_id_code_label()}
			type="text"
			testid="roster-record-id-code"
			bind:value={memberOps.recordForm.id_code}
			disabled={memberOps.recordSavingMemberId !== null}
		/>
		<div class="flex items-center gap-2">
			<button
				type="button"
				data-testid="roster-record-save"
				disabled={memberOps.recordSavingMemberId !== null || isOffline}
				class="rounded-md border border-ink px-2 py-1 text-xs disabled:opacity-50"
				onclick={() => ops.saveRecordEditor(row)}
			>
				{m.roster_record_save()}
			</button>
			<button
				type="button"
				data-testid="roster-record-cancel"
				disabled={memberOps.recordSavingMemberId === row.memberId}
				class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
				onclick={ops.cancelRecordEditor}
			>
				{m.roster_record_cancel()}
			</button>
		</div>
		{#if memberOps.recordSaveError?.memberId === row.memberId}
			<FormError data-testid="roster-record-save-error">
				{#if memberOps.recordSaveError.kind === 'partial'}
					{m.roster_record_save_partial({
						saved: memberOps.recordSaveError.savedFields
							.map((f) => RECORD_FIELD_LABEL[f as keyof typeof RECORD_FIELD_LABEL]())
							.join(', ')
					})}
				{:else if memberOps.recordSaveError.kind === 'name-required'}
					{m.roster_record_name_required()}
				{:else if memberOps.recordSaveError.kind === 'phone-invalid'}
					{m.roster_record_phone_invalid()}
				{:else if memberOps.recordSaveError.kind === 'email-invalid'}
					{m.roster_record_email_invalid()}
				{:else if memberOps.recordSaveError.kind === 'id-code-invalid'}
					{m.roster_record_id_code_invalid()}
				{:else}
					{m.roster_record_save_failed()}
				{/if}
			</FormError>
		{/if}
	</div>
{/if}
