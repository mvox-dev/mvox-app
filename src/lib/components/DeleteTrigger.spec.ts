// @vitest-environment happy-dom
// DeleteTrigger is the app's one delete button: a native button around an aria-hidden
// TrashIcon, with a 44px floor no consumer class can strip and rest props spread verbatim.

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

// Size is a layout the test DOM cannot measure, so the 44px floor is pinned by
// its tokens. The red pair is pinned repo-wide by trashcan-sweep.spec.ts.
const TOUCH_TOKENS = ['min-h-11', 'min-w-11'];

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

	it('layout guard (happy-dom cannot measure size): the 44px touch floor is on every instance', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing' }
		});
		const btn = button(container);
		for (const cls of TOUCH_TOKENS) {
			expect(btn.classList.contains(cls), `touch token ${cls} missing`).toBe(true);
		}
	});

	it('layout guard (happy-dom cannot measure size): a consumer class cannot strip the 44px floor', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing', class: 'ml-auto p-1 text-xs' }
		});
		const btn = button(container);
		for (const cls of TOUCH_TOKENS) {
			expect(btn.classList.contains(cls), `${cls} stripped by consumer class`).toBe(true);
		}
	});

	it('a disabled instance cannot be pressed — the click never reaches the consumer (#237 review F2)', async () => {
		const onclick = vi.fn();
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Remove section X', disabled: true, onclick }
		});
		const btn = button(container);
		expect(btn.disabled).toBe(true);
		await fireEvent.click(btn);
		expect(onclick).not.toHaveBeenCalled();
	});

	it('a consumer class does not undo the disabled state', async () => {
		const onclick = vi.fn();
		const { container } = render(DeleteTrigger, {
			props: {
				'aria-label': 'Remove section X',
				disabled: true,
				class: 'ml-auto p-1 text-xs',
				onclick
			}
		});
		const btn = button(container);
		expect(btn.disabled).toBe(true);
		await fireEvent.click(btn);
		expect(onclick).not.toHaveBeenCalled();
	});

	it('layout guard (happy-dom cannot measure size): the icon defaults to h-5 w-5', () => {
		const { container } = render(DeleteTrigger, {
			props: { 'aria-label': 'Delete the thing' }
		});
		const svg = button(container).querySelector('svg[data-icon="trash"]') as SVGElement;
		expect(svg.classList.contains('h-5')).toBe(true);
		expect(svg.classList.contains('w-5')).toBe(true);
	});

	it('layout guard (happy-dom cannot measure size): iconClass replaces the default icon size', () => {
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
		expect(btn.querySelector('svg[data-icon="trash"]')).not.toBeNull();
	});
});

// (*MVOX:Palestrina* — #237 RED: the shared delete-trigger unit)
