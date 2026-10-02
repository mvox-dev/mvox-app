<!-- One saved link: its anchor and admin controls, or its whole-field in-situ edit form. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { LinkRow } from '$lib/links/linkData';

	interface Props {
		row: LinkRow;
		index: number;
		rowCount: number;
		isAdmin: boolean;
		isOffline: boolean;
		reorderPending: boolean;
		editing: boolean;
		editName: string;
		editUrl: string;
		editDescription: string;
		onsave: (id: string) => void;
		oncancel: () => void;
		onmoveup: (index: number) => void;
		onmovedown: (index: number) => void;
		onedit: (row: LinkRow) => void;
		onremove: (id: string) => void;
	}

	let {
		row,
		index,
		rowCount,
		isAdmin,
		isOffline,
		reorderPending,
		editing,
		editName = $bindable(),
		editUrl = $bindable(),
		editDescription = $bindable(),
		onsave,
		oncancel,
		onmoveup,
		onmovedown,
		onedit,
		onremove
	}: Props = $props();
</script>

<li data-testid="links-row" class="flex flex-col gap-1 border-b border-ink-5 py-2">
	{#if editing}
		<label class="flex flex-col gap-1 text-sm">
			{m.links_add_name_label()}
			<input
				data-testid="links-edit-name"
				type="text"
				bind:value={editName}
				class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.links_add_url_label()}
			<input
				data-testid="links-edit-url"
				type="text"
				bind:value={editUrl}
				class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.links_add_description_label()}
			<input
				data-testid="links-edit-description"
				type="text"
				bind:value={editDescription}
				class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
			/>
		</label>
		<div class="flex gap-2">
			<button
				type="button"
				data-testid="links-edit-save"
				disabled={isOffline}
				onclick={() => onsave(row.id)}
				class="rounded-md border border-ink px-2 py-1 text-xs disabled:opacity-50"
			>
				{m.links_save()}
			</button>
			<button
				type="button"
				data-testid="links-edit-cancel"
				onclick={oncancel}
				class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
			>
				{m.links_cancel()}
			</button>
		</div>
	{:else}
		<a
			data-testid="links-row-url"
			href={row.url}
			target="_blank"
			rel="noopener noreferrer"
		>
			<span data-testid="links-row-name">{row.name}</span>
		</a>
		{#if row.description}
			<p data-testid="links-row-description" class="text-sm text-ink-70">
				{row.description}
			</p>
		{/if}
		{#if isAdmin}
			<div class="flex gap-2">
				<button
					type="button"
					data-testid="links-move-up"
					disabled={index === 0 || reorderPending || isOffline}
					aria-label={m.links_move_up()}
					onclick={() => onmoveup(index)}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
				>
					↑
				</button>
				<button
					type="button"
					data-testid="links-move-down"
					disabled={index === rowCount - 1 || reorderPending || isOffline}
					aria-label={m.links_move_down()}
					onclick={() => onmovedown(index)}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
				>
					↓
				</button>
				<button
					type="button"
					data-testid="links-edit"
					disabled={isOffline}
					onclick={() => onedit(row)}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
				>
					{m.links_edit()}
				</button>
				<button
					type="button"
					data-testid="links-remove"
					disabled={isOffline}
					onclick={() => onremove(row.id)}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
				>
					{m.links_remove()}
				</button>
			</div>
		{/if}
	{/if}
</li>
