// Draws one PDF page into the viewer's canvas: the one canvas file the viewer fence allows.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved -- Vite's `?url` suffix, resolved at build time.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderedPageGeometry {
	cssWidth: number;
	cssHeight: number;
	deviceWidth: number;
	deviceHeight: number;
}

// Past 3x the backing store grows quadratically for detail no eye resolves at a music stand.
const MAX_DEVICE_PIXEL_RATIO = 3;

export interface OpenedPdf {
	numPages: number;
	/** Draws page `pageNumber` (1-based) whole inside the canvas's box. */
	renderPage(pageNumber: number, canvas: HTMLCanvasElement): Promise<RenderedPageGeometry>;
	/** Frees pdf.js's resources only; the blob URL is the caller's to release. */
	destroy(): void;
}

export async function openPdf(src: string): Promise<OpenedPdf> {
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
			const scale =
				Math.min(availableWidth / unscaled.width, availableHeight / unscaled.height) || 1;
			// pdf.js's core render does not scale for the pixel ratio: size the backing store here.
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
