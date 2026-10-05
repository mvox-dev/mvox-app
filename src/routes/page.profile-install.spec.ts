// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async (importOriginal) =>
	(await import('$lib/testing/messageMocks')).echoMessages('params', {}, await importOriginal())
);

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);

import ProfilePage from './profile/+page.svelte';
import Layout from './+layout.svelte';
import { startInstallAffordance } from '$lib/install/installState';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { readMessages } from '$lib/testing/pages/profile';

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const installButton = (c: HTMLElement) =>
	q(c, '[data-testid="profile-install-button"]') as HTMLButtonElement | null;
const iosHint = (c: HTMLElement) => q(c, '[data-testid="profile-install-ios-hint"]');

const CHROME_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const IPHONE_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function stubNavigator(input: { userAgent: string; platform: string; maxTouchPoints: number }) {
	for (const [key, value] of Object.entries(input)) {
		Object.defineProperty(window.navigator, key, { value, configurable: true });
	}
	Object.defineProperty(window.navigator, 'standalone', {
		value: undefined,
		configurable: true
	});
}

function stubDisplayModeStandalone(matches: boolean): void {
	vi.spyOn(window, 'matchMedia').mockImplementation(
		(query: string) =>
			({
				matches: query === '(display-mode: standalone)' ? matches : false,
				media: query,
				onchange: null,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
				dispatchEvent: () => false
			}) as unknown as MediaQueryList
	);
}

type BipEvent = Event & {
	prompt: ReturnType<typeof vi.fn>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function makeBeforeInstallPrompt(): BipEvent {
	const evt = new Event('beforeinstallprompt', { cancelable: true }) as BipEvent;
	evt.prompt = vi.fn().mockResolvedValue(undefined);
	evt.userChoice = Promise.resolve({ outcome: 'dismissed' });
	return evt;
}

function selectSampledb() {
	signIn({ token: 'jwt-member', selected: 'sampledb' });
}

let stopAdapter: (() => void) | null = null;
function bootApp(): void {
	if (!stopAdapter) stopAdapter = startInstallAffordance();
}

async function renderProfileReady(): Promise<HTMLElement> {
	bootApp();
	selectSampledb();
	listMyProfilesMock.mockResolvedValue([]);
	const { container } = render(ProfilePage);
	await waitFor(() =>
		expect(q(container, '[data-testid="profile-time-format"]')).not.toBeNull()
	);
	return container;
}

beforeEach(() => {
	localStorage.clear();
	listMyProfilesMock.mockReset();
	stubNavigator({ userAgent: CHROME_UA, platform: 'Win32', maxTouchPoints: 0 });
	stubDisplayModeStandalone(false);
});

afterEach(() => {
	window.dispatchEvent(new Event('appinstalled'));
	stopAdapter?.();
	stopAdapter = null;
	cleanup();
	localStorage.clear();
	resetAppState();
	vi.restoreAllMocks();
});

describe("/profile — install button, 'none' state (#408)", () => {
	it('renders NOTHING when no prompt is stashed and the platform is not iOS', async () => {
		const container = await renderProfileReady();
		expect(container.querySelectorAll('[data-testid^="profile-install-"]').length).toBe(0);
	});
});

describe("/profile — install button, 'prompt' state (#408)", () => {
	it('beforeinstallprompt after mount -> ONE native classed button with the i18n label', async () => {
		const container = await renderProfileReady();
		window.dispatchEvent(makeBeforeInstallPrompt());

		await waitFor(() => expect(installButton(container)).not.toBeNull());
		const button = installButton(container)!;
		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('type')).toBe('button');
		expect((button.getAttribute('class') ?? '').trim()).not.toBe('');
		expect(button.textContent).toContain('[profile_install_button]');
		expect(
			container.querySelectorAll('[data-testid="profile-install-button"]').length
		).toBe(1);
		expect(iosHint(container)).toBeNull();
	});

	it('pressing the button calls the stashed prompt()', async () => {
		const container = await renderProfileReady();
		const evt = makeBeforeInstallPrompt();
		window.dispatchEvent(evt);
		await waitFor(() => expect(installButton(container)).not.toBeNull());

		await fireEvent.click(installButton(container)!);
		await waitFor(() => expect(evt.prompt).toHaveBeenCalledTimes(1));
	});

	it('a REJECTED prompt() removes the button and logs — never an inert control', async () => {
		const container = await renderProfileReady();
		const evt = makeBeforeInstallPrompt();
		const invalidState = Object.assign(
			new Error('The prompt() method may only be called once.'),
			{ name: 'InvalidStateError' }
		);
		evt.prompt = vi.fn().mockRejectedValue(invalidState);
		window.dispatchEvent(evt);
		await waitFor(() => expect(installButton(container)).not.toBeNull());

		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		await fireEvent.click(installButton(container)!);

		await waitFor(() => expect(installButton(container)).toBeNull());
		expect(consoleError).toHaveBeenCalledWith('profile: install prompt failed', invalidState);
	});

	it('is app chrome — present even with NO collective selected', async () => {
		bootApp();
		signIn({ token: 'jwt-member', collectives: [] });
		listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(ProfilePage);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-no-collective"]')).not.toBeNull()
		);

		window.dispatchEvent(makeBeforeInstallPrompt());
		await waitFor(() => expect(installButton(container)).not.toBeNull());
	});
});

describe("/profile — install button, 'ios-hint' state (#408)", () => {
	it('iPhone, not standalone, no prompt -> the button renders; the hint does NOT yet', async () => {
		stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 });
		const container = await renderProfileReady();

		await waitFor(() => expect(installButton(container)).not.toBeNull());
		expect(iosHint(container)).toBeNull();
	});

	it('pressing the button reveals the Share-menu instruction line', async () => {
		stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 });
		const container = await renderProfileReady();
		await waitFor(() => expect(installButton(container)).not.toBeNull());

		await fireEvent.click(installButton(container)!);
		await waitFor(() => expect(iosHint(container)).not.toBeNull());
		expect(iosHint(container)!.textContent).toContain('[profile_install_ios_hint]');
	});
});

describe('#408 review F1 — the install adapter is app-lifetime, owned by the root layout', () => {
	it('the ROOT LAYOUT alone catches beforeinstallprompt; the profile mounted later shows the button', async () => {
		render(Layout);
		const evt = makeBeforeInstallPrompt();
		window.dispatchEvent(evt);

		selectSampledb();
		listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(ProfilePage);
		await waitFor(() => expect(installButton(container)).not.toBeNull());

		await fireEvent.click(installButton(container)!);
		await waitFor(() => expect(evt.prompt).toHaveBeenCalledTimes(1));
	});

	it('an event that fired BEFORE the page mounted is not lost', async () => {
		bootApp(); // the layout boot, in its cheap form
		window.dispatchEvent(makeBeforeInstallPrompt());

		const container = await renderProfileReady();
		expect(installButton(container)).not.toBeNull();
	});
});

describe('#408 copy', () => {
	it("the Estonian copy is Mihkel's drafted default (issue #408 body, verbatim)", () => {
		const et = readMessages('et');
		expect(et.profile_install_button).toBe('Paigalda mvox seadmesse');
		expect(et.profile_install_ios_hint).toBe('Ava jagamismenüü ja vali «Lisa avakuvale».');
	});
});
