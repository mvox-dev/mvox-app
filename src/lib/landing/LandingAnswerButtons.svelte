<!-- ✓ answers "going" in one tap; ⋯ offers the other three answers. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';

	let {
		eventId,
		disabled,
		onanswer
	}: { eventId: string; disabled: boolean; onanswer: (status: RsvpStatus) => void } = $props();

	let open = $state(false);

	const OTHERS: { value: RsvpStatus; label: () => string }[] = [
		{ value: 'not_going', label: m.rsvp_status_not_going },
		{ value: 'maybe', label: m.rsvp_status_maybe },
		{ value: 'late', label: m.rsvp_status_late }
	];

	function pick(status: RsvpStatus): void {
		open = false;
		onanswer(status);
	}
</script>

<div class="flex flex-col items-end gap-1">
	<div class="flex gap-1">
		<button
			type="button"
			data-testid="landing-going-{eventId}"
			class="rounded-md border border-ink px-3 py-1 text-sm text-ink hover:bg-ink hover:text-paper disabled:opacity-40"
			aria-label={m.rsvp_status_going()}
			{disabled}
			onclick={() => pick('going')}><span aria-hidden="true">✓</span></button
		>
		<button
			type="button"
			data-testid="landing-more-{eventId}"
			class="rounded-md border border-ink px-3 py-1 text-sm text-ink hover:bg-ink hover:text-paper disabled:opacity-40"
			aria-label={m.landing_more_answers()}
			aria-expanded={open}
			{disabled}
			onclick={() => (open = !open)}><span aria-hidden="true">⋯</span></button
		>
	</div>
	{#if open && !disabled}
		<div data-testid="landing-others-{eventId}" class="flex flex-wrap justify-end gap-1">
			{#each OTHERS as o (o.value)}
				<button
					type="button"
					data-testid="landing-answer-{o.value}-{eventId}"
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
					onclick={() => pick(o.value)}>{o.label()}</button
				>
			{/each}
		</div>
	{/if}
</div>
