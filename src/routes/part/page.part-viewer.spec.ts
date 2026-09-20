// @vitest-environment happy-dom
//
// #427 RED — A singer reads her part fullscreen, offline.
//
// The viewer is a full-viewport in-app route, /part/[fileId] (100dvh, edge to
// edge, dark paper-black surround, no nav shell — allowlisted in
// src/page-shell.spec.ts with its reason). "Fullscreen" is the ROUTE: where
// Element.requestFullscreen exists (Android) it is called on entry as an
// enhancement; where it does not (iOS Safari has no Fullscreen API) the
// route alone is the fullscreen and nothing is called.
//
// DATA PATH: the route reads bytes through the EXISTING openFileBytes
// read-through (src/lib/files/openFileBytes.ts) under the identity resolved
// from the ?db= query param against the collectives the session already
// holds — a cache hit touches no network (the offline promise), a miss
// online signs + fetches + stores (that write is #334's existing behaviour,
// not this slice's). pdf.js renders ONE page at a time to a <canvas>, whole
// page contained in the viewport.
//
// PAGE TURNS (Mihkel's ruling on #333): TAPS on two invisible zones — the
// left and right ~25% of the viewport, full height — turn pages; a tap is
// pointerdown→pointerup within 300 ms and under 10 px of movement. Any
// gesture that moves further is NOT a page turn (native scroll/pinch stay
// available; swiping never turns a page). ArrowRight/ArrowLeft and
// PageDown/PageUp turn too (a11y). The 'n / N' indicator is Inter, plain.
//
// NOTHING DRAWN, NOTHING STORED: the structural half of that fence lives in
// src/part-viewer-fence.spec.ts; here the behavioural half — the viewer only
// READS (a dead network plus a held file is a working viewer; a dead network
// plus a missing file is a plain notice, no retry loop).
//
// HOUSE SUBSTITUTIONS (the #343 page-spec posture): the REAL route component
// renders; only the platform seams are doubled — the byte store
// ($lib/files/appByteStore → createFakeByteStore), signFileUrl, global fetch
// (stubbed per test, networkGuard forbids the real wire), and pdf.js itself
// (module-mocked: getDocument → numPages/getPage/render — no real renderer
// runs under happy-dom).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const pageStub = vi.hoisted(() => ({
	params: { fileId: 'file-score' } as Record<string, string>,
	url: new URL('http://localhost/part/file-score?db=sampledb')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const { gotoMock, signFileUrlMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	signFileUrlMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
// $lib/collectives/store pulls in discover.ts -> marker.ts -> entu/request.ts
// -> entu-config.ts's `$env/dynamic/public` read, which the vitest node
// environment has no value for — same seam the event/library page specs
// substitute for the same transitive reason.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

// pdf.js, mocked at the module seam: the real library is a multi-MB renderer
// with a worker — none of that runs here. The mock mirrors the real API
// shape (getDocument(src) → the LOADING TASK, synchronously, with its own
// destroy() — the resolved `.promise` value is the PDFDocumentProxy, which
// carries getPage/numPages but, in the real library, no destroy of its own;
// page.render → { promise }) so the route exercises its real call sites.
const pdfjs = vi.hoisted(() => {
	const destroy = vi.fn();
	const renderCalls: unknown[] = [];
	const getDocument = vi.fn((_src: unknown) => ({
		promise: Promise.resolve({
			numPages: 3,
			getPage: async (_n: number) => ({
				getViewport: ({ scale }: { scale: number }) => ({
					width: 600 * scale,
					height: 800 * scale,
					scale
				}),
				render: (args: unknown) => {
					renderCalls.push(args);
					return { promise: Promise.resolve(), cancel: vi.fn() };
				}
			})
		}),
		destroy
	}));
	return { getDocument, destroy, renderCalls };
});
vi.mock('pdfjs-dist', () => ({
	GlobalWorkerOptions: { workerSrc: '' },
	getDocument: pdfjs.getDocument
}));
// The worker ships as a static asset via Vite's ?url import (precached by
// the SW — see swPolicy.spec.ts). Mocked so no worker file need exist here.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/mock-pdf-worker.mjs' }));

import Page from './[fileId]/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

/** Every test runs with the WIRE DEAD unless it says otherwise: the offline
 *  promise is the point, so network unreachability is the default, not the
 *  exception. */
function deadFetch() {
	const fetchMock = vi.fn(async () => {
		throw new TypeError('Failed to fetch');
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function seedHeldPart(): void {
	fakeByteStore.seed({ db: 'sampledb', personId: 'person-p' }, 'file-score', {
		bytes: PDF_BYTES.slice().buffer,
		filetype: 'application/pdf',
		sha256: 'sha-fixture'
	});
}

function renderViewer() {
	pageStub.params = { fileId: 'file-score' };
	pageStub.url = new URL('http://localhost/part/file-score?db=sampledb');
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
	return render(Page);
}

const INDICATOR_1_OF_3 = '[part_viewer_page_of {"current":1,"total":3}]';
const INDICATOR_2_OF_3 = '[part_viewer_page_of {"current":2,"total":3}]';
const INDICATOR_3_OF_3 = '[part_viewer_page_of {"current":3,"total":3}]';

function indicator(container: HTMLElement): string {
	return (
		container.querySelector('[data-testid="part-viewer-page-indicator"]')?.textContent?.trim() ??
		''
	);
}

async function loaded(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="part-viewer-page-indicator"]')).not.toBeNull();
	});
}

/** A TAP: pointerdown→pointerup, same spot, no dwell — the gesture that
 *  turns a page. */
async function tap(zone: Element, x: number, y: number): Promise<void> {
	await fireEvent.pointerDown(zone, {
		pointerId: 1,
		pointerType: 'touch',
		isPrimary: true,
		clientX: x,
		clientY: y
	});
	await fireEvent.pointerUp(zone, {
		pointerId: 1,
		pointerType: 'touch',
		isPrimary: true,
		clientX: x,
		clientY: y
	});
}

function zoneNext(container: HTMLElement): Element {
	return container.querySelector('[data-testid="part-viewer-tap-next"]') as Element;
}

function zonePrev(container: HTMLElement): Element {
	return container.querySelector('[data-testid="part-viewer-tap-prev"]') as Element;
}

type FullscreenProto = { requestFullscreen?: () => Promise<void> };

/** Install (or remove) Element.requestFullscreen for one test; returns the
 *  restore handle. happy-dom may or may not ship one — the descriptor is
 *  saved either way. */
function setRequestFullscreen(impl: (() => Promise<void>) | undefined): () => void {
	const proto = Element.prototype as unknown as FullscreenProto;
	const original = Object.getOwnPropertyDescriptor(Element.prototype, 'requestFullscreen');
	if (impl) proto.requestFullscreen = impl;
	else delete proto.requestFullscreen;
	return () => {
		if (original) Object.defineProperty(Element.prototype, 'requestFullscreen', original);
		else delete proto.requestFullscreen;
	};
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	pdfjs.getDocument.mockClear();
	pdfjs.destroy.mockClear();
	pdfjs.renderCalls.length = 0;
	gotoMock.mockReset();
	signFileUrlMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#427 — a held part renders with the network dead (the offline promise)', () => {
	it('opens on page 1 — the indicator reads exactly 1 / 3, pdf.js gets the minted blob: URL, and NOTHING touches the wire', async () => {
		const fetchMock = deadFetch();
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		seedHeldPart();
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();
			await loaded(container);

			// Full shape on the indicator text — page 1 of 3, nothing else.
			expect(indicator(container)).toEqual(INDICATOR_1_OF_3);
			expect(container.querySelector('[data-testid="part-viewer-canvas"]')).not.toBeNull();

			// pdf.js was fed the object URL openFileBytes minted from the store.
			expect(pdfjs.getDocument).toHaveBeenCalledTimes(1);
			const arg = pdfjs.getDocument.mock.calls[0][0];
			const src = typeof arg === 'string' ? arg : (arg as { url?: string }).url;
			expect(String(src)).toMatch(/^blob:/);

			// The offline promise, pinned: no signing, no fetch, no store write.
			expect(signFileUrlMock).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(fakeByteStore.puts).toEqual([]);
		} finally {
			restore();
		}
	});

	it('releases the minted object URL on unmount — not before', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		seedHeldPart();
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
		const restore = setRequestFullscreen(undefined);
		try {
			const { container, unmount } = renderViewer();
			await loaded(container);

			const arg = pdfjs.getDocument.mock.calls[0][0];
			const src = String(typeof arg === 'string' ? arg : (arg as { url?: string }).url);
			expect(revokeSpy.mock.calls.map((c) => c[0])).not.toContain(src);

			unmount();

			expect(revokeSpy.mock.calls.map((c) => c[0])).toContain(src);
		} finally {
			restore();
			revokeSpy.mockRestore();
		}
	});
});

describe('#427 — page turns: corner taps, never swipes (Mihkel\'s ruling on #333)', () => {
	async function renderLoaded(): Promise<HTMLElement> {
		deadFetch();
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		seedHeldPart();
		const { container } = renderViewer();
		await loaded(container);
		return container;
	}

	it('a tap in the right zone advances, in the left zone goes back — and never past either bound', async () => {
		const restore = setRequestFullscreen(undefined);
		try {
			const container = await renderLoaded();
			expect(indicator(container)).toEqual(INDICATOR_1_OF_3);

			// Left bound holds: page 1 stays page 1.
			await tap(zonePrev(container), 40, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_1_OF_3));

			await tap(zoneNext(container), 980, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_2_OF_3));
			await tap(zoneNext(container), 980, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_3_OF_3));

			// Right bound holds: page 3 stays page 3.
			await tap(zoneNext(container), 980, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_3_OF_3));

			await tap(zonePrev(container), 40, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_2_OF_3));
		} finally {
			restore();
		}
	});

	it('a pointer sequence with 40 px of movement is NOT a tap — no page turns (swiping never pages)', async () => {
		const restore = setRequestFullscreen(undefined);
		try {
			const container = await renderLoaded();
			const zone = zoneNext(container);

			await fireEvent.pointerDown(zone, {
				pointerId: 1,
				pointerType: 'touch',
				isPrimary: true,
				clientX: 980,
				clientY: 400
			});
			await fireEvent.pointerMove(zone, {
				pointerId: 1,
				pointerType: 'touch',
				isPrimary: true,
				clientX: 955,
				clientY: 400
			});
			await fireEvent.pointerUp(zone, {
				pointerId: 1,
				pointerType: 'touch',
				isPrimary: true,
				clientX: 940,
				clientY: 400
			});

			expect(indicator(container)).toEqual(INDICATOR_1_OF_3);

			// Sanity in the same DOM: a clean tap right after still turns.
			await tap(zone, 980, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_2_OF_3));
		} finally {
			restore();
		}
	});

	it('ArrowRight/PageDown advance, ArrowLeft/PageUp go back (a11y — keyboards page too)', async () => {
		const restore = setRequestFullscreen(undefined);
		try {
			const container = await renderLoaded();

			await fireEvent.keyDown(window, { key: 'ArrowRight' });
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_2_OF_3));
			await fireEvent.keyDown(window, { key: 'ArrowLeft' });
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_1_OF_3));
			await fireEvent.keyDown(window, { key: 'PageDown' });
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_2_OF_3));
			await fireEvent.keyDown(window, { key: 'PageUp' });
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_1_OF_3));
		} finally {
			restore();
		}
	});
});

describe('#427 — close and fullscreen', () => {
	it('the close control is a NATIVE, CLASSED <button> (#335) labelled part_viewer_close, and clicking it goes BACK in history', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		seedHeldPart();
		const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();
			await loaded(container);

			const close = container.querySelector('[data-testid="part-viewer-close"]') as HTMLElement;
			expect(close).not.toBeNull();
			expect(close.tagName).toBe('BUTTON');
			expect(close.getAttribute('class'), 'native controls carry class= (#335)').toBeTruthy();
			expect(close.textContent?.trim()).toEqual('[part_viewer_close]');

			await fireEvent.click(close);
			expect(backSpy).toHaveBeenCalledTimes(1);
		} finally {
			restore();
			backSpy.mockRestore();
		}
	});

	it('requestFullscreen IS called on entry where the API exists (Android)', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		seedHeldPart();
		const rfs = vi.fn(async () => {});
		const restore = setRequestFullscreen(rfs);
		try {
			const { container } = renderViewer();
			await loaded(container);
			await waitFor(() => expect(rfs).toHaveBeenCalled());
		} finally {
			restore();
		}
	});

	it('where the API is ABSENT (iOS) nothing breaks — the route itself is the fullscreen', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		seedHeldPart();
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();
			await loaded(container);
			expect(indicator(container)).toEqual(INDICATOR_1_OF_3);
		} finally {
			restore();
		}
	});
});

describe('#427 — a part NOT on the device, with no network', () => {
	it('renders the plain not-on-device notice and a close button — no page, no retry loop', async () => {
		const fetchMock = deadFetch();
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		// Store deliberately empty: the file was never opened at home.
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();

			const notice = await waitFor(() => {
				const el = container.querySelector('[data-testid="part-viewer-not-on-device"]');
				expect(el).not.toBeNull();
				return el as HTMLElement;
			});
			expect(notice.textContent?.trim()).toEqual('[part_viewer_not_on_device]');

			// No page and no renderer: nothing to show is nothing shown.
			expect(container.querySelector('[data-testid="part-viewer-canvas"]')).toBeNull();
			expect(container.querySelector('[data-testid="part-viewer-page-indicator"]')).toBeNull();
			expect(pdfjs.getDocument).not.toHaveBeenCalled();

			// The way out is the same close button, classed and native.
			const close = container.querySelector('[data-testid="part-viewer-close"]') as HTMLElement;
			expect(close).not.toBeNull();
			expect(close.tagName).toBe('BUTTON');
			expect(close.getAttribute('class')).toBeTruthy();

			// No retry loop: one open attempt, and the dead wire was tried at
			// most once by the read-through itself.
			expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
		} finally {
			restore();
		}
	});
});

// (*MVOX:Tallis* — #427 RED)
