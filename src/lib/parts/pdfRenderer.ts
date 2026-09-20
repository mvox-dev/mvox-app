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

export interface OpenedPdf {
	numPages: number;
	/** Renders ONE page (1-based) into `canvas`, the whole page contained
	 *  inside the canvas's current CSS box (fit, not crop — the page never
	 *  spills past the viewport). */
	renderPage(pageNumber: number, canvas: HTMLCanvasElement): Promise<void>;
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
			const viewport = page.getViewport({ scale });
			canvas.width = Math.round(viewport.width);
			canvas.height = Math.round(viewport.height);
			await page.render({ canvas, viewport }).promise;
		},
		destroy() {
			void loadingTask.destroy();
		}
	};
}

// (*MVOX:Byrd*)
