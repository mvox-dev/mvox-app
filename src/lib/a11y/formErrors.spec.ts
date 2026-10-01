import { describe, expect, it } from 'vitest';
import { fieldErrorAttrs } from './formErrors';

describe('fieldErrorAttrs', () => {
	it('marks the field the current error names', () => {
		expect(fieldErrorAttrs('name', 'name', 'season-create-error')).toEqual({
			'aria-invalid': true,
			'aria-describedby': 'season-create-error'
		});
	});

	it('leaves every other field unmarked', () => {
		const unmarked = { 'aria-invalid': undefined, 'aria-describedby': undefined };
		expect(fieldErrorAttrs<'name' | 'dates'>('dates', 'name', 'season-create-error')).toEqual(
			unmarked
		);
		expect(fieldErrorAttrs<'name'>(null, 'name', 'season-create-error')).toEqual(unmarked);
	});
});
