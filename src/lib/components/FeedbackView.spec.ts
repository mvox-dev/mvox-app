// @vitest-environment happy-dom
// FeedbackView shows one feedback read-only: the screenshot under a readonly StrokeSurface
// (real, not mocked) and the description, both inside the capture marker.
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

	// The screenshot is the feedback's content, not decoration: it needs a name.
	it('the screenshot <img> carries the translated alt text', () => {
		const { container } = mount();
		const img = container.querySelector(`img[src="${URL_}"]`);
		expect(img?.getAttribute('alt')).toBe('Screenshot of the page this feedback is about');
	});

	// The strokes span the whole surface box, so the screenshot must fill the same rectangle.
	it('layout guard (happy-dom cannot measure width): the screenshot fills the stroke surface', () => {
		const { container } = mount();
		const img = container.querySelector(`img[src="${URL_}"]`) as HTMLImageElement;
		const classes = img.getAttribute('class')?.split(/\s+/) ?? [];
		expect(classes).toContain('block');
		expect(classes).toContain('w-full');
		const marker = img.closest(`[${REDACT_ATTR}]`) as HTMLElement;
		expect(marker.getAttribute('class')?.split(/\s+/) ?? []).toContain('block');
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
