<!-- Over a page that could not be drawn; taps outside its box still reach the paging zones. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	let { onretry }: { onretry: () => void } = $props();
</script>

<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
	<div
		class="pointer-events-auto flex w-1/2 flex-col items-center gap-4 rounded bg-ink px-6 py-4 text-center"
	>
		<p data-testid="part-viewer-page-failed" class="font-sans text-base text-paper">
			{m.part_viewer_page_failed()}
		</p>
		<button
			type="button"
			class="font-sans text-sm text-paper underline"
			data-testid="part-viewer-retry"
			onclick={onretry}
		>
			{m.part_viewer_retry()}
		</button>
	</div>
</div>

<!-- (*MVOX:Josquin*) -->
