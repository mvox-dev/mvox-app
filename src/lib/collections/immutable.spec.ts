import { describe, it, expect } from 'vitest';
import { toggled, withItem, without } from './immutable';

describe('without', () => {
	it('returns a new Map without the key, leaving the source unchanged', () => {
		const source = new Map([
			['a', 1],
			['b', 2]
		]);
		const next = without(source, 'a');
		expect(next).not.toBe(source);
		expect(next).toBeInstanceOf(Map);
		expect([...next]).toEqual([['b', 2]]);
		expect([...source]).toEqual([
			['a', 1],
			['b', 2]
		]);
	});

	it('returns a new Set without the item, leaving the source unchanged', () => {
		const source = new Set(['a', 'b']);
		const next = without(source, 'a');
		expect(next).not.toBe(source);
		expect(next).toBeInstanceOf(Set);
		expect([...next]).toEqual(['b']);
		expect([...source]).toEqual(['a', 'b']);
	});

	it('returns a new, equal copy when the key is absent', () => {
		const source = new Set(['a']);
		const next = without(source, 'z');
		expect(next).not.toBe(source);
		expect([...next]).toEqual(['a']);
	});
});

describe('withItem', () => {
	it('adds the item when on', () => {
		const source = new Set(['a']);
		const next = withItem(source, 'b', true);
		expect(next).not.toBe(source);
		expect([...next]).toEqual(['a', 'b']);
		expect([...source]).toEqual(['a']);
	});

	it('removes the item when off', () => {
		const source = new Set(['a', 'b']);
		const next = withItem(source, 'a', false);
		expect([...next]).toEqual(['b']);
		expect([...source]).toEqual(['a', 'b']);
	});
});

describe('toggled', () => {
	it('removes a present item', () => {
		const source = new Set(['a', 'b']);
		const next = toggled(source, 'a');
		expect(next).not.toBe(source);
		expect([...next]).toEqual(['b']);
		expect([...source]).toEqual(['a', 'b']);
	});

	it('adds an absent item', () => {
		const source = new Set(['a']);
		expect([...toggled(source, 'b')]).toEqual(['a', 'b']);
		expect([...source]).toEqual(['a']);
	});
});
