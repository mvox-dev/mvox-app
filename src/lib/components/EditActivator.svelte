<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		label,
		class: className = '',
		element = $bindable(),
		children,
		...rest
	}: HTMLButtonAttributes & {
		label: string;
		class?: string;
		element?: HTMLButtonElement;
		children?: Snippet;
	} = $props();
</script>

<button
	type="button"
	bind:this={element}
	class="group flex min-h-11 appearance-none border-0 bg-transparent p-0 text-left disabled:opacity-40 {className}"
	{...rest}
>
	<span class="sr-only">{label}</span>
	<!-- Preflight sets no pointer cursor on buttons; the hover colour is the cue. -->
	<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
	{#if children}
		{@render children()}
	{/if}
</button>
