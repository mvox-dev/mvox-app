<!-- src/lib/components/agenda/RsvpControl.svelte -->
<!--
	Four-status segmented control for a singer's own rsvp on an agenda row.

	Disable REASON, not a pre-collapsed boolean. The old single `disabled` prop
	conflated two distinct meanings — "not a member" and "a write is in flight" —
	so a member mid-write was told "Only members can RSVP" (the reported
	regression). One reason is left, and it is the only one this control renders:
	  • `pending` — a write for this event is in flight → disabled, aria-busy,
	                and NO hint (PO ruling: silent-disable, no "saving" text).

	#372 (+ its review, F3) — the `nonMember` half is GONE. A confirmed
	non-member no longer gets a disabled control at all; she gets the hint in the
	control's PLACE, which now lives in its own component
	(RsvpNonMemberHint.svelte) rendered by the two surfaces instead of this one.
	Keeping a `nonMember` prop no caller passed left the hint markup duplicated
	across three files, free to drift apart unnoticed.

	`saveFailed` surfaces a per-row error line when the last write for this event
	rejected (its value having been reverted upstream). Distinct from `pending`:
	an ERROR the user should see, not a transient "saving" state.

	#326 — `saved` surfaces the fourth state the old three (nonMember/pending/
	saveFailed) had no room for: a write that reconciled successfully. Without
	it, a reconciled value renders byte-identical to one never attempted —
	exactly the "dangerous pair" epic #289 names. The cue lives in its OWN
	persistent node (`rsvp-saved-status`, role="status" aria-live="polite"),
	mounted from first render regardless of `saved` (a live region must exist
	BEFORE its first announcement to be picked up by assistive tech — the
	#267 reference shape, and the same persistent-node pattern #323's
	links-reorder-status already uses). GREEN's stated choice: this node is
	VISIBLE, not sr-only. The two precedents differ, so only one of them backs
	that: #323's links-reorder-status is visible+aria-live, while #324's
	repertoire-manage-status is sr-only on BOTH its host pages. This surface
	follows #323 — a plain "Saved." sentence needs no second visual language,
	so one combined visible+aria-live node beats a sr-only announcement plus a
	separate visible dot/badge. `saved`
	never touches `isDisabled`/`aria-busy` — it is a SETTLED state, not an
	in-flight one, and the control stays fully interactive under it (a
	reconciled answer can always be changed again).

	No RsvpTallyBadge — tally is out of scope for slice-2 (epic #8).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';
	import { rovingNextIndex } from '$lib/a11y/roving';

	interface Props {
		status?: RsvpStatus | null;
		// The one disable REASON this control knows: a write is in flight. See the
		// block comment above for why membership is not one of its inputs.
		pending?: boolean;
		// The last write for this event failed — show an inline error line.
		saveFailed?: boolean;
		// #326 — the last write for this event RECONCILED successfully. Mutually
		// exclusive with saveFailed in practice (the caller clears one when it
		// sets the other), but this component does not enforce that itself — it
		// only renders what it's given.
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

	// The sole disable reason (see block comment) — a write in flight.
	const isDisabled = $derived(pending);

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
		Message line — ALWAYS rendered (min-height reserves the vertical space) so an
		error appearing or disappearing on a tap never shifts the layout. Holds the
		save-failed error for the last write; since #372 the non-member hint is not
		one of its occupants (a non-member gets no control, so nothing to describe
		here) and lives in RsvpNonMemberHint.svelte, which reuses this same reserved
		box so the hint↔control swap still shifts nothing.

		#151 — the line sits at the dense BODY tier (`text-xs`), not the stamp tier:
		its occupant is a sentence, and an error sentence is never a stamp (the
		buttons above are the stamp tier — font-mono chips). The reserved pair
		`min-h-[16px] leading-[16px]` is text-xs's 12/16 metric, so the line
		appearing or clearing still shifts nothing. Error colour is the shared `text-red-700` error role,
		NOT the bare `text-red` destructive-ACTION token. See docs/design/typography.md.
	-->
	<p
		data-testid="rsvp-msg-line"
		class="min-h-[16px] text-xs leading-[16px]"
		class:text-red-700={saveFailed}
	>
		{#if saveFailed}
			<span data-testid="rsvp-save-failed" role="alert">{m.rsvp_save_failed()}</span>
		{/if}
	</p>
	<!--
		#326 — the SAVED cue, in its own persistent node (never folded into
		rsvp-msg-line above): a live region must be mounted BEFORE its first
		text change to be announced, so this renders unconditionally, blank
		when `saved` is false. VISIBLE (not sr-only, see block comment) — same
		combined visible+aria-live shape as #323's links-reorder-status.
	-->
	<p
		data-testid="rsvp-saved-status"
		role="status"
		aria-live="polite"
		class="min-h-[16px] text-xs leading-[16px] text-ink-2"
	>
		{#if saved}{m.rsvp_saved()}{/if}
	</p>
</div>
