<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		testid: string;
		options: Array<{ id: string; label: string }>;
		prompt: string;
		ariaLabel?: string;
		label?: string;
		disabled?: boolean;
		partial: boolean;
		orderFallback: boolean;
		onselect: (selection: { id: string; label: string }) => void;
	}

	let {
		testid,
		options,
		prompt,
		ariaLabel = undefined,
		label = undefined,
		disabled = false,
		partial,
		orderFallback,
		onselect
	}: Props = $props();
</script>

{#snippet select()}
	<!-- The prompt option cannot be committed; with everyone added the select stays, disabled. -->
	<select
		data-testid="{testid}-select"
		aria-label={ariaLabel}
		disabled={options.length === 0 || disabled}
		value=""
		onchange={(e) => {
			const target = e.currentTarget as HTMLSelectElement;
			const personId = target.value;
			target.value = '';
			if (!personId) return;
			const optionLabel = options.find((o) => o.id === personId)?.label ?? '';
			onselect({ id: personId, label: optionLabel });
		}}
		class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
	>
		<option value="" disabled selected hidden>{prompt}</option>
		{#each options as option (option.id)}
			<option value={option.id}>{option.label}</option>
		{/each}
	</select>
{/snippet}

{#if label}
	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{label}</span>
		{@render select()}
	</label>
{:else}
	{@render select()}
{/if}
{#if partial}
	<p data-testid="{testid}-partial-notice" role="status" class="text-xs text-ink-2">
		{m.picker_partial_members_notice()}
	</p>
{/if}
{#if orderFallback}
	<p data-testid="{testid}-order-note" class="text-xs text-ink-2">
		{m.picker_order_fallback()}
	</p>
{/if}
