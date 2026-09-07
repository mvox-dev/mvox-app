// @vitest-environment happy-dom
//
// #237 RED — DeleteTrigger: the app's ONE delete-trigger unit, the
// "defined once and reused" half of #237 that the issue calls load-bearing.
//
// WHY a component and not per-site markup: #237's goal is that the NEXT
// delete control inherits the standard affordance and a future colour change
// is ONE edit. TrashIcon.svelte (#238) is only the glyph; every site still
// authors its own button, colour and hit area — three of them today carry
// `text-red-700 hover:text-red-800` independently, and the roster's trigger
// shipped at ~20px (p-1). The shared unit is the trigger's FACE only — each
// site keeps its own arm-state variable (seasonManageDeleteArmed /
// deleteArmed / pendingRemoveId are heterogeneous on purpose); no global
// arm-state moves in here.
//
// PO ruling (Mihkel, relayed via Henry 2026-09-07): the unit meets the 44px
// touch minimum BY CONSTRUCTION — a consumer cannot instantiate it below
// 44px. The wrapping button/target is in scope; surrounding row layout is not.
//
// CONTRACT (GREEN must implement — src/lib/components/DeleteTrigger.svelte,
// Svelte 5 runes):
//
//   RENDERS exactly one native <button type="button"> containing exactly one
//   <TrashIcon> (svg[data-icon="trash"], aria-hidden — the icon never carries
//   the name; the BUTTON does, via aria-label or name-from-contents).
//
//   BASE CLASSES, by construction (always present, consumer cannot remove):
//     flex min-h-11 min-w-11 items-center justify-center
//     text-red-700 hover:text-red-800
//     disabled:cursor-default disabled:opacity-60 disabled:hover:text-red-700
//   — the #236/#262 precedent treatment, and the ONLY place in the app the
//   idle destructive-red pair may live (one colour change = one edit; the
//   sweep spec pins the repo-wide uniqueness).
//
//   #237 review F2 — the DISABLED face belongs to the unit too. Pre-sweep it
//   lived in each site's own class string (roster: `disabled:cursor-default
//   disabled:opacity-30 disabled:hover:text-ink-2`), so the migration silently
//   dropped it and an ineligible trigger rendered identical to an actionable
//   one — still lighting on hover, since CSS :hover matches disabled buttons.
//   Owned here, every consumer that passes `disabled` inherits it. opacity-60
//   matches the #252-corrected arrange siblings on the roster's own row (#252
//   ruled opacity-30 too faint to read as a control).
//
//   PROPS
//     class      optional — APPENDED after the base classes (positioning like
//                ml-auto, per-site extras like underline); appending cannot
//                strip the base, so 44px survives any consumer input.
//     iconClass  optional, default 'h-5 w-5' (the #236 precedent size) —
//                landed on the TrashIcon; a site whose row demands smaller
//                (e.g. #262's h-4 w-4 schedule rows) passes its own, which
//                makes the deviation a stated choice at the call site.
//     children   optional snippet — a VISIBLE label rendered beside the icon
//                (the event-detail site keeps its visible label per the
//                #157/#249 single-name discipline: name-from-contents, no
//                aria-label). When absent the consumer passes aria-label.
//     ...rest    spread onto the <button> verbatim: data-testid, aria-label,
//                title, disabled, aria-busy, onclick, onkeydown — every site
//                keeps its own wiring byte-for-byte.

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';

import DeleteTrigger from './DeleteTrigger.svelte';

afterEach(() => {
	cleanup();
});

function button(container: HTMLElement): HTMLButtonElement {
	const buttons = container.querySelectorAll('button');
	expect(buttons, 'exactly one native <button>').toHaveLength(1);
	return buttons[0] as HTMLButtonElement;
}

const BASE_CLASSES = [
	'flex',
	'min-h-11',
	'min-w-11',
	'items-center',
	'justify-center',
	'text-red-700',
	'hover:text-red-800'
];

// #237 review F2 — the disabled face, owned by the unit rather than by each
// call site's class string (which is how the roster's treatment got lost in
// the sweep). `disabled:hover:text-red-700` is the one that matters most:
// without it `hover:text-red-800` still fires over a disabled button.
const DISABLED_CLASSES = [
	'disabled:cursor-default',
	'disabled:opacity-60',
	'disabled:hover:text-red-700'
];

describe('DeleteTrigger — the ONE shared delete affordance (#237)', () => {
	it('renders a native <button type="button"> wrapping ONE aria-hidden TrashIcon svg — no name on the icon', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing' }
		});
		const btn = button(container);
		expect(btn.getAttribute('type'), 'never an implicit submit').toBe('button');
		const svgs = btn.querySelectorAll('svg[data-icon="trash"]');
		expect(svgs, 'exactly one TrashIcon inside the button').toHaveLength(1);
		expect(svgs[0].getAttribute('aria-hidden')).toBe('true');
	});

	it('carries the base treatment by construction: 44px minimum + the #236/#262 red pair', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing' }
		});
		const btn = button(container);
		for (const cls of BASE_CLASSES) {
			expect(btn.classList.contains(cls), `base class ${cls} missing`).toBe(true);
		}
	});

	it('a consumer CANNOT instantiate it below 44px — the class prop APPENDS, the base survives', () => {
		// A consumer doing its worst: positioning extras plus an attempt at a
		// tiny hit area. Tailwind's later-in-markup classes do not defeat
		// min-h-11 by specificity games in our setup, but the contract pinned
		// here is simpler and stronger: the base class LIST is always present.
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing', class: 'ml-auto p-1 text-xs' }
		});
		const btn = button(container);
		for (const cls of ['min-h-11', 'min-w-11', 'text-red-700', 'hover:text-red-800']) {
			expect(btn.classList.contains(cls), `${cls} stripped by consumer class`).toBe(true);
		}
		// …and the consumer's positioning classes DID land (appending works).
		expect(btn.classList.contains('ml-auto')).toBe(true);
	});

	it('a disabled instance carries the disabled face BY CONSTRUCTION — ineligible never looks actionable (#237 review F2)', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Remove section X', disabled: true }
		});
		const btn = button(container);
		expect(btn.disabled, 'the functional gate still holds').toBe(true);
		for (const cls of DISABLED_CLASSES) {
			expect(btn.classList.contains(cls), `disabled variant ${cls} missing`).toBe(true);
		}
	});

	it('the disabled face survives a consumer class — appending cannot strip it either', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Remove section X', disabled: true, class: 'ml-auto p-1 text-xs' }
		});
		const btn = button(container);
		for (const cls of DISABLED_CLASSES) {
			expect(btn.classList.contains(cls), `${cls} stripped by consumer class`).toBe(true);
		}
	});

	it('icon defaults to h-5 w-5 (the #236 precedent size) — ONE default, defined here', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing' }
		});
		const svg = button(container).querySelector('svg[data-icon="trash"]') as SVGElement;
		expect(svg.classList.contains('h-5')).toBe(true);
		expect(svg.classList.contains('w-5')).toBe(true);
	});

	it('iconClass overrides the default — a smaller row makes its deviation a stated choice at the call site (#262 h-4 w-4)', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing', iconClass: 'h-4 w-4' }
		});
		const svg = button(container).querySelector('svg[data-icon="trash"]') as SVGElement;
		expect(svg.classList.contains('h-4')).toBe(true);
		expect(svg.classList.contains('w-4')).toBe(true);
		expect(svg.classList.contains('h-5')).toBe(false);
	});

	it('spreads rest props onto the button verbatim: testid, aria-label, title, disabled, aria-busy', () => {
		const { container } = render(DeleteTrigger, {
			props: {
				'data-testid': 'section-remove-sec-x',
				'aria-label': 'Remove section X',
				title: 'Remove section X',
				disabled: true,
				'aria-busy': 'true'
			}
		});
		const btn = button(container);
		expect(btn.getAttribute('data-testid')).toBe('section-remove-sec-x');
		expect(btn.getAttribute('aria-label')).toBe('Remove section X');
		expect(btn.getAttribute('title')).toBe('Remove section X');
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute('aria-busy')).toBe('true');
	});

	it('onclick wires through — the consumer keeps its own arm-state; the unit adds no behavior', async () => {
		const onclick = vi.fn();
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing', onclick }
		});
		await fireEvent.click(button(container));
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('renders a visible label from children beside the icon — name-from-contents for the event-detail shape (#157/#249)', () => {
		const label = createRawSnippet(() => ({
			render: () => '<span>Delete this event</span>'
		}));
		const { container } = render(DeleteTrigger, {
			props: { children: label }
		});
		const btn = button(container);
		// The visible text IS the accessible name — no aria-label was passed,
		// and the icon is aria-hidden, so name-from-contents is exactly the label.
		expect(btn.getAttribute('aria-label')).toBeNull();
		expect((btn.textContent ?? '').trim()).toBe('Delete this event');
		// The icon still renders alongside the label.
		expect(btn.querySelector('svg[data-icon="trash"]')).not.toBeNull();
	});
});

// (*MVOX:Palestrina* — #237 RED: the shared delete-trigger unit)
