// @vitest-environment happy-dom
//
// #124 (gate #114 F1) RED — SectionPicker under TRUSTED-EVENT timing: the
// "+ New section…" tap must open the create form AND KEEP IT OPEN.
//
// THE EXACT LIVE FAILURE PATH (root cause of "Nothing visibly happens when
// tapping [+ New section]", TU.6 gate walk, real phone):
//
//   In a real browser, a HARDWARE tap is a task, and the event loop performs a
//   MICROTASK CHECKPOINT between each listener invocation (the JS stack empties
//   after every callback of a trusted event's dispatch). Svelte 5 schedules its
//   DOM flush in a microtask. So a real tap on `section-picker-new` runs:
//
//     1. the component's delegated `onclick` → `openCreateForm()` sets
//        `creating = true`;
//     2. microtask checkpoint → Svelte FLUSHES: the `{#if !creating}` branch
//        swap UNMOUNTS the "+ New section…" button and mounts the form;
//     3. the SAME click keeps bubbling and reaches the `<svelte:window onclick>`
//        outside-click handler — whose `event.target` is now the DETACHED
//        button, so `root.contains(target)` is FALSE → `dismiss()` closes the
//        whole picker, form and all.
//
//   Net effect on the phone: the dropdown just collapses — no form, no error,
//   no write. Every pre-#124 spec missed it because SYNTHETIC dispatch
//   (fireEvent / element.dispatchEvent) never empties the JS stack between
//   listeners, so no flush happens mid-bubble and the target is still attached
//   when the window handler runs. The `trustedClick` helper below reproduces
//   the trusted-event sequencing faithfully: deliver to the component (bubble
//   stopped at document), flush, then deliver the same event to window with
//   its original — by then detached — target.
//
// FIX SHAPE (GREEN's choice, these specs don't prescribe): dismiss on
// `pointerdown` (fires before any re-render), or ignore window clicks whose
// target is no longer connected, or track "this click started inside me". All
// three keep BOTH pinned behaviors below: an inside tap that re-renders the
// menu must not dismiss; a genuine outside tap must still dismiss.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — any key resolves to itself; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

import SectionPicker from './SectionPicker.svelte';
import type { SectionNode } from './sectionData';

afterEach(() => {
	cleanup();
});

function fixtureTree(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] }
	];
}

function renderPicker(oncreate = vi.fn(), onpick = vi.fn()) {
	const { container } = render(SectionPicker, {
		props: { memberId: 'm-1', sections: fixtureTree(), selectedIds: [], onpick, oncreate }
	});
	return { container, oncreate, onpick };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/**
 * Dispatch a click with TRUSTED-EVENT event-loop semantics: the component's own
 * (delegated) handlers run first, then a microtask checkpoint (Svelte's flush),
 * and only THEN the window-level listeners see the event — carrying its
 * original target, which the flush may have unmounted.
 *
 * Synthetic dispatch runs the whole path synchronously with no checkpoint, so
 * plain `fireEvent.click` cannot exercise this ordering — which is exactly how
 * the live defect stayed invisible to the existing suites.
 */
async function trustedClick(el: HTMLElement): Promise<void> {
	// Leg 1 — component-side listeners only: stop the bubble at `document` so
	// the component's `<svelte:window>` handler does NOT see the synchronous
	// synthetic pass. (stopPropagation, not stopImmediatePropagation: any
	// document-level listener of the app itself must still run.)
	const stopAtDocument = (e: Event) => e.stopPropagation();
	document.addEventListener('click', stopAtDocument);
	try {
		await fireEvent.click(el); // handlers run; the awaited tick is the flush
	} finally {
		document.removeEventListener('click', stopAtDocument);
	}
	// Leg 2 — the checkpoint has flushed; the same event now reaches the window
	// listeners, target preserved (and possibly detached by that flush).
	const continued = new MouseEvent('click', { bubbles: false, cancelable: true });
	Object.defineProperty(continued, 'target', { value: el, configurable: true });
	window.dispatchEvent(continued);
	await Promise.resolve(); // let any state written by the window handler render
}

describe('SectionPicker — "+ New section…" under trusted-event timing (#124 F1 root cause)', () => {
	it('a trusted tap on section-picker-new opens the inline create form AND KEEPS IT OPEN — the tap must not be mistaken for an outside click just because the flush unmounted the tapped button', async () => {
		const { container } = renderPicker();
		await trustedClick(q(container, 'section-picker-trigger-m-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-1')).not.toBeNull();
		});

		await trustedClick(q(container, 'section-picker-new') as HTMLElement);

		// The form is on screen and STAYS on screen: the very next frame must not
		// tear the picker down. (Live symptom when this regresses: the dropdown
		// collapses the instant it is tapped — "nothing visibly happens".)
		expect(q(container, 'section-create-form')).not.toBeNull();
		expect(q(container, 'section-picker-menu-m-1')).not.toBeNull();
		expect(
			(q(container, 'section-picker-trigger-m-1') as HTMLElement).getAttribute('aria-expanded')
		).toBe('true');
	});

	it('the form opened by a trusted tap is USABLE: the auto-focused name input is still in the document and focused', async () => {
		const { container } = renderPicker();
		await trustedClick(q(container, 'section-picker-trigger-m-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-1')).not.toBeNull();
		});

		await trustedClick(q(container, 'section-picker-new') as HTMLElement);

		const name = q(container, 'section-create-name') as HTMLInputElement | null;
		expect(name).not.toBeNull();
		expect(name?.isConnected).toBe(true);
		await waitFor(() => {
			expect(document.activeElement).toBe(name);
		});
	});

	it('a valid submit through trusted taps still fires oncreate ONCE — the whole type-name-submit path survives trusted timing end-to-end', async () => {
		const oncreate = vi.fn();
		const { container } = renderPicker(oncreate);
		await trustedClick(q(container, 'section-picker-trigger-m-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-1')).not.toBeNull();
		});
		await trustedClick(q(container, 'section-picker-new') as HTMLElement);
		expect(q(container, 'section-create-name')).not.toBeNull(); // guards the RED reason

		await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await trustedClick(q(container, 'section-create-submit') as HTMLElement);

		expect(oncreate).toHaveBeenCalledTimes(1);
		expect(oncreate).toHaveBeenCalledWith({ name: 'Tenor', parentId: null });
	});

	// Regression guards on the FIX — these two pass today and must KEEP passing:
	// whatever GREEN does about the detached-target misread must not break the
	// legitimate behaviors on either side of it.

	it('control (passes today): a trusted tap on the TRIGGER opens the menu and does not immediately dismiss it — the trigger stays mounted through the flush, so its window-leg target is still inside the root', async () => {
		const { container } = renderPicker();
		await trustedClick(q(container, 'section-picker-trigger-m-1') as HTMLElement);
		expect(q(container, 'section-picker-menu-m-1')).not.toBeNull();
	});

	it('control (passes today): a trusted tap genuinely OUTSIDE the picker still dismisses the open menu — the fix must not disable outside-click dismissal', async () => {
		const { container } = renderPicker();
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		try {
			await trustedClick(q(container, 'section-picker-trigger-m-1') as HTMLElement);
			expect(q(container, 'section-picker-menu-m-1')).not.toBeNull();

			await trustedClick(outside);
			expect(q(container, 'section-picker-menu-m-1')).toBeNull();
		} finally {
			outside.remove();
		}
	});
});

// (*MVOX:Tallis* — #124 RED, gate #114 F1: trusted-event timing pins the
//  create-form tap; root cause = outside-click dismissal misreading the
//  flush-detached "+ New section…" button as an outside target)
