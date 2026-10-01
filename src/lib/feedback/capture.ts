// The screenshot behind the feedback editor, and its copy to the clipboard.
import { withRedaction } from '$lib/redact/redact';

export interface Capture {
	blob: Blob;
	width: number;
	height: number;
}

export class ClipboardImageUnsupported extends Error {
	constructor() {
		super('this browser cannot put an image on the clipboard');
	}
}

export async function captureScreen(): Promise<Capture> {
	const { domToBlob } = await import('modern-screenshot');
	const width = window.innerWidth;
	const height = window.innerHeight;
	const blob = await withRedaction(() =>
		domToBlob(document.body, {
			width,
			height,
			type: 'image/png',
			scale: window.devicePixelRatio,
			// Pages scroll inside NavShell's main; without this the capture shows its top.
			features: { restoreScrollPosition: true }
		})
	);
	return { blob, width, height };
}

// The item gets the render as a promise so the write stays inside the click: Safari
// refuses a clipboard write that starts after an await.
export function copyInked(stage: HTMLElement, naturalWidth: number): Promise<void> {
	if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
		return Promise.reject(new ClipboardImageUnsupported());
	}
	const scale = stage.clientWidth > 0 ? naturalWidth / stage.clientWidth : 1;
	const png = import('modern-screenshot').then(({ domToBlob }) =>
		domToBlob(stage, { type: 'image/png', scale })
	);
	return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
