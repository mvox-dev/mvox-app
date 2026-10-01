<!-- A create form's submit and cancel buttons; each form keeps its own handlers and labels. -->
<script lang="ts">
	let {
		testid,
		submitLabel,
		cancelLabel,
		submitting,
		isOffline,
		submitBlocked = false,
		onsubmit,
		oncancel
	}: {
		testid: string;
		submitLabel: string;
		cancelLabel: string;
		submitting: boolean;
		isOffline: boolean;
		submitBlocked?: boolean;
		onsubmit: () => void;
		oncancel: () => void;
	} = $props();
</script>

<div class="flex gap-2">
	<button
		type="button"
		data-testid="{testid}-submit"
		disabled={submitting || submitBlocked || isOffline}
		aria-busy={submitting}
		class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
		onclick={onsubmit}
	>
		{submitLabel}
	</button>
	<button
		type="button"
		data-testid="{testid}-cancel"
		disabled={submitting}
		class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
		onclick={oncancel}
	>
		{cancelLabel}
	</button>
</div>
