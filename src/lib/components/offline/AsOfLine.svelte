<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		isoDateFormatter,
		TALLINN_TZ
	} from '$lib/preferences/timeFormat';

	let {
		readAt,
		testid,
		class: extraClass = ''
	}: {
		readAt: string;
		testid: string;
		class?: string;
	} = $props();

	const tallinnDate = isoDateFormatter(TALLINN_TZ);
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
