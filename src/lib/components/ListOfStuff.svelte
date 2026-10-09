<!-- The frame for a main list (#859): filter left above it, view control top right inside it. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { filter, view, children }: { filter?: Snippet; view?: Snippet; children: Snippet } =
		$props();
</script>

<div data-testid="list-of-stuff" class="flex flex-col">
	{#if filter}
		<div data-testid="list-of-stuff-filter" class="flex flex-wrap justify-start pb-3">
			{@render filter()}
		</div>
	{/if}
	<div data-testid="list-of-stuff-body" class="flex flex-col">
		{#if view}
			<div data-testid="list-of-stuff-view" class="flex flex-wrap justify-end gap-2 pb-2">
				{@render view()}
			</div>
		{/if}
		{@render children()}
	</div>
</div>
