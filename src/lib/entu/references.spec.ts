// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { referenceIds } from './references';

describe('referenceIds', () => {
	it('returns [] for an absent prop', () => {
		expect(referenceIds(undefined)).toEqual([]);
	});

	it('keeps each reference id in order and never reads the display string', () => {
		const refs = [
			{ reference: 'p-1', string: 'Anna Tamm' },
			{ string: 'No Id' },
			{ reference: '' },
			{ reference: 'p-2' }
		];
		expect(referenceIds(refs)).toEqual(['p-1', 'p-2']);
	});

	it('keeps a duplicate reference: deduping is the caller’s call', () => {
		expect(referenceIds([{ reference: 'p-1' }, { reference: 'p-1' }])).toEqual(['p-1', 'p-1']);
	});
});
