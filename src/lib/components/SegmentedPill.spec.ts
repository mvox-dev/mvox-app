// @vitest-environment happy-dom
// The one single-select control (#809): a toolbar of toggle buttons, one pressed.
import { cleanup, createEvent, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SegmentedPill from './SegmentedPill.svelte';
import { goOffline, resetOnLine } from '$lib/testing/networkSignal';

afterEach(() => {
	cleanup();
	resetOnLine();
});

type V = 'a' | 'b' | 'c';
const OPTIONS = (['a', 'b', 'c'] as const).map((value) => ({
	value,
	label: value.toUpperCase(),
	testid: `opt-${value}`
}));

function renderPill(props: Record<string, unknown> = {}) {
	const onselect = vi.fn<(v: V | null) => void>();
	const rendered = render(SegmentedPill, {
		props: {
			testid: 'pill',
			label: 'Letters',
			options: OPTIONS,
			selected: 'b',
			emptyAllowed: false,
			kind: 'ui',
			onselect,
			...props
		}
	});
	const group = rendered.getByTestId('pill');
	const buttons = Array.from(group.querySelectorAll('button'));
	return { ...rendered, group, buttons, onselect };
}

const pressed = (buttons: HTMLButtonElement[]) =>
	buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent?.trim());
const stops = (buttons: HTMLButtonElement[]) =>
	buttons.filter((b) => b.tabIndex === 0).map((b) => b.textContent?.trim());

describe('SegmentedPill — what it announces', () => {
	it('is a named toolbar of toggle buttons with the chosen one pressed', () => {
		const { group, buttons } = renderPill();
		expect(group.getAttribute('role')).toBe('toolbar');
		expect(group.getAttribute('aria-label')).toBe('Letters');
		expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
	});

	it('with nothing chosen the default is pressed, and with no default nothing is', () => {
		expect(pressed(renderPill({ selected: null, defaultValue: 'c' }).buttons)).toEqual(['C']);
		cleanup();
		expect(pressed(renderPill({ selected: null }).buttons)).toEqual([]);
	});
});

describe('SegmentedPill — keyboard', () => {
	it('arrows, Home and End move focus and wrap, and never choose', async () => {
		const { buttons, onselect } = renderPill();
		buttons[1].focus();
		await fireEvent.keyDown(buttons[1], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(buttons[2]);
		await fireEvent.keyDown(buttons[2], { key: 'ArrowDown' });
		expect(document.activeElement).toBe(buttons[0]);
		await fireEvent.keyDown(buttons[0], { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(buttons[2]);
		await fireEvent.keyDown(buttons[2], { key: 'Home' });
		expect(document.activeElement).toBe(buttons[0]);
		await fireEvent.keyDown(buttons[0], { key: 'End' });
		expect(document.activeElement).toBe(buttons[2]);
		expect(onselect).not.toHaveBeenCalled();
		expect(pressed(buttons)).toEqual(['B']);
	});

	it('Enter and Space are left to the button, so they choose', () => {
		const { buttons } = renderPill();
		for (const key of ['Enter', ' ', 'Tab']) {
			const event = createEvent.keyDown(buttons[0], { key });
			fireEvent(buttons[0], event);
			expect(event.defaultPrevented, key).toBe(false);
		}
	});

	it('one Tab stop: the chosen option, then wherever focus moved', async () => {
		const { buttons } = renderPill();
		expect(stops(buttons)).toEqual(['B']);
		buttons[1].focus();
		await fireEvent.keyDown(buttons[1], { key: 'ArrowRight' });
		expect(stops(buttons)).toEqual(['C']);
	});

	it('with nothing chosen and no default the first option holds the Tab stop', () => {
		expect(stops(renderPill({ selected: null }).buttons)).toEqual(['A']);
	});

	it('a disabled option is skipped by arrows and never holds the Tab stop', async () => {
		const options = OPTIONS.map((o) => ({ ...o, disabled: o.value === 'b' }));
		const { buttons } = renderPill({ options });
		expect(stops(buttons)).toEqual(['A']);
		buttons[0].focus();
		await fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(buttons[2]);
	});
});

describe('SegmentedPill — tapping', () => {
	it('tapping another option chooses it', async () => {
		const { buttons, onselect } = renderPill();
		await fireEvent.click(buttons[2]);
		expect(onselect.mock.calls).toEqual([['c']]);
	});

	it('empty not allowed: tapping the chosen option keeps it and reports nothing', async () => {
		const { buttons, onselect } = renderPill({ defaultValue: 'a' });
		await fireEvent.click(buttons[1]);
		expect(onselect).not.toHaveBeenCalled();
	});

	it('empty allowed: tapping the chosen option clears it', async () => {
		const { buttons, onselect } = renderPill({ emptyAllowed: true });
		await fireEvent.click(buttons[1]);
		expect(onselect.mock.calls).toEqual([[null]]);
	});

	it('empty allowed with a default: tapping the chosen option goes back to the default', async () => {
		const { buttons, onselect } = renderPill({ emptyAllowed: true, defaultValue: 'a' });
		await fireEvent.click(buttons[1]);
		expect(onselect.mock.calls).toEqual([['a']]);
		await fireEvent.click(buttons[0]);
		expect(onselect.mock.calls).toEqual([['a']]);
	});

	it('a disabled option chooses nothing', async () => {
		const options = OPTIONS.map((o) => ({ ...o, disabled: o.value === 'c' }));
		const { buttons, onselect } = renderPill({ options });
		await fireEvent.click(buttons[2]);
		expect(onselect).not.toHaveBeenCalled();
	});
});

describe('SegmentedPill — data or UI only', () => {
	it('data: offline every option is disabled and a tap saves nothing', async () => {
		await goOffline();
		const { buttons, onselect } = renderPill({ kind: 'data' });
		expect(buttons.every((b) => b.disabled)).toBe(true);
		await fireEvent.click(buttons[0]);
		expect(onselect).not.toHaveBeenCalled();
	});

	it('UI only: offline it still chooses', async () => {
		await goOffline();
		const { buttons, onselect } = renderPill({ kind: 'ui' });
		expect(buttons.some((b) => b.disabled)).toBe(false);
		await fireEvent.click(buttons[0]);
		expect(onselect.mock.calls).toEqual([['a']]);
	});

	it('busy: the group says so and no option chooses', async () => {
		const { group, buttons, onselect } = renderPill({ kind: 'data', busy: true });
		expect(group.getAttribute('aria-busy')).toBe('true');
		await fireEvent.click(buttons[0]);
		expect(onselect).not.toHaveBeenCalled();
	});

	it('reachable while blocked: options stay focusable under aria-disabled', async () => {
		const { buttons, onselect } = renderPill({ kind: 'data', busy: true, reachableWhenBlocked: true });
		expect(buttons.map((b) => [b.disabled, b.getAttribute('aria-disabled')])).toEqual([
			[false, 'true'],
			[false, 'true'],
			[false, 'true']
		]);
		buttons[1].focus();
		await fireEvent.keyDown(buttons[1], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(buttons[2]);
		await fireEvent.click(buttons[2]);
		expect(onselect).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
