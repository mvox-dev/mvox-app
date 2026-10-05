// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';

const { sendMock } =
	vi.hoisted(() => ({
		sendMock: vi.fn()
	}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/roster'), params: {} }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$lib/profile/completionGate', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).completionGateModule(importOriginal)
);
vi.mock('$lib/collective/membershipStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).membershipModule(importOriginal)
);
vi.mock('modern-screenshot', async () =>
	(await import('$lib/testing/mocks/files')).screenshotModule()
);
vi.mock('$lib/feedback/sendFeedback', () => ({
	sendFeedback: sendMock,
	startSendingSavedFeedback: () => () => {}
}));

import Layout from './+layout.svelte';
import { resetGate } from '$lib/profile/completionGate';
import { resetMembership } from '$lib/collective/membershipStore';
import { resetAppState } from '$lib/testing/appReset';
import { SAMPLEDB, signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';
import { domToBlobMock } from '$lib/testing/mocks/files';
import { resolveGateMock, resolveMembershipMock } from '$lib/testing/mocks/session';

const PNG = new Blob(['png'], { type: 'image/png' });

const children = createRawSnippet(() => ({
	render: () => `<section data-testid="page">
		<p data-testid="plain">Roster of <span ${REDACT_ATTR}>Mari Maasikas</span></p>
		<span ${REDACT_ATTR}>mari@example.ee</span>
		<button type="button" data-testid="page-button">Save</button>
	</section>`
}));

function signInDiscovered() {
	discoverMock.mockResolvedValue({ collectives: [SAMPLEDB], erroredDbs: [] });
	signIn();
}

function doubleTap(target: Element) {
	const init = { bubbles: true, isPrimary: true, button: 0, clientX: 5, clientY: 5 };
	for (let i = 0; i < 2; i++) {
		target.dispatchEvent(new PointerEvent('pointerdown', init));
		target.dispatchEvent(new PointerEvent('pointerup', init));
	}
}

async function openEditor() {
	render(Layout, { props: { children } });
	signInDiscovered();
	await vi.waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());
	doubleTap(screen.getByTestId('plain'));
	await vi.waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());
}

let urls = 0;
beforeEach(() => {
	resolveGateMock.mockResolvedValue('complete');
	resolveMembershipMock.mockResolvedValue('active');
	domToBlobMock.mockResolvedValue(PNG);
	URL.createObjectURL = () => `blob:shot-${++urls}`;
	URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	resetAppState();
	resetGate();
	resetMembership();
	document.documentElement.removeAttribute(REDACT_TOGGLE_ATTR);
});

describe('+layout — a double tap captures the screen and opens the feedback editor (#612)', () => {
	it('opens the editor with a fresh capture each time', async () => {
		await openEditor();
		const first = screen.getByRole('img').getAttribute('src');
		expect(first).toMatch(/^blob:shot-/);
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		doubleTap(screen.getByTestId('plain'));
		await vi.waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());
		expect(domToBlobMock).toHaveBeenCalledTimes(2);
		expect(screen.getByRole('img').getAttribute('src')).not.toBe(first);
	});

	it('engages the marker on every marked element at the moment of capture', async () => {
		let seen: boolean[] = [];
		domToBlobMock.mockImplementation(async () => {
			seen = Array.from(document.querySelectorAll(`[${REDACT_ATTR}]`)).map((el) =>
				el.matches(`html[${REDACT_TOGGLE_ATTR}] [${REDACT_ATTR}]`)
			);
			return PNG;
		});
		await openEditor();
		expect(seen).toEqual([true, true]);
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(false);
	});

	it('replaces the nav with copy, send and close; close discards and returns the page as it was', async () => {
		render(Layout, { props: { children } });
		signInDiscovered();
		await vi.waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());
		const page = screen.getByTestId('page');
		doubleTap(screen.getByTestId('plain'));
		await vi.waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());

		expect(screen.queryByRole('navigation')).toBeNull();
		const names = Array.from(screen.getByRole('toolbar').querySelectorAll('button')).map(
			(b) => b.textContent?.trim()
		);
		expect(names).toEqual(['Copy', 'Send', 'Close']);
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'typed' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(screen.queryByRole('toolbar')).toBeNull();
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.getByRole('navigation')).toBeTruthy();
		expect(screen.getByTestId('page')).toBe(page);
		expect(page.closest('[inert]')).toBeNull();
		expect(sendMock).not.toHaveBeenCalled();
	});

	it('moves focus to the first editor control, and close returns it to where it was', async () => {
		render(Layout, { props: { children } });
		signInDiscovered();
		await vi.waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());
		const before = screen.getByTestId('page-button');
		before.focus();
		doubleTap(screen.getByTestId('plain'));
		await vi.waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());

		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy' }))
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		await vi.waitFor(() => expect(document.activeElement).toBe(before));
	});

	it('close returns focus to the main content when nothing had it before', async () => {
		await openEditor();
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('main')));
	});

	it('copy puts the screenshot with its ink on the clipboard as image/png', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		class FakeClipboardItem {
			constructor(readonly items: Record<string, Promise<Blob>>) {}
		}
		vi.stubGlobal('ClipboardItem', FakeClipboardItem);
		Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
		await openEditor();
		domToBlobMock.mockClear();

		await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
		const [items] = write.mock.calls[0] as [FakeClipboardItem[]];
		await expect(items[0].items['image/png']).resolves.toBe(PNG);
		const stage = domToBlobMock.mock.calls[0][0] as HTMLElement;
		expect(stage.querySelector('img')).toBeTruthy();
		expect(stage.querySelector('[data-testid="stroke-surface"]')).toBeTruthy();
	});

	it('send hands the draft to the send stub', async () => {
		sendMock.mockResolvedValue(undefined);
		await openEditor();
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'typed' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		expect(sendMock).toHaveBeenCalledWith({
			screenshot: PNG,
			strokes: { v: 1, strokes: [] },
			description: 'typed',
			pagePath: '/roster'
		});
	});

	it('a double tap on a button does not capture; one on plain text then does', async () => {
		render(Layout, { props: { children } });
		signInDiscovered();
		await vi.waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());

		doubleTap(screen.getByTestId('page-button'));

		doubleTap(screen.getByTestId('plain'));

		await vi.waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());
		expect(domToBlobMock).toHaveBeenCalledTimes(1);
	});
});
