<!-- src/lib/components/attendance/TakeAttendanceButton.svelte -->
<!--
	#103 review F3 — the conductor's "Take attendance" entry point, in ONE place.
	Both surfaces that offer it (the agenda's recent rows, the event detail page)
	render the same testid, the same event-named aria-label and the same chrome;
	they had drifted into two copies of the markup. The RIGHTS gate stays with
	the caller — each surface resolves "is this viewer the conductor for THIS
	event" its own way (#83's resolveConductors verdict) and simply does not
	render this component otherwise.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		/** Names the event in the aria-label — several buttons can share a page. */
		eventName: string;
		onclick: () => void;
	}
	const { eventName, onclick }: Props = $props();
</script>

<button
	type="button"
	data-testid="take-attendance-btn"
	aria-label={m.agenda_take_attendance_label({ event: eventName })}
	class="self-start rounded-md border border-ink px-2 py-1 font-mono text-[9px] tracking-wide text-ink hover:bg-ink hover:text-paper"
	{onclick}
>
	{m.agenda_take_attendance()}
</button>
