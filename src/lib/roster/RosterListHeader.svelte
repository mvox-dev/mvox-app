<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RosterState } from '$lib/roster/rosterPageState';

	let {
		view,
		sectionsError,
		onToggleView
	}: { view: RosterState['view']; sectionsError: boolean; onToggleView: () => void } = $props();
</script>

<div class="flex items-center justify-between border-b border-ink-5 pb-1.5">
	<span class="text-xs tracking-wide text-ink-2 uppercase">{m.roster_column_name()}</span>
	{#if !sectionsError}
		<button
			type="button"
			data-testid="roster-sort-toggle"
			aria-pressed={view === 'flat'}
			class="text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
			onclick={onToggleView}
		>
			{view === 'grouped' ? m.roster_sort_alphabetical() : m.roster_sort_grouped()}
		</button>
	{/if}
</div>
