<script lang="ts">
	// Shared delete trigger, 44px touch minimum by construction: `class` appends, never strips.
	// `hover:text-danger-strong` lives only here (trashcan-sweep.spec.ts); so does the disabled face.
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import TrashIcon from './icons/TrashIcon.svelte';

	let {
		class: className = '',
		iconClass = 'h-5 w-5',
		children,
		...rest
	}: HTMLButtonAttributes & {
		class?: string;
		iconClass?: string;
		children?: Snippet;
	} = $props();
</script>

<button
	type="button"
	class="flex min-h-11 min-w-11 items-center justify-center text-danger hover:text-danger-strong disabled:cursor-default disabled:opacity-60 disabled:hover:text-danger {className}"
	{...rest}
>
	<TrashIcon class={iconClass} />
	{#if children}
		{@render children()}
	{/if}
</button>
