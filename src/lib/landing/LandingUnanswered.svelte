<!-- Upcoming events not yet answered, after the next one: the first few, and the count. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { timeFormatStore } from '$lib/preferences/timeFormat';
	import type { AgendaItem } from '$lib/agenda/types';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';
	import LandingAnswerButtons from './LandingAnswerButtons.svelte';
	import { eventDayLine, eventTimeLine } from './landingFormat';
	import { UNANSWERED_SHOWN } from './landingState.svelte';

	let {
		events,
		pending,
		failed,
		disabled,
		onanswer
	}: {
		events: AgendaItem[];
		pending: Set<string>;
		failed: Set<string>;
		disabled: boolean;
		onanswer: (eventId: string, status: RsvpStatus) => void;
	} = $props();
</script>

<section data-testid="landing-unanswered" class="flex flex-col gap-2" aria-labelledby="landing-unanswered-heading">
	<h2 id="landing-unanswered-heading" class="font-display text-lg text-ink-2">
		{m.landing_waiting_heading({ count: events.length })}
	</h2>
	<ul class="flex flex-col gap-2">
		{#each events.slice(0, UNANSWERED_SHOWN) as event (event.id)}
			<li data-testid="landing-unanswered-{event.id}" class="flex items-start justify-between gap-2">
				<a href="/event/{event.id}" class="flex flex-col text-sm text-ink">
					<span>{eventDayLine(event)}</span>
					<span class="text-xs text-ink-2">{eventTimeLine(event, $timeFormatStore)}</span>
					{#if failed.has(event.id)}
						<span data-testid="landing-save-failed-{event.id}" role="alert" class="text-xs text-danger">
							{m.rsvp_save_failed()}
						</span>
					{/if}
				</a>
				<LandingAnswerButtons
					eventId={event.id}
					disabled={disabled || pending.has(event.id)}
					onanswer={(s) => onanswer(event.id, s)}
				/>
			</li>
		{/each}
	</ul>
	<a href="/agenda" data-testid="landing-all-agenda" class="text-sm text-ink underline">
		{m.landing_all_agenda()} <span aria-hidden="true">›</span>
	</a>
</section>
