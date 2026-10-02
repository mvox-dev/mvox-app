// #683: the one problem-handler; for now it writes each failed read to the console.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportProblem } from '$lib/problems/reportProblem';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('reportProblem', () => {
	it('writes the area, the failed action and the error to the console', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const boom = new Error('works read broke');

		reportProblem({ area: 'event detail', action: 'loading the library works', error: boom });

		expect(error.mock.calls).toEqual([['event detail: loading the library works failed', boom]]);
	});
});

// (*MVOX:Josquin*)
