<!-- src/lib/components/agenda/RsvpControl.svelte -->
<!--
	Four-status segmented control for a singer's own rsvp on an agenda row.

	Disable REASON, not a pre-collapsed boolean. The old single `disabled` prop
	conflated two distinct meanings — "not a member" and "a write is in flight" —
	so a member mid-write was told "Only members can RSVP" (the reported
	regression). The control now takes the reason itself:
	  • `nonMember` — a CONFIRMED non-member → disabled + the non-member hint.
	  • `pending`   — a write for this event is in flight → disabled, aria-busy,
	                  and NO hint (PO ruling: silent-disable, no "saving" text).
	`isDisabled = nonMember || pending` drives the button [disabled] attr and the
	handleClick early-return; the hint is gated on `nonMember` ONLY.

	`saveFailed` surfaces a per-row error line when the last write for this event
	rejected (its value having been reverted upstream). Distinct from `pending`:
	an ERROR the user should see, not a transient "saving" state.

	No RsvpTallyBadge — tally is out of scope for slice-2 (epic #8).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';

	interface Props {
		status?: RsvpStatus | null;
		// The disable REASON, split so the hint tracks membership, not the button
		// state (see block comment above).
		nonMember?: boolean;
		pending?: boolean;
		// The last write for this event failed — show an inline error line.
		saveFailed?: boolean;
		onchange?: (s: RsvpStatus | null) => void;
	}
	const {
		status = null,
		nonMember = false,
		pending = false,
		saveFailed = false,
		onchange
	}: Props = $props();

	// Both reasons disable the buttons; only `nonMember` shows the hint.
	const isDisabled = $derived(nonMember || pending);

	// Stable, per-instance id so each row's buttons can point at THEIR OWN hint
	// via aria-describedby (never a different row's).
	const hintId = $props.id();

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
</script>

<div
	data-testid="rsvp-control"
	class="flex flex-col gap-1"
	aria-busy={pending ? 'true' : undefined}
>
	<div class="inline-flex overflow-hidden rounded-md border border-ink-4">
		{#each BUTTONS as btn (btn.value)}
			<button
				data-testid="rsvp-btn-{btn.value}"
				type="button"
				disabled={isDisabled}
				aria-pressed={status === btn.value ? 'true' : 'false'}
				aria-describedby={nonMember ? hintId : undefined}
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
	<!--
		Message line — ALWAYS rendered (min-height reserves the vertical space) so a
		hint/error appearing or disappearing on a tap never shifts the layout. Holds
		the non-member hint (membership) OR the save-failed error (last write), which
		are mutually exclusive (a non-member can't issue a write).
	-->
	<p
		data-testid="rsvp-msg-line"
		class="min-h-[14px] text-[9px] leading-[14px]"
		class:italic={nonMember}
		class:text-ink-2={nonMember}
		class:text-red={saveFailed && !nonMember}
	>
		{#if nonMember}
			<span id={hintId} data-testid="rsvp-non-member-hint">{m.rsvp_non_member_hint()}</span>
		{:else if saveFailed}
			<span data-testid="rsvp-save-failed" role="alert">{m.rsvp_save_failed()}</span>
		{/if}
	</p>
</div>
