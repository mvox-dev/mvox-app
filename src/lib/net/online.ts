// #434 slice 6/6 — the ONE online/offline signal every write control reads.
//
// See online.spec.ts for the contract this satisfies: this file (plus its own
// test helper, $lib/testing/networkSignal.ts) is the ONLY place in src/ that
// may read `navigator.onLine` or listen for the window's `online`/`offline`
// events — a repo-wide sweep pins that.
//
// A signal only: it gates WRITES (every write control across the app reads
// `writesAvailable` and disables itself while it is false), it never gates
// reads — $lib/entu/readCache.ts serves a cached read on a rejected fetch,
// which is a completely independent mechanism from this store. Nothing here is
// queued; there is no retry, no backlog — a write attempted while offline
// simply never happens, full stop (see the write-control specs across the app).
import { derived, readable, type Readable } from 'svelte/store';
import { readFellBackToCache } from './cacheFallback';

/** `navigator.onLine`, read fresh — never cached across calls. `navigator` is
 *  undefined during SSR/prerender (adapter-static build), so this degrades to
 *  "online" there, matching every other browser-only read in this app. */
function currentOnLine(): boolean {
	return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** The one online/offline signal. Starts each new subscriber off the CURRENT
 *  `navigator.onLine` (not a value frozen at import time — a store created
 *  before the browser had settled its own state would otherwise be wrong for
 *  the app's whole lifetime), then follows the window's `online`/`offline`
 *  events for as long as anything is subscribed. The listeners are torn down
 *  the moment the last subscriber goes, so an idle store never leaks a
 *  listener into whatever subscribes next. */
export const online: Readable<boolean> = readable(currentOnLine(), (set) => {
	set(currentOnLine());
	if (typeof window === 'undefined') return () => {};
	const handleOnline = () => set(true);
	const handleOffline = () => set(false);
	window.addEventListener('online', handleOnline);
	window.addEventListener('offline', handleOffline);
	return () => {
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	};
});

/**
 * THE WRITE GATE — what every write control reads (`online` alone is not it).
 *
 * #434 slice 6 review F3: `navigator.onLine` is true as soon as the device is
 * associated to a network, uplink or no uplink. On rehearsal-hall wifi that
 * cannot reach the internet — the shape #434's user story names — it stays true
 * while every fetch rejects, so gating on it alone leaves every control live on
 * a screen that is already showing stored rows under an "as of" line, and a tap
 * gets a generic write error instead of "No signal".
 *
 * So the gate is the OR of both things the app knows: the browser says it is
 * offline, OR a read on this screen had to be answered out of the cache because
 * the live call could not be made ($lib/net/cacheFallback, written by
 * readCache). The second half is not a latch — a live read that gets through
 * clears it, as does the start of the next load — so a single transient
 * fallback cannot wedge writes off.
 */
export const writesAvailable: Readable<boolean> = derived(
	[online, readFellBackToCache],
	([isOnline, fellBack]) => isOnline && !fellBack
);

// (*MVOX:Josquin* — #434 slice 6 GREEN; F3 write gate added in review)
