<!-- How many of the next event's parts are on this device, with Download all for the rest. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { NextEventPartsFailure, NextEventPartsView } from '$lib/agenda/nextEventDownload';

	let { parts }: { parts: NextEventPartsView & { heldFileIds: ReadonlySet<string> } } = $props();

	const FAILURE_TEXT: Record<NextEventPartsFailure, () => string> = {
		'storage-full': m.agenda_parts_storage_full,
		'too-large': m.agenda_parts_too_large,
		'no-connection': m.agenda_parts_no_connection,
		'not-downloaded': m.agenda_parts_download_failed
	};

	let running = $state(false);
	let failure = $state<NextEventPartsFailure | null>(null);
	const total = $derived(parts.fileIds.length);
	const held = $derived(parts.fileIds.filter((id) => parts.heldFileIds.has(id)).length);

	async function downloadAll() {
		running = true;
		failure = null;
		const done = await parts.download(parts.fileIds);
		running = false;
		if (done) failure = done.failure;
	}
</script>

<div
	data-testid="agenda-next-parts-{parts.eventId}"
	data-card-controls
	class="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-1"
>
	<span class="font-mono text-[10px] text-ink-2">{m.agenda_parts_on_device({ held, total })}</span>
	{#if held < total}
		<button
			type="button"
			class="rounded-md border border-ink px-2 py-1 font-mono text-[9px] tracking-wide text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
			disabled={running}
			onclick={downloadAll}
		>
			{m.agenda_parts_download_all()}
		</button>
	{/if}
	{#if failure}
		<p data-testid="agenda-next-parts-failure" class="w-full text-xs text-ink-2">
			{FAILURE_TEXT[failure]()}
		</p>
	{/if}
</div>
