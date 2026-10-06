<!-- Four-status rsvp control for a singer's own answer, on an agenda row or the event page. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';
	import SegmentedPill from '$lib/components/SegmentedPill.svelte';
	import { writesAvailable } from '$lib/net/online';

	interface Props {
		status?: RsvpStatus | null;
		// Disabled while a write is in flight, with no hint (PO ruling: silent disable).
		pending?: boolean;
		saveFailed?: boolean;
		saved?: boolean;
		onchange?: (s: RsvpStatus | null) => void;
	}
	const {
		status = null,
		pending = false,
		saveFailed = false,
		saved = false,
		onchange
	}: Props = $props();

	const isOffline = $derived(!$writesAvailable);

	const BUTTONS: { value: RsvpStatus; label: () => string }[] = [
		{ value: 'going', label: m.rsvp_status_going },
		{ value: 'not_going', label: m.rsvp_status_not_going },
		{ value: 'maybe', label: m.rsvp_status_maybe },
		{ value: 'late', label: m.rsvp_status_late }
	];
</script>

<div
	data-testid="rsvp-control"
	class="flex flex-col gap-1"
	aria-busy={pending ? 'true' : undefined}
>
	<!-- Tapping the chosen answer clears it. -->
	<SegmentedPill
		testid="rsvp-status-group"
		label={m.rsvp_group_label()}
		options={BUTTONS.map((b) => ({ value: b.value, label: b.label(), testid: `rsvp-btn-${b.value}` }))}
		selected={status}
		emptyAllowed={true}
		kind="data"
		busy={pending}
		onselect={(s) => onchange?.(s)}
	/>
	{#if isOffline}
		<p data-testid="rsvp-write-unavailable" class="text-xs text-ink-2">
			{m.write_unavailable_no_signal()}
		</p>
	{/if}
	<!-- Always rendered, so an error appearing or clearing never shifts the layout. -->
	<p
		data-testid="rsvp-msg-line"
		class="min-h-[16px] text-xs leading-[16px]"
		class:text-red-700={saveFailed}
	>
		{#if saveFailed}
			<span data-testid="rsvp-save-failed" role="alert">{m.rsvp_save_failed()}</span>
		{/if}
	</p>
	<!-- Always mounted: a live region must exist before its first change to be announced. -->
	<p
		data-testid="rsvp-saved-status"
		role="status"
		aria-live="polite"
		class="min-h-[16px] text-xs leading-[16px] text-ink-2"
	>
		{#if saved}{m.rsvp_saved()}{/if}
	</p>
</div>
