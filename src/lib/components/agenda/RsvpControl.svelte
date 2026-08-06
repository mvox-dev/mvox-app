<!-- src/lib/components/agenda/RsvpControl.svelte -->
<!--
	#12 GREEN. Four-status segmented control for a singer's own rsvp on an
	agenda row. Harvested from mvox_v4e_web's RsvpControl.svelte (same shape:
	tap-active-to-clear, disabled + hint for non-members), reskinned onto this
	app's Tailwind-v4-only convention (no raw <style> block) and its
	`import { m } from '$lib/paraglide/messages.js'` style, matching
	AgendaList.svelte. No RsvpTallyBadge — tally is out of scope for slice-2
	(epic #8).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';

	interface Props {
		status?: RsvpStatus | null;
		disabled?: boolean;
		onchange?: (s: RsvpStatus | null) => void;
	}
	const { status = null, disabled = false, onchange }: Props = $props();

	const BUTTONS: { value: RsvpStatus; label: () => string }[] = [
		{ value: 'going', label: m.rsvp_status_going },
		{ value: 'not_going', label: m.rsvp_status_not_going },
		{ value: 'maybe', label: m.rsvp_status_maybe },
		{ value: 'late', label: m.rsvp_status_late }
	];

	function handleClick(value: RsvpStatus) {
		if (disabled || !onchange) return;
		// Tap the ACTIVE status -> clear the answer (null); tap any other -> set it.
		onchange(status === value ? null : value);
	}
</script>

<div data-testid="rsvp-control" class="flex flex-col gap-1">
	<div class="inline-flex overflow-hidden rounded-md border border-ink-4">
		{#each BUTTONS as btn (btn.value)}
			<button
				data-testid="rsvp-btn-{btn.value}"
				type="button"
				{disabled}
				aria-pressed={status === btn.value ? 'true' : 'false'}
				class="border-r border-ink-4 px-2 py-1 font-mono text-[9px] tracking-wide last:border-r-0 disabled:cursor-default disabled:opacity-[0.45]"
				class:bg-ink={status === btn.value}
				class:text-paper={status === btn.value}
				class:text-ink-2={status !== btn.value}
				onclick={() => handleClick(btn.value)}
			>
				{btn.label()}
			</button>
		{/each}
	</div>
	{#if disabled}
		<p class="text-[9px] text-ink-2 italic">{m.rsvp_non_member_hint()}</p>
	{/if}
</div>
