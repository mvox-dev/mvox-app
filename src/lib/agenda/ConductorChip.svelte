<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PersonName from '$lib/components/PersonName.svelte';

	interface Props {
		testid: string;
		personId: string;
		name: string;
		conductorKey?: string;
		disabled?: boolean;
		onremove: () => void;
	}

	let {
		testid,
		personId,
		name,
		conductorKey = undefined,
		disabled = false,
		onremove
	}: Props = $props();
</script>

<li
	data-testid="{testid}-{personId}"
	data-conductor-key={conductorKey}
	class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
>
	<PersonName {name} />
	<!-- #237: unlink is not destroy — this chip keeps its × and muted
	     tone on purpose; DeleteTrigger is for Table A only. -->
	<button
		type="button"
		data-testid="{testid}-remove-{personId}"
		aria-label={m.season_conductor_remove({ name })}
		{disabled}
		class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50"
		onclick={onremove}
	>
		&times;
	</button>
</li>
