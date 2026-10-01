<!-- Copy, send and close: what NavShell shows in place of the nav while the editor is open. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { FeedbackEditor } from '$lib/feedback/feedbackEditor.svelte';

	let { editor }: { editor: FeedbackEditor } = $props();

	const BUTTON_CLASS =
		'min-h-11 min-w-11 rounded-md px-3 py-1.5 font-sans text-sm text-ink hover:bg-paper disabled:cursor-default disabled:opacity-60';
</script>

<button type="button" class={BUTTON_CLASS} disabled={!editor.shot} onclick={() => editor.copy()}>
	{m.feedback_copy()}
</button>
<button type="button" class={BUTTON_CLASS} disabled={!editor.shot} onclick={() => editor.send()}>
	{m.feedback_send()}
</button>
<button type="button" class={BUTTON_CLASS} onclick={() => editor.close()}>
	{m.feedback_close()}
</button>
