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
	import { rovingNextIndex } from '$lib/a11y/roving';

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

	// #156 — roving tabindex. `status` is nullable (a never-answered RSVP), so
	// the active key falls back to the FIRST button rather than nothing —
	// otherwise an unanswered row has zero tab stops. Per-instance $state by
	// construction (this is a component, one instance per agenda row).
	let roving = $state<RsvpStatus | null>(null);
	const activeStatus = $derived(
		roving !== null && BUTTONS.some((b) => b.value === roving) ? roving : (status ?? BUTTONS[0].value)
	);

	function handleKeydown(e: KeyboardEvent): void {
		const group = e.currentTarget as HTMLElement;
		const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
		const idx = buttons.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, buttons.length);
		if (next < 0) return;
		e.preventDefault();
		buttons[next].focus();
	}
</script>

<div
	data-testid="rsvp-control"
	class="flex flex-col gap-1"
	aria-busy={pending ? 'true' : undefined}
>
	<!-- #156 — WAI-APG TOOLBAR: arrows MOVE focus only, they never activate.
	     Activation is destructive-ish here (tapping the ACTIVE status CLEARS
	     the answer), so arrowing across the strip must not commit anything.
	     `role="toolbar"` says so in the markup, where the old bare
	     `role="group"` did not distinguish it from the app's arrow-SELECTS
	     radiogroups; `aria-pressed` toggle buttons inside a toolbar are the
	     APG pattern, so the state pin is unchanged. -->
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
				aria-describedby={nonMember ? hintId : undefined}
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
	<!--
		Message line — ALWAYS rendered (min-height reserves the vertical space) so a
		hint/error appearing or disappearing on a tap never shifts the layout. Holds
		the non-member hint (membership) OR the save-failed error (last write), which
		are mutually exclusive (a non-member can't issue a write).

		#151 — the line sits at the dense BODY tier (`text-xs`), not the stamp tier:
		both of its occupants are sentences, and an error sentence is never a stamp
		(the buttons above are the stamp tier — font-mono chips). Because the two
		occupants swap inside one reserved box, they share one step; the reserved
		pair `min-h-[16px] leading-[16px]` is text-xs's 12/16 metric, so the swap
		still shifts nothing. Error colour is the shared `text-red-700` error role,
		NOT the bare `text-red` destructive-ACTION token. See docs/design/typography.md.
	-->
	<p
		data-testid="rsvp-msg-line"
		class="min-h-[16px] text-xs leading-[16px]"
		class:italic={nonMember}
		class:text-ink-2={nonMember}
		class:text-red-700={saveFailed && !nonMember}
	>
		{#if nonMember}
			<span id={hintId} data-testid="rsvp-non-member-hint">{m.rsvp_non_member_hint()}</span>
		{:else if saveFailed}
			<span data-testid="rsvp-save-failed" role="alert">{m.rsvp_save_failed()}</span>
		{/if}
	</p>
</div>
