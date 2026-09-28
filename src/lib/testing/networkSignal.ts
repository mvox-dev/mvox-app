// #434 slice 6/6 — test helpers for the online/offline signal.
//
// The app's signal ($lib/net/online) reads `navigator.onLine` and listens to
// the window's `online`/`offline` events. These helpers flip BOTH the way a
// browser does: the property first, then the event — so a store that reads
// the property on subscribe and one that only listens to events see the same
// world.
import { tick } from 'svelte';
import { expect } from 'vitest';

function setNavigatorOnLine(value: boolean): void {
	Object.defineProperty(window.navigator, 'onLine', {
		configurable: true,
		get: () => value
	});
}

/** The network drops: `navigator.onLine` reads false and `offline` fires. */
export async function goOffline(): Promise<void> {
	setNavigatorOnLine(false);
	window.dispatchEvent(new Event('offline'));
	await tick();
}

/** The network returns: `navigator.onLine` reads true and `online` fires. */
export async function goOnline(): Promise<void> {
	setNavigatorOnLine(true);
	window.dispatchEvent(new Event('online'));
	await tick();
}

/** Put `navigator.onLine` back to true without firing anything — teardown. */
export function resetOnLine(): void {
	setNavigatorOnLine(true);
}

/** Lets queued microtasks and a macrotask run — a click that WOULD have
 *  reached the wire gets its chance before the spec asserts it did not. */
export function settle(ms = 20): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A control is disabled if it carries `disabled` OR `aria-disabled="true"`
 *  (AttendanceSurface keeps its toggles focusable with aria-disabled). */
export function isWriteDisabled(el: Element): boolean {
	return (
		(el as HTMLButtonElement | HTMLSelectElement | HTMLInputElement).disabled === true ||
		el.getAttribute('aria-disabled') === 'true'
	);
}

/**
 * The offline reason is VISIBLE TEXT — not a tooltip, not sr-only. Asserts the
 * node `[data-testid=testid]` exists inside `scope`, carries `expectedText`,
 * and that neither it nor any ancestor up to `scope` hides it.
 */
export function expectVisibleReason(scope: Element, testid: string, expectedText: string): HTMLElement {
	const node = scope.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
	expect(node, `expected a visible [data-testid="${testid}"] reason`).not.toBeNull();
	expect(node!.textContent?.trim()).toBe(expectedText);
	let el: HTMLElement | null = node;
	while (el && el !== scope.parentElement) {
		expect(el.classList.contains('sr-only'), `${testid}: sr-only is not visible`).toBe(false);
		expect(el.hasAttribute('hidden'), `${testid}: hidden is not visible`).toBe(false);
		expect(el.getAttribute('aria-hidden'), `${testid}: aria-hidden hides it`).not.toBe('true');
		el = el.parentElement;
	}
	return node!;
}

/** Fetch calls that were not GETs — a write reaching the wire. */
export function nonGetCalls(fetchStub: { mock: { calls: unknown[][] } }): unknown[][] {
	return fetchStub.mock.calls.filter(
		(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() !== 'GET'
	);
}

// (*MVOX:Tallis* — #434 slice 6 RED)
