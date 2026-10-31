// #683: the one problem-handler; for now it writes each failed read to the console.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readable } from 'svelte/store';
import { reportProblem } from '$lib/problems/reportProblem';
import { getProblemLog, resetProblemLog, setProblemOwner } from '$lib/problems/problemLog';
import { AuthExpiredError } from '$lib/entu/auth-expired';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetProblemLog();
	setProblemOwner(null);
});

describe('reportProblem', () => {
	it('writes the area, the failed action and the error to the console', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const boom = new Error('works read broke');

		reportProblem({ area: 'event detail', action: 'loading the library works', error: boom });

		expect(error.mock.calls).toEqual([['event detail: loading the library works failed', boom]]);
	});

	it('an expired session is not reported (#756)', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		reportProblem({ area: 'agenda', action: 'loading your answers', error: new AuthExpiredError() });

		expect(error).not.toHaveBeenCalled();
	});

	it('a failure with an owner is kept under that collective, not the selected one', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('indexedDB', new IDBFactory());
		const a = { db: 'choir-a', personId: 'p-1' };
		const b = { db: 'choir-b', personId: 'p-1' };
		setProblemOwner(readable(b));

		reportProblem({ area: 'agenda', action: 'saving an answer', error: new Error('HTTP 500'), owner: a });

		const shape = async (who: typeof a) =>
			(await getProblemLog()!.list(who)).map(({ area, action, detail }) => ({ area, action, detail }));
		await vi.waitFor(async () =>
			expect(await shape(a)).toEqual([{ area: 'agenda', action: 'saving an answer', detail: 'Error: HTTP 500' }])
		);
		expect(await shape(b)).toEqual([]);
	});
});

// (*MVOX:Josquin*)
