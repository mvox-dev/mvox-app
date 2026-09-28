// @vitest-environment happy-dom
//
// #395 slice 2/2 RED — FeedbackView: one feedback, read-only.
//
// CONTRACT (GREEN implements src/lib/components/FeedbackView.svelte, Svelte 5
// runes):
//
//   PROPS  screenshotUrl: string   — the signed url (loadFeedback)
//          strokes: StrokeData     — parsed doodle_layer (loadFeedback)
//          description: string
//          naturalWidth, naturalHeight: number — the screenshot's natural box
//
//   RENDER the screenshot as StrokeSurface's `base` snippet (an <img
//          src={screenshotUrl}>), with StrokeSurface READONLY over it (no
//          controls), and the description text. Both the screenshot and the
//          description go through the capture marker: RedactedText
//          ($lib/components/RedactedText.svelte, #388) wraps the description
//          body, and the <img> sits inside a marked element (a pseudo-element
//          overlay cannot render on a replaced element, redact.ts).
//
// No route yet (#395 slice 2: no route or compose UI — screenshot capture is a
// later issue). The integration here is with the REAL StrokeSurface (not
// mocked): the paths must be byte-identical to StrokeSurface's own for the
// same StrokeData.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { REDACT_ATTR } from '$lib/redact/redact';
import { parse, serialize, type StrokeData } from '$lib/strokes/strokes';

import FeedbackView from './FeedbackView.svelte';
import StrokeSurface from './StrokeSurface.svelte';

const URL_ =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const DESCRIPTION = 'The agenda hides my rehearsal.';

// A parsed fixture — exactly what loadFeedback hands the view.
const STROKES: StrokeData = parse(
	serialize({
		v: 1,
		strokes: [
			{ pen: 'red', w: 0.004, pts: [0.1, 0.1, 0.5, 0.5, 0.9, 0.2] },
			{ pen: 'black', w: 0.004, pts: [0.3, 0.7] }
		]
	})
);

afterEach(() => {
	cleanup();
});

function mount() {
	return render(FeedbackView, {
		props: { screenshotUrl: URL_, strokes: STROKES, description: DESCRIPTION, naturalWidth: 400, naturalHeight: 300 }
	});
}

describe('#395 FeedbackView renders one feedback', () => {
	it('renders the description text inside a capture marker', () => {
		const { container } = mount();
		const marked = [...container.querySelectorAll(`[${REDACT_ATTR}]`)];
		expect(marked.some((el) => el.textContent?.trim() === DESCRIPTION)).toBe(true);
	});

	it('renders an <img> for the screenshot, inside a capture marker', () => {
		const { container } = mount();
		const img = container.querySelector(`img[src="${URL_}"]`);
		expect(img).not.toBeNull();
		expect(img?.closest(`[${REDACT_ATTR}]`)).not.toBeNull();
	});

	it('the StrokeSurface over it is readonly — no pen/erase/undo controls', () => {
		const { container } = mount();
		expect(container.querySelector('svg[data-testid="stroke-surface"]')).not.toBeNull();
		expect(container.querySelectorAll('button')).toHaveLength(0);
	});

	it('the stroke paths are EXACTLY what StrokeSurface renders for the same StrokeData', () => {
		const { container } = mount();
		const viewSvg = container.querySelector('svg[data-testid="stroke-surface"]') as SVGSVGElement;
		expect(viewSvg.querySelectorAll('path')).toHaveLength(2);
		const viewPaths = viewSvg.innerHTML;
		cleanup();

		const base = createRawSnippet(() => ({ render: () => `<img src="${URL_}" alt="">` }));
		const ref = render(StrokeSurface, {
			props: { base, strokes: STROKES, readonly: true, naturalWidth: 400, naturalHeight: 300 }
		});
		const refSvg = ref.container.querySelector('svg[data-testid="stroke-surface"]') as SVGSVGElement;
		expect(viewPaths).toBe(refSvg.innerHTML);
	});
});

// (*MVOX:Tallis*)
