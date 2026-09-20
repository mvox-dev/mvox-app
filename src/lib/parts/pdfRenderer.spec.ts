// @vitest-environment happy-dom
//
// #427 review round 3, findings 1 and 6 — the renderer rasterises in DEVICE
// pixels and states the geometry it rendered at.
//
// pdf.js is mocked at the module seam (the same substitution the route spec
// makes): the real library is a multi-MB renderer with a worker, and none of
// it runs under happy-dom. `getViewport({ scale })` here returns a viewport
// whose size scales linearly from a 600x800 page, which is exactly the
// relation the wrapper's fit maths depends on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => {
	const renderCalls: Array<{ canvas: unknown; viewport: { width: number; height: number } }> = [];
	const getDocument = vi.fn(() => ({
		promise: Promise.resolve({
			numPages: 1,
			getPage: async () => ({
				getViewport: ({ scale }: { scale: number }) => ({
					width: 600 * scale,
					height: 800 * scale,
					scale
				}),
				render: (args: { canvas: unknown; viewport: { width: number; height: number } }) => {
					renderCalls.push(args);
					return { promise: Promise.resolve(), cancel: vi.fn() };
				}
			})
		}),
		destroy: vi.fn()
	}));
	return { getDocument, renderCalls };
});
vi.mock('pdfjs-dist', () => ({
	GlobalWorkerOptions: { workerSrc: '' },
	getDocument: pdfjs.getDocument
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/mock-pdf-worker.mjs' }));

import { openPdf } from './pdfRenderer';

/** A canvas inside a box of a KNOWN layout size: happy-dom reports 0 for
 *  clientWidth/clientHeight, and the wrapper's fit reads the parent box. */
function canvasInBox(boxWidth: number, boxHeight: number): HTMLCanvasElement {
	const box = document.createElement('div');
	Object.defineProperty(box, 'clientWidth', { value: boxWidth, configurable: true });
	Object.defineProperty(box, 'clientHeight', { value: boxHeight, configurable: true });
	const canvas = document.createElement('canvas');
	box.appendChild(canvas);
	document.body.appendChild(box);
	return canvas;
}

beforeEach(() => {
	pdfjs.renderCalls.length = 0;
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('#427 — the page is rasterised at the DEVICE pixel ratio, not the CSS one', () => {
	it('dpr 2: the backing store is 2x the fit size, the CSS box stays the fit size, and the render viewport matches the backing store', async () => {
		vi.stubGlobal('devicePixelRatio', 2);
		const canvas = canvasInBox(600, 800);

		const pdf = await openPdf('blob:mvox/score');
		const geometry = await pdf.renderPage(1, canvas);

		expect(geometry).toEqual({
			cssWidth: 600,
			cssHeight: 800,
			deviceWidth: 1200,
			deviceHeight: 1600
		});
		expect(canvas.width).toBe(1200);
		expect(canvas.height).toBe(1600);
		expect(canvas.style.width).toBe('600px');
		expect(canvas.style.height).toBe('800px');
		expect(pdfjs.renderCalls).toHaveLength(1);
		expect(pdfjs.renderCalls[0].canvas).toBe(canvas);
		expect(pdfjs.renderCalls[0].viewport.width).toBe(1200);
		expect(pdfjs.renderCalls[0].viewport.height).toBe(1600);
	});

	it('dpr 1 (a plain desktop display): backing store and CSS box are the same size — the pre-existing behaviour, unchanged', async () => {
		vi.stubGlobal('devicePixelRatio', 1);
		const canvas = canvasInBox(600, 800);

		const pdf = await openPdf('blob:mvox/score');
		const geometry = await pdf.renderPage(1, canvas);

		expect(geometry).toEqual({
			cssWidth: 600,
			cssHeight: 800,
			deviceWidth: 600,
			deviceHeight: 800
		});
		expect(canvas.width).toBe(600);
		expect(canvas.style.width).toBe('600px');
	});

	// The ceiling is real memory on the device this runs on: past 3x the
	// backing store grows quadratically for detail no eye resolves at a stand.
	it('dpr 4 is capped at 3 — the backing store never grows past the ceiling', async () => {
		vi.stubGlobal('devicePixelRatio', 4);
		const canvas = canvasInBox(600, 800);

		const pdf = await openPdf('blob:mvox/score');
		const geometry = await pdf.renderPage(1, canvas);

		expect(geometry).toEqual({
			cssWidth: 600,
			cssHeight: 800,
			deviceWidth: 1800,
			deviceHeight: 2400
		});
		expect(canvas.width).toBe(1800);
		expect(canvas.style.width).toBe('600px');
	});

	it('no devicePixelRatio at all (a headless/legacy engine) falls back to 1 rather than NaN', async () => {
		vi.stubGlobal('devicePixelRatio', undefined);
		const canvas = canvasInBox(600, 800);

		const pdf = await openPdf('blob:mvox/score');
		const geometry = await pdf.renderPage(1, canvas);

		expect(geometry).toEqual({
			cssWidth: 600,
			cssHeight: 800,
			deviceWidth: 600,
			deviceHeight: 800
		});
	});

	// FIT, not crop: a portrait page in a landscape box is bounded by the
	// SHORTER axis, and the dpr multiplies that fit rather than replacing it.
	it('a landscape box still fits the whole portrait page, then scales by dpr', async () => {
		vi.stubGlobal('devicePixelRatio', 2);
		const canvas = canvasInBox(1200, 400);

		const pdf = await openPdf('blob:mvox/score');
		const geometry = await pdf.renderPage(1, canvas);

		// scale = min(1200/600, 400/800) = 0.5 → css 300x400, device 600x800.
		expect(geometry).toEqual({
			cssWidth: 300,
			cssHeight: 400,
			deviceWidth: 600,
			deviceHeight: 800
		});
		expect(canvas.style.width).toBe('300px');
		expect(canvas.style.height).toBe('400px');
	});
});

// (*MVOX:Josquin*)
