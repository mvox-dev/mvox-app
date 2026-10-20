import { describe, it, expect } from 'vitest';
import { firstById } from './firstById';

describe('firstById', () => {
	it('keeps the first item when an id repeats', () => {
		const map = firstById([
			{ id: 'a', n: 1 },
			{ id: 'b', n: 2 },
			{ id: 'a', n: 3 }
		]);
		expect(map.get('a')?.n).toBe(1);
		expect(map.get('b')?.n).toBe(2);
		expect(map.get('c')).toBeUndefined();
	});
});
