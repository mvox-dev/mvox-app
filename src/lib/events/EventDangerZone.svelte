<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { classifyDeleteFailure, type DeleteFailure } from '$lib/seasons/deleteErrors';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions } from '$lib/events/eventPageState';
	import { focusTestIdAfterRender } from '$lib/a11y/focusable';

	let {
		detail,
		selected,
		isEditor,
		isOffline,
		actions
	}: {
		detail: EventDetail;
		selected: Collective | null;
		isEditor: boolean;
		isOffline: boolean;
		actions: EventActions;
	} = $props();

	let deleteArmed = $state(false);
	let deletePending = $state(false);
	let deleteError = $state<DeleteFailure | null>(null);

	async function armDelete(): Promise<void> {
		if (isOffline) return;
		deleteError = null;
		deleteArmed = true;
		await focusTestIdAfterRender('event-detail-delete-confirm');
	}

	async function cancelDelete(): Promise<void> {
		deleteArmed = false;
		deleteError = null;
		await focusTestIdAfterRender('event-detail-delete');
	}

	async function confirmDelete(): Promise<void> {
		if (!selected || !detail || deletePending) return;
		if (isOffline) return;
		deletePending = true;
		deleteError = null;
		const cfg = cfgFor(selected.db);
		const evId = detail.id;
		try {
			await actions.deleteEvent(cfg, evId);
			goto('/');
		} catch (e) {
			console.error('event detail: delete failed', evId, e);
			deleteError = classifyDeleteFailure('event', e);
			deletePending = false;
		}
	}

	function deleteErrorText(failure: DeleteFailure): string {
		switch (failure.reason) {
			case 'forbidden':
				return m.event_detail_delete_forbidden();
			case 'partial':
				return m.event_detail_delete_partial({
					deleted: failure.deleted ?? 0,
					total: failure.total ?? 0
				});
			default:
				return m.event_detail_delete_error();
		}
	}
</script>

{#if isEditor}
	<div
		data-testid="event-detail-danger-zone"
		class="mt-6 flex flex-col items-start gap-1 border-t border-ink-3/20 pt-3"
	>
		{#if deleteArmed}
			<div class="flex items-center gap-2">
				<DeleteConfirmPair
					confirmTestid="event-detail-delete-confirm"
					cancelTestid="event-detail-delete-cancel"
					confirmLabel={m.event_detail_delete_confirm_aria_label()}
					cancelLabel={m.event_detail_delete_cancel_aria_label()}
					confirmText={m.event_detail_delete_confirm_short()}
					cancelText={m.event_detail_delete_cancel_short()}
					pending={deletePending}
					busy={deletePending}
					{isOffline}
					onconfirm={() => void confirmDelete()}
					oncancel={() => void cancelDelete()}
				/>
			</div>
		{:else}
			<DeleteTrigger
				data-testid="event-detail-delete"
				class="gap-1 px-1 text-xs underline"
				disabled={isOffline}
				onclick={() => void armDelete()}
			>
				{#snippet children()}
					{m.event_detail_delete_label()}
				{/snippet}
			</DeleteTrigger>
		{/if}
		{#if deleteError}
			<FormError data-testid="event-detail-delete-error">
				{deleteErrorText(deleteError)}
			</FormError>
		{/if}
	</div>
{/if}
