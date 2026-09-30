// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { escapeKeydown, fieldKeydown } from './formKeys';

function key(k: string): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: k, cancelable: true });
}

function actions() {
	return { close: vi.fn(), submit: vi.fn() };
}

describe('escapeKeydown', () => {
	it('closes and prevents the default on Escape', () => {
		const close = vi.fn();
		const event = key('Escape');
		escapeKeydown(event, close);
		expect(close).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it('ignores Enter and every other key', () => {
		const close = vi.fn();
		for (const k of ['Enter', 'a', 'Tab']) {
			const event = key(k);
			escapeKeydown(event, close);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(close).not.toHaveBeenCalled();
	});
});

describe('fieldKeydown', () => {
	it('closes on Escape without submitting', () => {
		const a = actions();
		const event = key('Escape');
		fieldKeydown(event, a);
		expect(a.close).toHaveBeenCalledTimes(1);
		expect(a.submit).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it('submits on Enter without closing', () => {
		const a = actions();
		const event = key('Enter');
		fieldKeydown(event, a);
		expect(a.submit).toHaveBeenCalledTimes(1);
		expect(a.close).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);
	});

	it('leaves other keys to the field', () => {
		const a = actions();
		const event = key('a');
		fieldKeydown(event, a);
		expect(a.close).not.toHaveBeenCalled();
		expect(a.submit).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});
});
