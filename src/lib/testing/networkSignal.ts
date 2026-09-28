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

// ── #434 slice 6 review F1 — the structural fence ─────────────────────────────
// The GREEN phase gated the write families the brief named as examples and
// stopped; nothing pinned the rest, so five more controls stayed live offline.
// `exerciseEveryEnabledControl` closes that hole by construction: it operates
// EVERY control a user could actually reach on the rendered page and hands the
// caller back what it touched, so the offline assertion is "no write reached
// the wire", not "none of the five controls I remembered to list did".
//
// Anything already `disabled`/`aria-disabled` is skipped — that IS the gate, and
// a disabled control has nothing to prove. So a NEW write control lands in one
// of exactly two states: disabled (gated, skipped here) or enabled and swept,
// where its handler must refuse or the spec fails.

/** A stable-enough identity for a control across re-renders: its testid when it
 *  has one, otherwise what a user would recognise it by. */
function controlKey(el: Element): string {
	const testid = el.getAttribute('data-testid');
	if (testid) return `testid:${testid}`;
	const label = el.getAttribute('aria-label') ?? el.getAttribute('name') ?? '';
	const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
	return `${el.tagName}:${(el as HTMLInputElement).type ?? ''}:${label}:${text}`;
}

/** Operate one control the way a user would — a click for buttons and
 *  checkboxes, a real value change for selects and text/date/number boxes
 *  (plus the blur and Enter that commit this app's inline editors). */
async function operate(el: HTMLElement): Promise<void> {
	const { fireEvent } = await import('@testing-library/svelte');
	if (el.tagName === 'SELECT') {
		const select = el as HTMLSelectElement;
		const option = Array.from(select.options).find((o) => o.value !== '' && !o.disabled);
		if (option) await fireEvent.change(select, { target: { value: option.value } });
		else await fireEvent.change(select);
		return;
	}
	if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
		const input = el as HTMLInputElement;
		const type = (input.type || 'text').toLowerCase();
		if (type === 'checkbox' || type === 'radio' || type === 'file' || type === 'button') {
			await fireEvent.click(input);
			return;
		}
		const value =
			type === 'date'
				? '2026-10-01'
				: type === 'time'
					? '18:30'
					: type === 'datetime-local'
						? '2026-10-01T18:30'
						: type === 'number'
							? '7'
							: 'offline sweep';
		await fireEvent.input(input, { target: { value } });
		await fireEvent.change(input);
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.blur(input);
		return;
	}
	await fireEvent.click(el);
}

/**
 * Operate every ENABLED control inside `scope`, re-querying after each one (any
 * interaction may rebuild the tree), until nothing new is left. Returns the keys
 * it touched — assert on `length` so a harness that rendered no controls at all
 * cannot pass this fence vacuously.
 */
export async function exerciseEveryEnabledControl(
	scope: HTMLElement,
	{ skip = [], limit = 400 }: { skip?: string[]; limit?: number } = {}
): Promise<string[]> {
	const skipped = new Set(skip.map((s) => `testid:${s}`));
	const seen = new Set<string>();
	const touched: string[] = [];
	for (let step = 0; step < limit; step++) {
		const controls = Array.from(
			scope.querySelectorAll<HTMLElement>('button, select, input, textarea, [role="button"]')
		);
		const counts = new Map<string, number>();
		const candidates: { el: HTMLElement; key: string }[] = [];
		for (const el of controls) {
			const base = controlKey(el);
			const n = counts.get(base) ?? 0;
			counts.set(base, n + 1);
			const key = n === 0 ? base : `${base}#${n}`;
			if (seen.has(key) || skipped.has(base) || isWriteDisabled(el)) continue;
			candidates.push({ el, key });
		}
		// FIELDS BEFORE BUTTONS, re-decided every step: a submit clicked over an
		// empty required box is refused by validation long before the write gate,
		// so a form swept in DOM order would prove nothing about that form. Filling
		// first means every submit this reaches is one that would really have
		// written.
		const next =
			candidates.find(
				({ el }) => el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button'
			) ??
			candidates[0] ??
			null;
		if (!next) {
			// A last, longer settle: the sweep's point is that a write NEVER reaches
			// the wire, and an async handler's fetch can be several microtask hops
			// past the click that started it. Asserting on the step's own settle(0)
			// alone would let a real write land after the assertion.
			await settle();
			return touched;
		}
		seen.add(next.key);
		touched.push(next.key);
		await operate(next.el);
		await settle(0);
	}
	throw new Error(`exerciseEveryEnabledControl: still finding controls after ${limit} steps`);
}
