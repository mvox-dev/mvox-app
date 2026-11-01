<!-- The next event: when and where, the own answer, and the one link to the event page. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import RsvpControl from '$lib/components/agenda/RsvpControl.svelte';
	import RsvpNonMemberHint from '$lib/components/agenda/RsvpNonMemberHint.svelte';
	import { timeFormatStore } from '$lib/preferences/timeFormat';
	import type { AgendaItem } from '$lib/agenda/types';
	import type { RsvpEntry, RsvpStatus } from '$lib/rsvp/rsvpData';
	import type { EventTally } from './landingReads';
	import LandingAnswerButtons from './LandingAnswerButtons.svelte';
	import { eventDayLine, eventTimeLine } from './landingFormat';

	let {
		event,
		answer,
		answersKnown,
		nonMember,
		canWrite,
		pending,
		failed,
		tally,
		tallyError,
		onanswer
	}: {
		event: AgendaItem;
		answer: RsvpEntry | undefined;
		answersKnown: boolean;
		nonMember: boolean;
		canWrite: boolean;
		pending: boolean;
		failed: boolean;
		tally: EventTally | null;
		tallyError: boolean;
		onanswer: (status: RsvpStatus | null) => void;
	} = $props();

	let changing = $state(false);

	const linkText = $derived(
		[
			...(tally
				? [
						m.event_detail_tally_going({ count: tally.going }),
						m.event_detail_tally_not_responded({ count: tally.notResponded })
					]
				: []),
			m.landing_event_programme()
		].join(' · ')
	);

	const LABELS: Record<RsvpStatus, () => string> = {
		going: m.rsvp_status_going,
		not_going: m.rsvp_status_not_going,
		maybe: m.rsvp_status_maybe,
		late: m.rsvp_status_late
	};
</script>

<section data-testid="landing-next-event" class="flex flex-col gap-2 rounded-lg border border-ink-5 p-4">
	{#if event.name}<h2 class="font-display text-lg text-ink">{event.name}</h2>{/if}
	<p class="text-sm text-ink">{eventDayLine(event)}</p>
	<p class="text-sm text-ink-2">{eventTimeLine(event, $timeFormatStore)}</p>
	{#if nonMember}
		<RsvpNonMemberHint />
	{:else if answersKnown && canWrite}
		{#if answer && !changing}
			<p data-testid="landing-next-answer" class="flex items-baseline gap-2 text-sm text-ink">
				<span>{LABELS[answer.status]()}</span>
				<button
					type="button"
					data-testid="landing-change-answer"
					class="text-xs text-ink-2 underline"
					onclick={() => (changing = true)}>{m.landing_change_answer()}</button
				>
			</p>
		{:else if answer}
			<RsvpControl
				status={answer.status}
				{pending}
				onchange={(s) => {
					changing = false;
					onanswer(s);
				}}
			/>
		{:else}
			<div class="flex items-center justify-between gap-2">
				<p data-testid="landing-next-answer" class="text-sm text-ink-2">
					{m.landing_not_answered()}
				</p>
				<LandingAnswerButtons eventId={event.id} disabled={pending} onanswer={(s) => onanswer(s)} />
			</div>
		{/if}
		{#if failed}
			<p data-testid="landing-save-failed-{event.id}" role="alert" class="text-xs text-danger">
				{m.rsvp_save_failed()}
			</p>
		{/if}
	{/if}
	<a data-testid="landing-event-link" href="/event/{event.id}" class="text-sm text-ink underline">
		{linkText} <span aria-hidden="true">›</span>
	</a>
	{#if tallyError}
		<p data-testid="landing-tally-error" class="text-xs text-danger">{m.event_detail_tally_error()}</p>
	{/if}
</section>
