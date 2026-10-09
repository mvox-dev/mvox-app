<!-- The frame for a main list (#859): title and view control on one header line, filter below. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		filter,
		view,
		children
	}: { title: string; filter?: Snippet; view?: Snippet; children: Snippet } = $props();
</script>

<div data-testid="list-of-stuff" class="flex flex-col">
	<div
		data-testid="list-of-stuff-header"
		class="flex flex-wrap items-center justify-between gap-2 pb-3"
	>
		<h1 data-testid="list-of-stuff-title" class="font-display text-2xl">{title}</h1>
		{#if view}
			<div data-testid="list-of-stuff-view" class="flex flex-wrap justify-end gap-2">
				{@render view()}
			</div>
		{/if}
	</div>
	{#if filter}
		<div data-testid="list-of-stuff-filter" class="flex flex-wrap justify-start pb-3">
			{@render filter()}
		</div>
	{/if}
	<div data-testid="list-of-stuff-body" class="flex flex-col">
		{@render children()}
	</div>
</div>
