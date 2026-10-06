// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { fileId: 'file-score' } as Record<string, string>,
	url: new URL('http://localhost/part/file-score?db=sampledb'),
	state: {} as { partLabel?: PartLabel }
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const { afterNavigateCallbacks } = vi.hoisted(() => ({
	afterNavigateCallbacks: [] as Array<(nav: { type: string }) => void>
}));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({
		afterNavigate: (cb: (nav: { type: string }) => void) => {
			afterNavigateCallbacks.push(cb);
		}
	})
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
const labelWrites = vi.hoisted(
	() => [] as Array<{ identity: unknown; fileId: string; label: unknown }>
);
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({
		putLabel: async (identity: unknown, fileId: string, label: unknown) => {
			labelWrites.push({ identity, fileId, label });
		},
		labelsFor: async () => new Map(),
		remove: async () => {}
	})
}));
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

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
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () =>
	(await import('$lib/testing/mocks/files')).pdfWorkerUrlModule()
);

import Page from './[fileId]/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import { collectiveState } from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import type { PartLabel } from '$lib/files/labelStore';
import { resetAppState } from '$lib/testing/appReset';
import { gotoMock } from '$lib/testing/routeMocks';
import { signFileUrlMock } from '$lib/testing/mocks/files';

let fakeByteStore: FakeByteStore;

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function deadWire(): TypeError {
	return new TypeError('Failed to fetch');
}

function deadFetch() {
	const fetchMock = vi.fn(async () => {
		throw deadWire();
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

// collectives stay loading: the cold offline start
function renderViewer(state: { partLabel?: PartLabel } = {}) {
	pageStub.params = { fileId: 'file-score' };
	pageStub.url = new URL('http://localhost/part/file-score?db=sampledb');
	pageStub.state = state;
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({ status: 'loading' });
	return render(Page);
}

function reportEntry(type: 'enter' | 'goto' | 'link' | 'popstate'): void {
	for (const cb of afterNavigateCallbacks) cb({ type });
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
	afterNavigateCallbacks.length = 0;
	labelWrites.length = 0;
	pageStub.state = {};
	resetAppState();
});

describe('#427 — a held part renders with the network dead (the offline promise)', () => {
	it('opens on page 1 — the indicator reads exactly 1 / 3, pdf.js gets the minted blob: URL, and NOTHING touches the wire', async () => {
		const fetchMock = deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		seedHeldPart();
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();
			await loaded(container);

			expect(indicator(container)).toEqual(INDICATOR_1_OF_3);
			expect(container.querySelector('[data-testid="part-viewer-canvas"]')).not.toBeNull();

			expect(pdfjs.getDocument).toHaveBeenCalledTimes(1);
			const arg = pdfjs.getDocument.mock.calls[0][0];
			const src = typeof arg === 'string' ? arg : (arg as { url?: string }).url;
			expect(String(src)).toMatch(/^blob:/);

			expect(signFileUrlMock).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(fakeByteStore.puts).toEqual([]);
		} finally {
			restore();
		}
	});

	it('releases the minted object URL on unmount — not before', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
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
		signFileUrlMock.mockRejectedValue(deadWire());
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
			await waitFor(() => expect(pdfjs.renderCalls.length).toBe(1));

			await tap(zonePrev(container), 40, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_1_OF_3));
			expect(pdfjs.renderCalls.length).toBe(1);

			await tap(zoneNext(container), 980, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_2_OF_3));
			await waitFor(() => expect(pdfjs.renderCalls.length).toBe(2));
			await tap(zoneNext(container), 980, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_3_OF_3));
			await waitFor(() => expect(pdfjs.renderCalls.length).toBe(3));

			await tap(zoneNext(container), 980, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_3_OF_3));
			expect(pdfjs.renderCalls.length).toBe(3);

			await tap(zonePrev(container), 40, 400);
			await waitFor(() => expect(indicator(container)).toEqual(INDICATOR_2_OF_3));
			await waitFor(() => expect(pdfjs.renderCalls.length).toBe(4));
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
		signFileUrlMock.mockRejectedValue(deadWire());
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

			reportEntry('goto');
			await fireEvent.click(close);
			expect(backSpy).toHaveBeenCalledTimes(1);
			expect(gotoMock).not.toHaveBeenCalled();
		} finally {
			restore();
			backSpy.mockRestore();
		}
	});

	it('entered COLD (a PWA launch or a bookmark, no in-app history): close goes to the agenda instead of walking her out of the app', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		seedHeldPart();
		const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();
			await loaded(container);
			reportEntry('enter');

			const close = container.querySelector('[data-testid="part-viewer-close"]') as HTMLElement;
			await fireEvent.click(close);

			expect(gotoMock.mock.calls).toEqual([['/']]);
			expect(backSpy).not.toHaveBeenCalled();
		} finally {
			restore();
			backSpy.mockRestore();
		}
	});

	it('the not-on-device notice\'s close also lands in the app on a cold entry', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
		try {
			const { container } = renderViewer();
			await waitFor(() => {
				expect(container.querySelector('[data-testid="part-viewer-not-on-device"]')).not.toBeNull();
			});
			reportEntry('enter');

			const close = container.querySelector('[data-testid="part-viewer-close"]') as HTMLElement;
			await fireEvent.click(close);

			expect(gotoMock.mock.calls).toEqual([['/']]);
			expect(backSpy).not.toHaveBeenCalled();
		} finally {
			backSpy.mockRestore();
		}
	});

	it('requestFullscreen IS called on entry where the API exists (Android)', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
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
		signFileUrlMock.mockRejectedValue(deadWire());
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
		signFileUrlMock.mockRejectedValue(deadWire());
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();

			const notice = await waitFor(() => {
				const el = container.querySelector('[data-testid="part-viewer-not-on-device"]');
				expect(el).not.toBeNull();
				return el as HTMLElement;
			});
			expect(notice.textContent?.trim()).toEqual('[part_viewer_not_on_device]');

			expect(container.querySelector('[data-testid="part-viewer-canvas"]')).toBeNull();
			expect(container.querySelector('[data-testid="part-viewer-page-indicator"]')).toBeNull();
			expect(pdfjs.getDocument).not.toHaveBeenCalled();

			const close = container.querySelector('[data-testid="part-viewer-close"]') as HTMLElement;
			expect(close).not.toBeNull();
			expect(close.tagName).toBe('BUTTON');
			expect(close.getAttribute('class')).toBeTruthy();

			expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
		} finally {
			restore();
		}
	});
});

describe('#427 review finding 2 — a COLD entry: identity is derived from the token, never from a network call', () => {
	it('auth still LOADING at mount claims nothing, and the held part renders once auth resolves — collective discovery never answers', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		seedHeldPart();
		const restore = setRequestFullscreen(undefined);
		try {
			pageStub.params = { fileId: 'file-score' };
			pageStub.url = new URL('http://localhost/part/file-score?db=sampledb');
			pageStub.state = {};
			setToken('jwt-abc');
			collectiveState.set({ status: 'loading' });
			authStore.set({ status: 'loading' });

			const { container } = render(Page);

			expect(container.querySelector('[data-testid="part-viewer-not-on-device"]')).toBeNull();
			expect(pdfjs.getDocument).not.toHaveBeenCalled();

			authStore.set({
				status: 'authenticated',
				personIdByDb: { sampledb: 'person-p' },
				expMs: Date.now() + 100_000
			});

			await loaded(container);
			expect(indicator(container)).toEqual(INDICATOR_1_OF_3);
			expect(container.querySelector('[data-testid="part-viewer-not-on-device"]')).toBeNull();
		} finally {
			restore();
		}
	});

	it('with two collectives on the token, ?db= picks the partition the entry link named', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		fakeByteStore.seed({ db: 'otherdb', personId: 'person-o' }, 'file-score', {
			bytes: PDF_BYTES.slice().buffer,
			filetype: 'application/pdf',
			sha256: 'sha-other'
		});
		const restore = setRequestFullscreen(undefined);
		try {
			pageStub.params = { fileId: 'file-score' };
			pageStub.url = new URL('http://localhost/part/file-score?db=otherdb');
			pageStub.state = {};
			setToken('jwt-abc');
			collectiveState.set({ status: 'loading' });
			authStore.set({
				status: 'authenticated',
				personIdByDb: { sampledb: 'person-p', otherdb: 'person-o' },
				expMs: Date.now() + 100_000
			});

			const { container } = render(Page);
			await loaded(container);
			expect(indicator(container)).toEqual(INDICATOR_1_OF_3);
		} finally {
			restore();
		}
	});
});

describe('#427 review finding 3 — the part LABEL the entry page handed down', () => {
	it('a delivery that landed bytes records the label, with the identity the bytes were read under — full shape', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		seedHeldPart();
		const restore = setRequestFullscreen(undefined);
		const label: PartLabel = {
			work: 'Spem in alium',
			composer: 'Thomas Tallis',
			edition: 'Vocal score',
			filename: 'SOPRAN.pdf'
		};
		try {
			const { container } = renderViewer({ partLabel: label });
			await loaded(container);

			await waitFor(() => expect(labelWrites).toHaveLength(1));
			expect(labelWrites).toEqual([
				{ identity: { db: 'sampledb', personId: 'person-p' }, fileId: 'file-score', label }
			]);
		} finally {
			restore();
		}
	});

	it('no label handed down (a reload, a bookmark) writes nothing — a label is never invented from a fileId', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		seedHeldPart();
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();
			await loaded(container);
			expect(labelWrites).toEqual([]);
		} finally {
			restore();
		}
	});
});

describe('#427 review finding 4 — a DEGRADED delivery must not dead-end', () => {
	it('a byte fetch blocked by CORS hands the SIGNED url to the browser — pdf.js is never fed it, and no false not-on-device notice appears', async () => {
		const fetchMock = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', fetchMock);
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();

			await waitFor(() => expect(window.location.href).toBe('https://s3.example/signed-1'));
			expect(pdfjs.getDocument).not.toHaveBeenCalled();
			expect(container.querySelector('[data-testid="part-viewer-not-on-device"]')).toBeNull();
			expect(labelWrites).toEqual([]);
		} finally {
			restore();
		}
	});
});

describe('#427 review round 2, finding 2 — a REFUSED delivery is not a claim about her device', () => {
	it('signing that answers 500 shows the open-failure notice, never "not saved on this device"', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('the byte GET is never reached');
		});
		vi.stubGlobal('fetch', fetchMock);
		const refused = new Error('signFileUrl: file file-score signing failed: 500');
		signFileUrlMock.mockRejectedValue(refused);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();

			const notice = await waitFor(() => {
				const el = container.querySelector('[data-testid="part-viewer-open-failed"]');
				expect(el).not.toBeNull();
				return el as HTMLElement;
			});
			expect(notice.textContent?.trim()).toEqual('[repertoire_pdf_error]');
			expect(container.querySelector('[data-testid="part-viewer-not-on-device"]')).toBeNull();
			expect(pdfjs.getDocument).not.toHaveBeenCalled();

			const close = container.querySelector('[data-testid="part-viewer-close"]') as HTMLElement;
			expect(close).not.toBeNull();
			expect(close.tagName).toBe('BUTTON');
			expect(close.getAttribute('class')).toBeTruthy();
			expect(consoleSpy).toHaveBeenCalledWith('part: delivering the part failed', refused);
		} finally {
			consoleSpy.mockRestore();
			restore();
		}
	});

	it('a byte GET the bucket answers 403 shows the same open-failure notice', async () => {
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		const fetchMock = vi.fn(
			async () =>
				({
					ok: false,
					status: 403,
					headers: new Headers(),
					arrayBuffer: async () => new ArrayBuffer(0)
				}) as unknown as Response
		);
		vi.stubGlobal('fetch', fetchMock);
		const restore = setRequestFullscreen(undefined);
		const hrefBefore = window.location.href;
		try {
			const { container } = renderViewer();

			await waitFor(() => {
				expect(container.querySelector('[data-testid="part-viewer-open-failed"]')).not.toBeNull();
			});
			expect(container.querySelector('[data-testid="part-viewer-not-on-device"]')).toBeNull();
			expect(pdfjs.getDocument).not.toHaveBeenCalled();
			expect(window.location.href).toBe(hrefBefore);
			expect(fakeByteStore.puts).toEqual([]);
		} finally {
			restore();
		}
	});

	it('a dead wire with no stored copy still reads as not-on-device — the two are never collapsed', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();

			await waitFor(() => {
				expect(container.querySelector('[data-testid="part-viewer-not-on-device"]')).not.toBeNull();
			});
			expect(container.querySelector('[data-testid="part-viewer-open-failed"]')).toBeNull();
			// Offline is the not-on-device answer, not a failed delivery: nothing is reported.
			expect(consoleSpy).not.toHaveBeenCalledWith(
				'part: delivering the part failed',
				expect.anything()
			);
		} finally {
			consoleSpy.mockRestore();
			restore();
		}
	});

	it('held bytes pdf.js cannot open are reported and show the open-failure notice (#756)', async () => {
		deadFetch();
		signFileUrlMock.mockRejectedValue(deadWire());
		seedHeldPart();
		const broken = new Error('Invalid PDF structure');
		pdfjs.getDocument.mockReturnValueOnce({
			promise: Promise.reject(broken),
			destroy: pdfjs.destroy
		} as never);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const restore = setRequestFullscreen(undefined);
		try {
			const { container } = renderViewer();
			await waitFor(() => {
				expect(container.querySelector('[data-testid="part-viewer-open-failed"]')).not.toBeNull();
			});
			expect(consoleSpy).toHaveBeenCalledWith('part: opening the part failed', broken);
		} finally {
			consoleSpy.mockRestore();
			restore();
		}
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
