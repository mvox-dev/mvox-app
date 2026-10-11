<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import EventRsvpMyAnswer from '$lib/events/EventRsvpMyAnswer.svelte';
	import EventRsvpTally from '$lib/events/EventRsvpTally.svelte';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions, EventPageState } from '$lib/events/eventPageState';

	let {
		detail,
		selected,
		ev,
		isOffline,
		generation,
		actions
	}: {
		detail: EventDetail;
		selected: Collective | null;
		ev: EventPageState;
		isOffline: boolean;
		generation: () => number;
		actions: EventActions;
	} = $props();

	let tally: ReturnType<typeof EventRsvpTally> | undefined;
</script>

<section
	data-testid="event-detail-rsvp"
	class="mt-3 flex flex-col gap-2"
	aria-labelledby="event-detail-rsvp-heading"
>
	<h2 id="event-detail-rsvp-heading" class="font-display text-lg text-ink-2">
		{m.event_detail_rsvp_heading()}
	</h2>
	<EventRsvpMyAnswer
		{detail}
		{selected}
		{ev}
		{isOffline}
		{generation}
		{actions}
		onreconcile={() => tally?.reload()}
	/>
	<EventRsvpTally bind:this={tally} {detail} {selected} {generation} {actions} />
</section>
