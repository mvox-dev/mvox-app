// #434 slice 6/6 review F3 — the OTHER half of "no usable signal".
//
// The browser's own network flag (read in $lib/net/online, the one place in
// src/ allowed to touch it) answers a narrower question than the app needs: it
// is true the moment the device is associated to a network, whether or not that
// network can reach anything. The rehearsal-hall wifi with no uplink (the shape
// #434's user story names) reports ONLINE while every fetch rejects — so a gate
// built on that flag alone leaves every write control enabled on a screen that
// is already rendering stored data under an "as of" line.
//
// The app already holds the evidence: a read whose live call rejected and was
// answered out of `$lib/entu/readCache`. This module is where that observation
// lands, kept deliberately tiny and dependency-free so both sides can reach it
// without a cycle: `readCache` (which observes) imports it, and
// `$lib/net/online` (which gates) imports it.
//
// Not a latch: it is cleared the moment a live read succeeds, at every page load
// boundary (`resetServedFromCache`), on the browser's `online` event
// ($lib/net/online), and on every navigation (the root layout's afterNavigate —
// review round 3), so one transient fallback cannot wedge the write gate closed
// for the rest of the session, or carry into a route that never reads the cache.
import { writable, type Readable } from 'svelte/store';

const store = writable(false);

/** True while the most recent evidence says reads are coming out of the cache
 *  because the live call could not be made — regardless of what
 *  the browser's own flag claims. */
export const readFellBackToCache: Readable<boolean> = store;

/** A live GET rejected and the cache answered it. */
export function noteReadFellBackToCache(): void {
	store.set(true);
}

/** A live read got through, or a new load started — whatever we saw before is
 *  no longer the current state of the world. */
export function clearReadFellBackToCache(): void {
	store.set(false);
}

// (*MVOX:Josquin* — #434 slice 6 review F3)
