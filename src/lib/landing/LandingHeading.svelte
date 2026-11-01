<!-- The landing heading: the collective (a switch when there are several) and the profile link. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PersonName from '$lib/components/PersonName.svelte';
	import { collectiveState, pickerModeStore, selectCollective } from '$lib/collectives/store';
	import type { Collective } from '$lib/collectives/types';

	let { selected, initials }: { selected: Collective; initials: string } = $props();

	const collectives = $derived($collectiveState);
</script>

<header class="flex items-center justify-between gap-3 pb-2">
	{#if $pickerModeStore === 'picker'}
		<select
			class="rounded-md border border-ink bg-paper px-2 py-1 font-display text-xl text-ink"
			data-testid="selected-collective"
			aria-label={m.agenda_switch_collective()}
			value={selected.db}
			onchange={(e) => void selectCollective((e.currentTarget as HTMLSelectElement).value)}
		>
			{#each collectives.status === 'ready' ? collectives.collectives : [] as c (c.db)}
				<option value={c.db}>{c.name}</option>
			{/each}
		</select>
	{:else}
		<h1 class="font-display text-xl text-ink" data-testid="selected-collective">{selected.name}</h1>
	{/if}
	<a
		href="/profile"
		data-testid="landing-profile"
		aria-label={m.nav_profile()}
		class="flex h-10 min-w-10 items-center justify-center rounded-full border border-ink px-2 text-sm text-ink"
	>
		{#if initials}<PersonName name={initials} />{:else}{m.nav_profile()}{/if}
	</a>
</header>
