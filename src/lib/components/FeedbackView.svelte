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
	// REVIEW ROUND (#395, F3): the base must FILL StrokeSurface's box. That box
	// is sized only by `aspect-ratio: naturalWidth / naturalHeight` and the ink
	// SVG spans all of it (`inset: 0; width: 100%; height: 100%`), so a bare
	// inline <img> — Tailwind preflight gives it `max-width: 100%; height:
	// auto` — stops at its intrinsic width whenever that is narrower than the
	// container, and every stroke lands offset from the pixels it annotates.
	// `block w-full` on the <img> and `block` on its marker span make the two
	// layers the same rectangle. Do not drop these classes.
	//
	// No route yet (#395 slice 2: no route or compose UI — screenshot capture
	// is a later issue).
	import { m } from '$lib/paraglide/messages.js';
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
	<RedactedText class="block">
		<img src={screenshotUrl} alt={m.feedback_screenshot_alt()} class="block w-full" />
	</RedactedText>
{/snippet}

<StrokeSurface {base} {strokes} readonly {naturalWidth} {naturalHeight} />

<RedactedText>{description}</RedactedText>

<!-- (*MVOX:Palestrina* — #395 slice 2/2 GREEN) -->
