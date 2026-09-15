// #368 — the update-forcing module: makes sure no installed client can stay
// wedged on a stale worker forever, and no client reload-loops getting off
// one. See swUpdate.spec.ts's header for the full field-failure writeup and
// the three-lever fix shape this file implements.
//
// Split the same way swPolicy.ts is split from service-worker.ts: the
// DECISIONS (when to check, whether to reload) are pure, exported, and
// pinned with inline-fixture unit tests below in swUpdate.spec.ts — no
// ServiceWorkerGlobalScope, no DOM, no fake timers needed to test the logic
// that matters. `startUpdateForcing` is the impure driver: it wires the pure
// core to the three real platform hooks (registration.update(), the
// `visibilitychange` document event, and the worker's `controllerchange`
// event) and is the only part of this file that touches `navigator`/
// `document`, so importing this module has zero side effects — required
// since it is unit-tested under vitest's default `node` environment, which
// has neither.

// ---------------------------------------------------------------------------
// 1. The update-check scheduler — WHEN to call registration.update(), pure.
// ---------------------------------------------------------------------------

/** Conservative interval poll — far below the 24h ceiling that wedged the
 * field client, far above anything that could hammer the CDN. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Floors visibility-triggered checks: returning to the app re-checks, but
 * rapid app-switcher flips seconds apart do not spam. */
export const VISIBILITY_CHECK_MIN_GAP_MS = 60 * 1000;

export interface UpdateSchedulerState {
	lastCheckMs: number;
}

export type UpdateCheckEvent =
	| { kind: 'interval-tick'; nowMs: number }
	| { kind: 'became-visible'; nowMs: number };

export interface UpdateCheckDecision {
	check: boolean;
	state: UpdateSchedulerState;
}

/** Registration at boot IS a check — the first forced one waits a full gap. */
export function initialUpdateSchedulerState(nowMs: number): UpdateSchedulerState {
	return { lastCheckMs: nowMs };
}

/**
 * One shared clock (`lastCheckMs`) for both triggers, so a visibility-driven
 * check resets the interval timer too — no double-checking across triggers,
 * and a burst of rapid triggers of either kind costs exactly one check.
 */
export function decideUpdateCheck(
	state: UpdateSchedulerState,
	event: UpdateCheckEvent
): UpdateCheckDecision {
	const gap = event.nowMs - state.lastCheckMs;
	const threshold =
		event.kind === 'interval-tick' ? UPDATE_CHECK_INTERVAL_MS : VISIBILITY_CHECK_MIN_GAP_MS;

	if (gap < threshold) return { check: false, state };
	return { check: true, state: { lastCheckMs: event.nowMs } };
}

// ---------------------------------------------------------------------------
// 2. THE reload-loop fence — controllerchange fires on EVERY deploy while a
// tab is open (skipWaiting + clients.claim, #353); an unguarded handler, or
// a latch that resets in-page, is strictly worse than the wedge #368 fixes.
// The latch lives in the guard instance (module scope would leak across
// registrations in tests and, in principle, across re-entrant callers).
// ---------------------------------------------------------------------------

export function createSingleReloadGuard(reload: () => void): () => void {
	let fired = false;
	return () => {
		if (fired) return;
		fired = true;
		reload();
	};
}

/**
 * WHETHER to attach that guard at all — the other half of the fence, pure.
 *
 * `clients.claim()` (the #353 worker calls it in activate) fires
 * `controllerchange` at every client whose controller changes, INCLUDING the
 * null → worker transition of a page that was uncontrolled when it loaded. So
 * a first visit — or a visit right after "clear site data", today's only
 * deterministic unwedge — would reload itself a second after first paint, on a
 * page already showing the newest build. Not a loop (the reloaded page is
 * controlled from the start, so no second controllerchange) but a pointless
 * user-visible reload, and destructive on a cold deep link into
 * `/auth/callback?key=<JWT>`: the reload can land mid-`runCallbackExchange`
 * and restart the token exchange.
 *
 * A reload is only ever WANTED when the controller is being REPLACED — i.e.
 * the page already had one when it booted.
 */
export function shouldReloadOnControllerChange(input: { hadControllerAtBoot: boolean }): boolean {
	return input.hadControllerAtBoot;
}

// ---------------------------------------------------------------------------
// 3. The impure starter — wires the pure core to the real DOM/SW contract.
// Called once from the app's client boot path (see +layout.svelte). Never
// runs under vitest (nothing here executes at import time).
// ---------------------------------------------------------------------------

export function startUpdateForcing(): void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

	// Read BEFORE any await/then — `clients.claim()` can flip this to a worker
	// at any moment, and the distinction we need is what was true at boot.
	const hadControllerAtBoot = navigator.serviceWorker.controller !== null;

	let schedulerState = initialUpdateSchedulerState(Date.now());

	const runCheck = (event: UpdateCheckEvent) => {
		const decision = decideUpdateCheck(schedulerState, event);
		schedulerState = decision.state;
		if (!decision.check) return;
		navigator.serviceWorker
			.getRegistration()
			// `return` matters: without it the update() rejection escapes the chain
			// and the .catch() below never sees it.
			.then((registration) => registration?.update())
			// registration.update() rejects whenever the worker script fetch fails —
			// most often simply because the client is offline, which for an
			// offline-first shell is a normal operating state. Log it (the app
			// installs no unhandledrejection handler) rather than let every tick
			// while offline raise an unhandled rejection; do not swallow silently.
			.catch((error) => {
				console.warn('[#368] service worker update check failed', error);
			});
	};

	setInterval(() => {
		runCheck({ kind: 'interval-tick', nowMs: Date.now() });
	}, UPDATE_CHECK_INTERVAL_MS);

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible') return;
		runCheck({ kind: 'became-visible', nowMs: Date.now() });
	});

	// Exactly one reload per page lifetime, and only on a page that was already
	// controlled at boot — see createSingleReloadGuard and
	// shouldReloadOnControllerChange above.
	if (shouldReloadOnControllerChange({ hadControllerAtBoot })) {
		const reloadOnce = createSingleReloadGuard(() => {
			window.location.reload();
		});
		navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
	}
}

// (*MVOX:Byrd* — #368 GREEN)
