// #408 — install-affordance state for the profile "Install as app" button
// (Profiililt saab mvoxi seadmesse rakendusena paigaldada).
//
// decideInstallAffordance is the pure decision (see installState.spec.ts for
// the full truth table); startInstallAffordance is the browser adapter that
// feeds it from window/navigator events; promptInstall opens the stashed
// browser dialog and always forgets it afterwards.
import { writable, type Readable, type Writable } from 'svelte/store';

export type InstallAffordance = 'prompt' | 'ios-hint' | 'none';

export interface InstallAffordanceInputs {
	hasDeferredPrompt: boolean;
	isStandalone: boolean;
	isIOS: boolean;
}

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** PURE. Standalone (already installed) wins over everything: nothing to
 *  offer. A stashed beforeinstallprompt wins over the iOS hint — the browser
 *  can act, so let it. iOS without a prompt gets the Share-menu hint.
 *  Everything else (desktop Safari, Firefox, anything promptless and
 *  non-iOS) renders nothing: a dead button explaining why it is dead is
 *  worse than its absence. */
export function decideInstallAffordance({
	hasDeferredPrompt,
	isStandalone,
	isIOS
}: InstallAffordanceInputs): InstallAffordance {
	if (isStandalone) return 'none';
	if (hasDeferredPrompt) return 'prompt';
	if (isIOS) return 'ios-hint';
	return 'none';
}

const installAffordanceWritable: Writable<InstallAffordance> = writable('none');

/** A readable store of the current affordance — the profile page's only
 *  contract with this module besides promptInstall. */
export const installAffordance: Readable<InstallAffordance> = installAffordanceWritable;

let stashedPrompt: BeforeInstallPromptEvent | null = null;

function computeIsStandalone(): boolean {
	const nav = window.navigator as Navigator & { standalone?: boolean };
	return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function computeIsIOS(): boolean {
	const nav = window.navigator;
	return (
		/iPhone|iPad|iPod/.test(nav.userAgent) ||
		(nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
	);
}

function recompute(): void {
	installAffordanceWritable.set(
		decideInstallAffordance({
			hasDeferredPrompt: stashedPrompt !== null,
			isStandalone: computeIsStandalone(),
			isIOS: computeIsIOS()
		})
	);
}

/** The browser adapter. Computes the initial affordance from window/
 *  navigator, then listens for `beforeinstallprompt` (preventDefault, stash
 *  the event, recompute) and `appinstalled` (clear the stash, recompute).
 *  Returns a teardown that detaches both listeners. */
export function startInstallAffordance(): () => void {
	recompute();

	function onBeforeInstallPrompt(event: Event): void {
		event.preventDefault();
		stashedPrompt = event as BeforeInstallPromptEvent;
		recompute();
	}

	function onAppInstalled(): void {
		stashedPrompt = null;
		recompute();
	}

	window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
	window.addEventListener('appinstalled', onAppInstalled);

	return () => {
		window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
		window.removeEventListener('appinstalled', onAppInstalled);
	};
}

/** Opens the stashed browser dialog, if any, and clears the stash whatever
 *  the choice (accepted or dismissed) — a second call finds no stash and
 *  calls nothing.
 *
 *  prompt() can also REJECT (Chromium throws InvalidStateError when the banner
 *  has already been consumed), so the store is reconciled in a `finally`: the
 *  stash is gone either way, and leaving the store on 'prompt' would keep the
 *  button on screen with nothing behind it — an inert control that does
 *  nothing on every further press, the one thing the issue body rules out.
 *  The rejection is NOT swallowed here: it reaches the caller, which logs it
 *  (see onInstallButtonClick on the profile page). */
export async function promptInstall(): Promise<void> {
	const event = stashedPrompt;
	if (!event) return;
	stashedPrompt = null;
	try {
		await event.prompt();
	} finally {
		recompute();
	}
}
