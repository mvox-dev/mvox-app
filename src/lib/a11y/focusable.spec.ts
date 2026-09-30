// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
	focusAfterRender,
	focusableByTestId,
	focusOnMount,
	focusTestIdAfterRender
} from './focusable';

function button(testid: string, disabled = false): HTMLButtonElement {
	const el = document.createElement('button');
	el.dataset.testid = testid;
	el.disabled = disabled;
	document.body.append(el);
	return el;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('focusableByTestId', () => {
	it('returns an enabled element and null for a disabled one', () => {
		const on = button('on');
		button('off', true);
		expect(focusableByTestId('on')).toBe(on);
		expect(focusableByTestId('off')).toBeNull();
	});
});

describe('focusOnMount', () => {
	it('focuses the node it is given', () => {
		const el = button('a');
		focusOnMount(el);
		expect(document.activeElement).toBe(el);
	});
});

describe('focusAfterRender', () => {
	it('reads the element only after the tick, then focuses it', async () => {
		let el: HTMLElement | undefined;
		const done = focusAfterRender(() => el);
		el = button('late');
		expect(document.activeElement).not.toBe(el);
		await done;
		expect(document.activeElement).toBe(el);
	});

	it('does nothing when the getter finds no element', async () => {
		const before = document.activeElement;
		await focusAfterRender(() => null);
		expect(document.activeElement).toBe(before);
	});
});

describe('focusTestIdAfterRender', () => {
	it('focuses the element with that testid once it has rendered', async () => {
		const done = focusTestIdAfterRender('confirm');
		const el = button('confirm');
		await done;
		expect(document.activeElement).toBe(el);
	});
});
