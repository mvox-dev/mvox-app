<script lang="ts">
	// #434 slice 3 review round 3, F2 — the ONE "as of <time>" line every
	// offline-capable screen renders over a stored copy (slices 2-6). Same
	// Tallinn calendar day as now → the bare time; any earlier day carries its
	// date alongside it, so a days-old copy never reads as "this morning".
	// The caller decides WHETHER to render it (`$servedFromCache` non-null);
	// this owns only what it says.
	import { m } from '$lib/paraglide/messages.js';
	import { tallinnHHMM, formatTime, timeFormatStore, isoDateFormatter } from '$lib/preferences/timeFormat';

	let {
		readAt,
		testid,
		class: extraClass = ''
	}: {
		/** ISO timestamp of the oldest stored read on screen (`servedFromCache`). */
		readAt: string;
		testid: string;
		/** Placement only (margins) — the look is this component's. */
		class?: string;
	} = $props();

	const tallinnDate = isoDateFormatter('Europe/Tallinn');
	const asOf = $derived(new Date(readAt));
	const isToday = $derived(tallinnDate.format(asOf) === tallinnDate.format(new Date()));
	const time = $derived(formatTime(tallinnHHMM(asOf), $timeFormatStore));
</script>

<p
	data-testid={testid}
	role="status"
	class="rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2 {extraClass}"
>
	{m.last_read_as_of({ time: isToday ? time : `${tallinnDate.format(asOf)} ${time}` })}
</p>

<!-- (*MVOX:Josquin* — #434 slice 3 review round 3: the one "as of" line) -->
