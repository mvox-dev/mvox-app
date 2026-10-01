<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		tallinnDayKey
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

	const asOf = $derived(new Date(readAt));
	const isToday = $derived(tallinnDayKey(asOf) === tallinnDayKey(new Date()));
	const time = $derived(formatTime(tallinnHHMM(asOf), $timeFormatStore));
</script>

<p
	data-testid={testid}
	role="status"
	class="rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2 {extraClass}"
>
	{m.last_read_as_of({ time: isToday ? time : `${tallinnDayKey(asOf)} ${time}` })}
</p>
