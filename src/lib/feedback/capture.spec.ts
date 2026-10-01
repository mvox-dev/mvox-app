// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';

const { domToBlobMock } = vi.hoisted(() => ({ domToBlobMock: vi.fn() }));
vi.mock('modern-screenshot', () => ({ domToBlob: domToBlobMock }));

import { captureScreen, copyInked, ClipboardImageUnsupported } from './capture';

const PNG = new Blob(['png'], { type: 'image/png' });

function markedPage(): HTMLElement[] {
	document.body.innerHTML = `
		<p>Plain <span ${REDACT_ATTR}>Mari Maasikas</span></p>
		<div><span ${REDACT_ATTR}>+372 5555 5555</span><span ${REDACT_ATTR}>mari@example.ee</span></div>`;
	return Array.from(document.querySelectorAll<HTMLElement>(`[${REDACT_ATTR}]`));
}

function engagedAtCapture(marked: HTMLElement[]): boolean[] {
	return marked.map((el) => el.matches(`html[${REDACT_TOGGLE_ATTR}] [${REDACT_ATTR}]`));
}

afterEach(() => {
	vi.unstubAllGlobals();
	domToBlobMock.mockReset();
	document.documentElement.removeAttribute(REDACT_TOGGLE_ATTR);
	document.body.innerHTML = '';
});

describe('captureScreen', () => {
	it('the marker is engaged on every marked element at the moment of capture', async () => {
		const marked = markedPage();
		let seen: boolean[] = [];
		domToBlobMock.mockImplementation(async () => {
			seen = engagedAtCapture(marked);
			return PNG;
		});

		const shot = await captureScreen();

		expect(seen).toEqual([true, true, true]);
		expect(shot).toEqual({ blob: PNG, width: window.innerWidth, height: window.innerHeight });
		expect(domToBlobMock).toHaveBeenCalledWith(
			document.body,
			expect.objectContaining({ width: window.innerWidth, height: window.innerHeight })
		);
	});

	it('releases the marker after the capture, and after a failed one', async () => {
		markedPage();
		domToBlobMock.mockResolvedValueOnce(PNG);
		await captureScreen();
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(false);

		domToBlobMock.mockRejectedValueOnce(new Error('render failed'));
		await expect(captureScreen()).rejects.toThrow('render failed');
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(false);
	});

	it('leaves a marker someone set by hand engaged', async () => {
		document.documentElement.setAttribute(REDACT_TOGGLE_ATTR, '');
		domToBlobMock.mockResolvedValueOnce(PNG);
		await captureScreen();
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(true);
	});
});

describe('copyInked', () => {
	class FakeClipboardItem {
		constructor(readonly items: Record<string, Promise<Blob>>) {}
	}

	it('writes one image/png ClipboardItem rendered from the stage, at the natural width', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('ClipboardItem', FakeClipboardItem);
		vi.stubGlobal('navigator', { clipboard: { write } });
		domToBlobMock.mockResolvedValue(PNG);
		const stage = document.createElement('div');
		Object.defineProperty(stage, 'clientWidth', { value: 400 });

		await copyInked(stage, 800);

		expect(write).toHaveBeenCalledTimes(1);
		const [items] = write.mock.calls[0] as [FakeClipboardItem[]];
		expect(items).toHaveLength(1);
		expect(Object.keys(items[0].items)).toEqual(['image/png']);
		await expect(items[0].items['image/png']).resolves.toBe(PNG);
		expect(domToBlobMock).toHaveBeenCalledWith(stage, { type: 'image/png', scale: 2 });
	});

	it('fails loudly where the browser has no ClipboardItem', async () => {
		vi.stubGlobal('ClipboardItem', undefined);
		vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
		await expect(copyInked(document.createElement('div'), 800)).rejects.toBeInstanceOf(
			ClipboardImageUnsupported
		);
	});
});
