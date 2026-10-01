<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import { isoDateFormatter } from '$lib/preferences/timeFormat';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import type { SeasonEditableField } from '$lib/seasons/seasonManage';
	import { focusAfterRender, focusOnMount } from '$lib/a11y/focusable';
	import EditActivator from '$lib/components/EditActivator.svelte';

	interface Props {
		selected: Collective | null;
		manageableSeasonId: string | null;
		seasonManagePanelEl: HTMLDivElement | null;
		isOffline: boolean;
		switchGeneration: () => number;
		updateSeasonField: typeof SeasonManage.updateSeasonField;
		seasonManageName: string;
		seasonManageStartDate: string;
		seasonManageEndDate: string;
		seasonEditingField: SeasonEditableField | null;
		seasonEditDraft: string;
		seasonEditErrors: Partial<Record<SeasonEditableField, 'save' | 'range'>>;
		seasonEditHeldOffline: boolean;
		seasonEditPending: Partial<Record<SeasonEditableField, boolean>>;
		seasonEditStatus: string;
	}

	let {
		selected,
		manageableSeasonId,
		seasonManagePanelEl,
		isOffline,
		switchGeneration,
		updateSeasonField,
		seasonManageName = $bindable(),
		seasonManageStartDate = $bindable(),
		seasonManageEndDate = $bindable(),
		seasonEditingField = $bindable(),
		seasonEditDraft = $bindable(),
		seasonEditErrors = $bindable(),
		seasonEditHeldOffline = $bindable(),
		seasonEditPending = $bindable(),
		seasonEditStatus = $bindable()
	}: Props = $props();

	const seasonDateFmt = isoDateFormatter('UTC');

	const dateFields = [
		{
			field: 'start_date',
			label: m.season_manage_start_date_label,
			editLabel: m.season_manage_edit_start_date_label
		},
		{
			field: 'end_date',
			label: m.season_manage_end_date_label,
			editLabel: m.season_manage_edit_end_date_label
		}
	] as const;

	function formatSeasonDate(isoDate: string): string {
		if (!isoDate) return '';
		const at = new Date(isoDate);
		if (Number.isNaN(at.getTime())) return '';
		return seasonDateFmt.format(at);
	}

	function refocusSeasonManagePanel(): void {
		void focusAfterRender(() => seasonManagePanelEl);
	}

	function seasonFieldValue(field: SeasonEditableField): string {
		switch (field) {
			case 'name':
				return seasonManageName;
			case 'start_date':
				return seasonManageStartDate;
			case 'end_date':
				return seasonManageEndDate;
		}
	}

	function applySeasonFieldLocally(field: SeasonEditableField, value: string): void {
		switch (field) {
			case 'name':
				seasonManageName = value;
				break;
			case 'start_date':
				seasonManageStartDate = value;
				break;
			case 'end_date':
				seasonManageEndDate = value;
				break;
		}
	}

	function clearSeasonFieldError(field: SeasonEditableField): void {
		const next = { ...seasonEditErrors };
		delete next[field];
		seasonEditErrors = next;
	}

	function beginSeasonFieldEdit(field: SeasonEditableField): void {
		if (seasonEditPending[field] || isOffline) return;
		clearSeasonFieldError(field);
		seasonEditHeldOffline = false;
		seasonEditDraft = seasonFieldValue(field);
		seasonEditingField = field;
	}

	function cancelSeasonFieldEdit(): void {
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditHeldOffline = false;
	}

	function confirmSeasonFieldEdit(field: SeasonEditableField): void {
		if (!selected || manageableSeasonId === null || seasonEditingField !== field) return;
		if (isOffline) {
			clearSeasonFieldError(field);
			seasonEditHeldOffline = true;
			return;
		}
		const before = seasonFieldValue(field);
		const value = seasonEditDraft.trim();
		seasonEditingField = null;
		if (value === '' || value === before) return;

		if (seasonDateRangeInverted(field, value)) {
			seasonEditStatus = '';
			seasonEditErrors = { ...seasonEditErrors, [field]: 'range' };
			return;
		}

		const cfg = cfgFor(selected.db);
		const seasonId = manageableSeasonId;
		const thisSeasonManage = switchGeneration();
		clearSeasonFieldError(field);
		seasonEditStatus = '';
		seasonEditPending = { ...seasonEditPending, [field]: true };
		applySeasonFieldLocally(field, value);
		updateSeasonField(cfg, seasonId, field, value)
			.then(() => {
				if (thisSeasonManage !== switchGeneration()) return;
				seasonEditPending = { ...seasonEditPending, [field]: false };
				seasonEditStatus = m.season_manage_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== switchGeneration()) return;
				console.error('agenda: season field save failed', field, e);
				seasonEditPending = { ...seasonEditPending, [field]: false };
				applySeasonFieldLocally(field, before);
				seasonEditErrors = { ...seasonEditErrors, [field]: 'save' };
			});
	}

	function seasonDateRangeInverted(field: SeasonEditableField, value: string): boolean {
		if (field === 'start_date') return seasonManageEndDate !== '' && value > seasonManageEndDate;
		if (field === 'end_date') return seasonManageStartDate !== '' && value < seasonManageStartDate;
		return false;
	}

	function seasonFieldErrorText(field: SeasonEditableField): string {
		return seasonEditErrors[field] === 'range'
			? m.season_date_range_invalid()
			: m.season_manage_save_error();
	}

	function handleSeasonFieldKeydown(event: KeyboardEvent, field: SeasonEditableField): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelSeasonFieldEdit();
			refocusSeasonManagePanel();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			confirmSeasonFieldEdit(field);
			refocusSeasonManagePanel();
		}
	}
</script>

{#if seasonEditHeldOffline}
	<p
		data-testid="season-edit-held-offline"
		role="alert"
		class="text-xs text-ink-2"
	>
		{m.write_held_no_signal()}
	</p>
{/if}

<div>
	{#if seasonEditingField === 'name'}
		<input
			type="text"
			data-testid="season-edit-input-name"
			aria-label={m.season_manage_name_label()}
			value={seasonEditDraft}
			use:focusOnMount
			oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
			onblur={() => confirmSeasonFieldEdit('name')}
			onkeydown={(e) => handleSeasonFieldKeydown(e, 'name')}
			class="w-full border-b border-ink bg-transparent font-display text-lg text-ink"
		/>
	{:else}
		<div class="font-display text-lg text-ink">
			<EditActivator
				label={m.season_manage_edit_name_label()}
				data-testid="season-edit-btn-name"
				disabled={seasonEditPending.name === true || isOffline}
				class="w-full items-center gap-2 font-display text-lg text-ink"
				onclick={() => beginSeasonFieldEdit('name')}
			>
				<span data-testid="season-manage-name">{seasonManageName}</span>
			</EditActivator>
		</div>
	{/if}
	{#if seasonEditErrors.name}
		<p data-testid="season-edit-error-name" role="alert" class="text-xs text-red-700">
			{seasonFieldErrorText('name')}
		</p>
	{/if}
</div>

<div class="flex gap-4">
	{#each dateFields as { field, label, editLabel } (field)}
		<div class="min-w-0 flex-1">
			<p class="text-xs tracking-wide text-ink-2 uppercase">
				{label()}
			</p>
			{#if seasonEditingField === field}
				<input
					type="date"
					data-testid="season-edit-input-{field}"
					aria-label={label()}
					value={seasonEditDraft}
					use:focusOnMount
					oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
					onblur={() => confirmSeasonFieldEdit(field)}
					onkeydown={(e) => handleSeasonFieldKeydown(e, field)}
					class="border-b border-ink bg-transparent text-ink"
				/>
			{:else}
				<EditActivator
					label={editLabel()}
					data-testid="season-edit-btn-{field}"
					disabled={seasonEditPending[field] === true || isOffline}
					class="w-full items-center gap-1"
					onclick={() => beginSeasonFieldEdit(field)}
				>
					<span data-testid="season-manage-{field}" class="text-base text-ink-2">
						{#if seasonFieldValue(field)}
							{formatSeasonDate(seasonFieldValue(field))}
						{:else}
							{m.season_manage_date_unset()}
						{/if}
					</span>
				</EditActivator>
			{/if}
			{#if seasonEditErrors[field]}
				<p
					data-testid="season-edit-error-{field}"
					role="alert"
					class="text-xs text-red-700"
				>
					{seasonFieldErrorText(field)}
				</p>
			{/if}
		</div>
	{/each}
</div>

<div
	data-testid="season-edit-status"
	role="status"
	aria-live="polite"
	class="sr-only"
>
	{seasonEditStatus}
</div>
