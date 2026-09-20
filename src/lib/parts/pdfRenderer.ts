// #427 — if any file in the viewer module tree ever needs a raw 2d canvas
// context, it is THIS one (src/part-viewer-fence.spec.ts pins getContext to
// at most one file, this path specifically) — pdf.js's own recommended API
// (page.render({ canvas, viewport })) takes the <canvas> element directly and
// manages the context itself, so nothing here calls getContext today either.
// Nothing in this tree draws a stroke of its own — the "nothing drawn" half
// of the fence is a fact about what this file DOESN'T do, not what it does.
//
// The worker ships as a static asset via Vite's `?url` import (a hashed
// build artefact vite emits alongside the chunk, not bundled inline) and is
// precached by the service worker (src/service-worker.ts,
// src/lib/sw/swPolicy.part-viewer.spec.ts) so a cold offline start can still
// boot the renderer.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved -- Vite's `?url` suffix, resolved at build time.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * The one statement of the CSS-px ↔ device-px relation (#427 review round 3,
 * finding 6). #333's ink overlay has to map a pointer position (CSS px) onto
 * the rasterised page (device px); returning both here means the overlay
 * reads the geometry instead of recomputing the fit and the pixel ratio for
 * itself and drifting.
 */
export interface RenderedPageGeometry {
	/** Layout box of the canvas — what `canvas.style.width/height` carry. */
	cssWidth: number;
	cssHeight: number;
	/** Backing store — what `canvas.width/height` carry: css × dpr. */
	deviceWidth: number;
	deviceHeight: number;
}

/**
 * Ceiling on `devicePixelRatio`. A 3x phone already rasterises a fitted A4
 * page at roughly 3.7 MP; past that the backing store grows quadratically
 * for detail no eye resolves at a music stand, and the memory is real on the
 * device this runs on.
 */
const MAX_DEVICE_PIXEL_RATIO = 3;

export interface OpenedPdf {
	numPages: number;
	/** Renders ONE page (1-based) into `canvas`, the whole page contained
	 *  inside the canvas's current CSS box (fit, not crop — the page never
	 *  spills past the viewport). Returns the geometry it rendered at. */
	renderPage(pageNumber: number, canvas: HTMLCanvasElement): Promise<RenderedPageGeometry>;
	/** Releases pdf.js's own worker/document resources. Does NOT touch the
	 *  byte-store object URL — that is the caller's (`openFileBytes`'
	 *  `release()`) to dispose of. */
	destroy(): void;
}

/**
 * Loads a PDF from `src` (a `blob:` object URL on the offline-hit path, or a
 * signed URL on a fallback) and returns a handle that renders one page at a
 * time. No page is rendered until `renderPage` is called.
 */
export async function openPdf(src: string): Promise<OpenedPdf> {
	// `destroy()` lives on the LOADING TASK (getDocument's synchronous return
	// value), not on the resolved `PDFDocumentProxy` — pdf.js's own asymmetry,
	// so the reference is kept from here rather than off `doc`.
	const loadingTask = getDocument({ url: src });
	const doc: PDFDocumentProxy = await loadingTask.promise;
	return {
		numPages: doc.numPages,
		async renderPage(pageNumber, canvas) {
			const page = await doc.getPage(pageNumber);
			const box = canvas.parentElement;
			const availableWidth = box?.clientWidth || canvas.clientWidth || 1;
			const availableHeight = box?.clientHeight || canvas.clientHeight || 1;
			const unscaled = page.getViewport({ scale: 1 });
			// `contain`: the larger of the two axis ratios would overflow, so
			// the smaller one is the whole-page-fits scale.
			const scale =
				Math.min(availableWidth / unscaled.width, availableHeight / unscaled.height) || 1;
			// DEVICE PIXELS (#427 review round 3, finding 1). `page.render` does
			// not scale for `devicePixelRatio` itself — pdf.js applies an output
			// scale only in its own bundled viewer components, never in the core
			// render call this wrapper makes. Sizing the backing store in CSS px
			// therefore rasterised the score at a third of a 3x phone's real
			// resolution and let the compositor upscale it: soft staff lines and
			// lyrics on the one surface that exists to be read. The backing store
			// is device px, the CSS box is pinned to the fit size so layout is
			// unchanged, and the render viewport matches the backing store.
			const dpr = Math.min(globalThis.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
			const cssViewport = page.getViewport({ scale });
			const viewport = page.getViewport({ scale: scale * dpr });
			const geometry: RenderedPageGeometry = {
				cssWidth: Math.round(cssViewport.width),
				cssHeight: Math.round(cssViewport.height),
				deviceWidth: Math.round(viewport.width),
				deviceHeight: Math.round(viewport.height)
			};
			canvas.width = geometry.deviceWidth;
			canvas.height = geometry.deviceHeight;
			canvas.style.width = `${geometry.cssWidth}px`;
			canvas.style.height = `${geometry.cssHeight}px`;
			await page.render({ canvas, viewport }).promise;
			return geometry;
		},
		destroy() {
			void loadingTask.destroy();
		}
	};
}

// (*MVOX:Byrd*)
