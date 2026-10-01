<script lang="ts">
	import RosterPersonSelect from '$lib/roster/RosterPersonSelect.svelte';
	import ConductorChip from '$lib/agenda/ConductorChip.svelte';

	type Conductor = { id: string; name: string };

	interface Props {
		conductors: Conductor[];
		testid: string;
		fieldTestid?: string;
		ariaLabel?: string;
		label?: string;
		partial: boolean;
		orderFallback: boolean;
		rosterPickerOptions: (excludeIds: readonly string[]) => Array<{ id: string; label: string }>;
		prompt: (optionCount: number) => string;
	}

	let {
		conductors = $bindable(),
		testid,
		fieldTestid = undefined,
		ariaLabel = undefined,
		label = undefined,
		partial,
		orderFallback,
		rosterPickerOptions,
		prompt
	}: Props = $props();

	const options = $derived(rosterPickerOptions(conductors.map((c) => c.id)));

	function add(selection: { id: string; label: string }): void {
		if (conductors.some((c) => c.id === selection.id)) return;
		conductors = [...conductors, { id: selection.id, name: selection.label }];
	}

	function remove(id: string): void {
		conductors = conductors.filter((c) => c.id !== id);
	}
</script>

{#snippet picker()}
	<RosterPersonSelect
		{testid}
		{options}
		prompt={prompt(options.length)}
		{ariaLabel}
		{label}
		{partial}
		{orderFallback}
		onselect={add}
	/>
{/snippet}

{#if fieldTestid}
	<div data-testid={fieldTestid}>
		{@render picker()}
	</div>
{:else}
	{@render picker()}
{/if}
{#if conductors.length > 0}
	<ul class="flex flex-wrap gap-1.5">
		{#each conductors as conductor (conductor.id)}
			<ConductorChip
				{testid}
				personId={conductor.id}
				name={conductor.name}
				onremove={() => remove(conductor.id)}
			/>
		{/each}
	</ul>
{/if}
