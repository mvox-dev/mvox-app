<!-- The feedback editor: the screenshot under the pen, and the description. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { FeedbackEditor } from '$lib/feedback/feedbackEditor.svelte';
	import FormError from '../FormError.svelte';
	import StrokeSurface from '../StrokeSurface.svelte';

	let { editor }: { editor: FeedbackEditor } = $props();

	let surfaceWrap: HTMLDivElement | undefined = $state();

	// StrokeSurface's own box holds just the screenshot and its ink, not the pen controls.
	$effect(() => {
		editor.stage =
			surfaceWrap?.querySelector<HTMLElement>('[data-testid="stroke-surface"]')?.parentElement ??
			undefined;
		return () => {
			editor.stage = undefined;
		};
	});
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4" data-testid="feedback-editor">
	{#if editor.notice === 'copied'}
		<p role="status" class="text-sm text-ink-2">{m.feedback_copied()}</p>
	{:else if editor.notice === 'capture-failed'}
		<FormError>{m.feedback_capture_failed()}</FormError>
	{:else if editor.notice === 'copy-unsupported'}
		<FormError>{m.feedback_copy_unsupported()}</FormError>
	{:else if editor.notice === 'copy-failed'}
		<FormError>{m.feedback_copy_failed()}</FormError>
	{:else if editor.notice === 'send-failed'}
		<FormError>{m.feedback_send_failed()}</FormError>
	{:else if editor.notice === 'send-after-sign-in'}
		<p role="status" class="text-sm text-ink-2">{m.feedback_send_after_sign_in()}</p>
	{/if}

	{#if editor.shot}
		{@const shot = editor.shot}
		{#snippet base()}
			<img src={shot.url} alt={m.feedback_screenshot_alt()} class="block w-full" />
		{/snippet}
		<div bind:this={surfaceWrap} class="flex flex-col gap-2">
			<StrokeSurface
				{base}
				bind:strokes={editor.strokes}
				naturalWidth={shot.width}
				naturalHeight={shot.height}
			/>
		</div>
		<label class="flex flex-col gap-1 text-sm text-ink-2">
			{m.feedback_description_label()}
			<textarea
				class="min-h-24 w-full border border-ink-4 bg-transparent p-2 text-ink"
				bind:value={editor.description}
			></textarea>
		</label>
	{/if}
</div>
