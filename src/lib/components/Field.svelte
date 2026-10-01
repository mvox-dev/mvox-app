<!-- A form field: caption over the native control the caller renders; disabled dims it. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		labelTestid,
		disabled = false,
		grow = false,
		children
	}: {
		label: string;
		labelTestid?: string;
		disabled?: boolean;
		grow?: boolean;
		children: Snippet<[{ class: string; disabled: boolean }]>;
	} = $props();
</script>

<label class={['flex flex-col gap-0.5', grow ? 'min-w-0 flex-1' : 'w-full']}>
	<span data-testid={labelTestid} class="text-xs text-ink-2">{label}</span>
	{@render children({
		class: 'w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50',
		disabled
	})}
</label>
