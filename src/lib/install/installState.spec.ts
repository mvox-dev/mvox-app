// @vitest-environment happy-dom
//
// #408 RED — install-affordance state for the profile "Install as app"
// button (Profiililt saab mvoxi seadmesse rakendusena paigaldada).
//
// CONTRACT (GREEN must implement in src/lib/install/installState.ts):
//   - decideInstallAffordance({hasDeferredPrompt, isStandalone, isIOS})
//     -> 'prompt' | 'ios-hint' | 'none' — PURE. isStandalone wins over
//     everything ('none': already installed, nothing to offer); a stashed
//     beforeinstallprompt wins over the iOS hint (the browser can act, so
//     let it); iOS without a prompt gets the Share-menu hint; everything
//     else (desktop Safari, Firefox, anything promptless and non-iOS)
//     renders NOTHING — a dead button explaining why it is dead is worse
//     than its absence (issue body).
//   - installAffordance — a readable store of the current affordance
//     (subscribe contract; `get()` from svelte/store must work).
//   - startInstallAffordance(): () => void — the browser adapter. Reads
//     window/navigator, computes the initial affordance, and listens on
//     window for:
//       'beforeinstallprompt' -> event.preventDefault(), stash the event,
//                                recompute (hasDeferredPrompt: true)
//       'appinstalled'        -> clear the stash, recompute -> 'none'
//     Returns a teardown that detaches both listeners.
//     isStandalone = matchMedia('(display-mode: standalone)').matches
//                    || navigator.standalone === true
//     isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
//             || (navigator.platform === 'MacIntel'
//                 && navigator.maxTouchPoints > 1)   // iPadOS desktop UA
//   - promptInstall(): Promise<void> — calls the stashed event's prompt()
//     and clears the stash WHATEVER the choice (accepted or dismissed);
//     a second call finds no stash and calls nothing.
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	decideInstallAffordance,
	installAffordance,
	promptInstall,
	startInstallAffordance
} from '$lib/install/installState';

// ── environment stubs ────────────────────────────────────────────────────────

const UA = {
	chromeDesktop:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
	safariMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	firefoxDesktop: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
} as const;

function stubNavigator(input: {
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
	standalone?: boolean;
}): void {
	for (const [key, value] of Object.entries(input)) {
		Object.defineProperty(window.navigator, key, { value, configurable: true });
	}
	if (!('standalone' in input)) {
		Object.defineProperty(window.navigator, 'standalone', {
			value: undefined,
			configurable: true
		});
	}
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

function makeBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'dismissed'): BipEvent {
	const evt = new Event('beforeinstallprompt', { cancelable: true }) as BipEvent;
	evt.prompt = vi.fn().mockResolvedValue(undefined);
	evt.userChoice = Promise.resolve({ outcome });
	return evt;
}

let stop: (() => void) | null = null;

beforeEach(() => {
	stubNavigator({ userAgent: UA.chromeDesktop, platform: 'Win32', maxTouchPoints: 0 });
	stubDisplayModeStandalone(false);
});

afterEach(() => {
	// Contract-defined reset: appinstalled clears any stashed prompt while the
	// adapter is still attached, so no state leaks into the next test.
	window.dispatchEvent(new Event('appinstalled'));
	stop?.();
	stop = null;
	vi.restoreAllMocks();
});

// ── the pure decision — FULL truth table, toEqual per case ──────────────────

describe('decideInstallAffordance — full truth table (#408)', () => {
	const CASES: Array<
		[
			{ hasDeferredPrompt: boolean; isStandalone: boolean; isIOS: boolean },
			'prompt' | 'ios-hint' | 'none'
		]
	> = [
		// standalone wins over everything: already installed -> nothing renders
		[{ hasDeferredPrompt: false, isStandalone: true, isIOS: false }, 'none'],
		[{ hasDeferredPrompt: false, isStandalone: true, isIOS: true }, 'none'],
		[{ hasDeferredPrompt: true, isStandalone: true, isIOS: false }, 'none'],
		[{ hasDeferredPrompt: true, isStandalone: true, isIOS: true }, 'none'],
		// a stashed prompt means the browser can act -> its own dialog
		[{ hasDeferredPrompt: true, isStandalone: false, isIOS: false }, 'prompt'],
		[{ hasDeferredPrompt: true, isStandalone: false, isIOS: true }, 'prompt'],
		// iOS has no install API -> the Share-menu hint
		[{ hasDeferredPrompt: false, isStandalone: false, isIOS: true }, 'ios-hint'],
		// desktop Safari / Firefox / anything else -> nothing at all
		[{ hasDeferredPrompt: false, isStandalone: false, isIOS: false }, 'none']
	];

	for (const [input, expected] of CASES) {
		it(`(${JSON.stringify(input)}) -> '${expected}'`, () => {
			expect(decideInstallAffordance(input)).toEqual(expected);
		});
	}
});

// ── the browser adapter ──────────────────────────────────────────────────────

describe('startInstallAffordance — window adapter (#408)', () => {
	it("beforeinstallprompt on window -> preventDefault() called and state 'prompt'", () => {
		stop = startInstallAffordance();
		expect(get(installAffordance)).toBe('none');

		const evt = makeBeforeInstallPrompt();
		const preventDefault = vi.spyOn(evt, 'preventDefault');
		window.dispatchEvent(evt);

		expect(preventDefault).toHaveBeenCalled();
		expect(get(installAffordance)).toBe('prompt');
	});

	it("appinstalled -> 'none' and the stash is cleared (a later promptInstall calls nothing)", async () => {
		stop = startInstallAffordance();
		const evt = makeBeforeInstallPrompt();
		window.dispatchEvent(evt);
		expect(get(installAffordance)).toBe('prompt');

		window.dispatchEvent(new Event('appinstalled'));
		expect(get(installAffordance)).toBe('none');

		await promptInstall();
		expect(evt.prompt).not.toHaveBeenCalled();
	});

	it("display-mode standalone -> 'none' regardless, even when beforeinstallprompt fires", () => {
		stubDisplayModeStandalone(true);
		stop = startInstallAffordance();
		expect(get(installAffordance)).toBe('none');

		window.dispatchEvent(makeBeforeInstallPrompt());
		expect(get(installAffordance)).toBe('none');
	});

	it("navigator.standalone === true (iOS home-screen webclip) -> 'none'", () => {
		stubNavigator({
			userAgent: UA.iphone,
			platform: 'iPhone',
			maxTouchPoints: 5,
			standalone: true
		});
		stop = startInstallAffordance();
		expect(get(installAffordance)).toBe('none');
	});

	it("iPhone UA, not standalone, no prompt -> 'ios-hint'", () => {
		stubNavigator({ userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5 });
		stop = startInstallAffordance();
		expect(get(installAffordance)).toBe('ios-hint');
	});

	it("desktop Safari (MacIntel, maxTouchPoints 0, no prompt) -> 'none'", () => {
		stubNavigator({ userAgent: UA.safariMac, platform: 'MacIntel', maxTouchPoints: 0 });
		stop = startInstallAffordance();
		expect(get(installAffordance)).toBe('none');
	});

	it("Firefox desktop (no prompt, not iOS) -> 'none'", () => {
		stubNavigator({ userAgent: UA.firefoxDesktop, platform: 'Linux x86_64', maxTouchPoints: 0 });
		stop = startInstallAffordance();
		expect(get(installAffordance)).toBe('none');
	});

	it("iPadOS desktop UA (MacIntel + maxTouchPoints 5) counts as iOS -> 'ios-hint'", () => {
		stubNavigator({ userAgent: UA.safariMac, platform: 'MacIntel', maxTouchPoints: 5 });
		stop = startInstallAffordance();
		expect(get(installAffordance)).toBe('ios-hint');
	});

	it('teardown detaches the listeners — a later beforeinstallprompt changes nothing', () => {
		const teardown: () => void = startInstallAffordance();
		teardown();

		window.dispatchEvent(makeBeforeInstallPrompt());
		expect(get(installAffordance)).toBe('none');
	});
});

// ── promptInstall ────────────────────────────────────────────────────────────

describe('promptInstall — opens the stashed browser dialog, then forgets it (#408)', () => {
	it('calls the stashed prompt() once and clears the stash whatever the choice', async () => {
		stop = startInstallAffordance();
		const evt = makeBeforeInstallPrompt('dismissed');
		window.dispatchEvent(evt);
		expect(get(installAffordance)).toBe('prompt');

		await promptInstall();
		expect(evt.prompt).toHaveBeenCalledTimes(1);
		// stash cleared: no prompt, not iOS, not standalone -> 'none'
		expect(get(installAffordance)).toBe('none');

		await promptInstall();
		expect(evt.prompt).toHaveBeenCalledTimes(1);
	});
});
