<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import SegmentedPill from '$lib/components/SegmentedPill.svelte';
	import type { RosterState, RosterViewMode } from '$lib/roster/rosterPageState';
	import type { viewModeOptions } from '$lib/roster/rosterView';

	let {
		roster,
		modeOptions,
		onSetViewMode
	}: {
		roster: RosterState;
		modeOptions: ReturnType<typeof viewModeOptions>;
		onSetViewMode: (mode: RosterViewMode) => void;
	} = $props();
</script>

{#if !roster.sectionsError}
	<button
		type="button"
		data-testid="roster-sort-toggle"
		aria-pressed={roster.view === 'flat'}
		class="text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
		onclick={() => (roster.view = roster.view === 'grouped' ? 'flat' : 'grouped')}
	>
		{roster.view === 'grouped' ? m.roster_sort_alphabetical() : m.roster_sort_grouped()}
	</button>
{/if}
{#if roster.view === 'grouped' && !roster.sectionsError}
	<SegmentedPill
		testid="roster-view-modes"
		label={m.roster_view_modes_label()}
		options={modeOptions}
		selected={roster.viewMode}
		emptyAllowed={false}
		defaultValue="collapsed"
		kind="ui"
		buttonClass="px-2.5 py-1 text-xs tracking-wide uppercase"
		onselect={(mode) => mode && onSetViewMode(mode)}
	/>
{/if}
