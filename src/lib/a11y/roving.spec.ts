// src/lib/a11y/roving.spec.ts
import { describe, it, expect } from 'vitest';
import { rovingNextIndex } from './roving';

describe('rovingNextIndex', () => {
	it('moves right/down by one', () => {
		expect(rovingNextIndex('ArrowRight', 0, 3)).toBe(1);
		expect(rovingNextIndex('ArrowDown', 0, 3)).toBe(1);
	});

	it('moves left/up by one', () => {
		expect(rovingNextIndex('ArrowLeft', 1, 3)).toBe(0);
		expect(rovingNextIndex('ArrowUp', 1, 3)).toBe(0);
	});

	it('wraps forward past the last member', () => {
		expect(rovingNextIndex('ArrowRight', 2, 3)).toBe(0);
		expect(rovingNextIndex('ArrowDown', 2, 3)).toBe(0);
	});

	it('wraps backward past the first member', () => {
		expect(rovingNextIndex('ArrowLeft', 0, 3)).toBe(2);
		expect(rovingNextIndex('ArrowUp', 0, 3)).toBe(2);
	});

	it('Home jumps to the first member', () => {
		expect(rovingNextIndex('Home', 2, 5)).toBe(0);
	});

	it('End jumps to the last member', () => {
		expect(rovingNextIndex('End', 0, 5)).toBe(4);
	});

	it('returns -1 for unrelated keys', () => {
		expect(rovingNextIndex('Tab', 0, 3)).toBe(-1);
		expect(rovingNextIndex('Enter', 0, 3)).toBe(-1);
		expect(rovingNextIndex(' ', 0, 3)).toBe(-1);
	});

	it('returns -1 when the group is empty', () => {
		expect(rovingNextIndex('ArrowRight', 0, 0)).toBe(-1);
	});
});
