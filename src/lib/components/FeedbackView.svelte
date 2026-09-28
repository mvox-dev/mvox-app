<script lang="ts">
	// #395 slice 2/2 GREEN — FeedbackView: one feedback, read-only. See
	// FeedbackView.spec.ts's header for the full pinned contract.
	//
	// The screenshot renders as StrokeSurface's `base` snippet, with
	// StrokeSurface READONLY over it (no controls). Both the screenshot and
	// the description go through the capture marker (RedactedText, #388): the
	// description body is wrapped directly, and the screenshot's <img> — a
	// replaced element a pseudo-element overlay cannot render on, redact.ts —
	// sits inside its OWN wrapping marked span.
	//
	// No route yet (#395 slice 2: no route or compose UI — screenshot capture
	// is a later issue).
	import type { StrokeData } from '$lib/strokes/strokes';
	import RedactedText from './RedactedText.svelte';
	import StrokeSurface from './StrokeSurface.svelte';

	let {
		screenshotUrl,
		strokes,
		description,
		naturalWidth,
		naturalHeight
	}: {
		screenshotUrl: string;
		strokes: StrokeData;
		description: string;
		naturalWidth: number;
		naturalHeight: number;
	} = $props();
</script>

{#snippet base()}
	<RedactedText>
		<img src={screenshotUrl} alt="" />
	</RedactedText>
{/snippet}

<StrokeSurface {base} {strokes} readonly {naturalWidth} {naturalHeight} />

<RedactedText>{description}</RedactedText>

<!-- (*MVOX:Palestrina* — #395 slice 2/2 GREEN) -->
