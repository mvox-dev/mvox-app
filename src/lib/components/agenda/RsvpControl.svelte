<!-- Four-status rsvp control for a singer's own answer, on an agenda row or the event page. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';
	import { rovingKeydown } from '$lib/a11y/roving';
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
	const isDisabled = $derived(pending || isOffline);

	const BUTTONS: { value: RsvpStatus; label: () => string }[] = [
		{ value: 'going', label: m.rsvp_status_going },
		{ value: 'not_going', label: m.rsvp_status_not_going },
		{ value: 'maybe', label: m.rsvp_status_maybe },
		{ value: 'late', label: m.rsvp_status_late }
	];

	function handleClick(value: RsvpStatus) {
		if (isDisabled || !onchange) return;
		// Tap the ACTIVE status -> clear the answer (null); tap any other -> set it.
		onchange(status === value ? null : value);
	}

	// An unanswered rsvp has no status, so the first button holds the tab stop.
	let roving = $state<RsvpStatus | null>(null);
	const activeStatus = $derived(
		roving !== null && BUTTONS.some((b) => b.value === roving) ? roving : (status ?? BUTTONS[0].value)
	);

	function handleKeydown(e: KeyboardEvent): void {
		rovingKeydown(e, { selector: 'button:not([disabled])' });
	}
</script>

<div
	data-testid="rsvp-control"
	class="flex flex-col gap-1"
	aria-busy={pending ? 'true' : undefined}
>
	<!-- Toolbar: arrows move focus only; tapping the active status clears the answer. -->
	<div
		data-testid="rsvp-status-group"
		role="toolbar"
		tabindex="-1"
		aria-label={m.rsvp_group_label()}
		class="inline-flex overflow-hidden rounded-md border border-ink-4"
		onkeydown={handleKeydown}
	>
		{#each BUTTONS as btn (btn.value)}
			<button
				data-testid="rsvp-btn-{btn.value}"
				type="button"
				disabled={isDisabled}
				aria-pressed={status === btn.value ? 'true' : 'false'}
				tabindex={activeStatus === btn.value ? 0 : -1}
				onfocus={() => (roving = btn.value)}
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
