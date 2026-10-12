// The shell sets the create's error and writes nothing when it cannot resolve where to write.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/collective/resolveDbEntityOrLog', () => ({
	resolveDbEntityOrLog: vi.fn(async () => 'org-efk')
}));

import { runCreateSubmitShell } from '$lib/agenda/createSubmitShell';
import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';
import type { Collective } from '$lib/collectives/types';

const A: Collective = { db: 'org-a', name: 'Org A', personId: 'p' };
const failed = () => 'failed';

function shellWith(selected: Collective | null) {
	const setError = vi.fn();
	const create = vi.fn(async () => 'id');
	const onCreated = vi.fn();
	const run = () =>
		runCreateSubmitShell({
			action: 'x create',
			failed,
			selected: () => selected,
			setError,
			create,
			onCreated
		});
	return { run, setError, create, onCreated };
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('create shell refuses to write', () => {
	it('no collective selected: the error is set and nothing is written', async () => {
		const s = shellWith(null);
		await s.run();
		expect(s.setError).toHaveBeenCalledWith(failed);
		expect(s.create).not.toHaveBeenCalled();
		expect(s.onCreated).not.toHaveBeenCalled();
	});

	it('database entity unresolved: the error is set and nothing is written', async () => {
		vi.mocked(resolveDbEntityOrLog).mockResolvedValueOnce(null);
		const s = shellWith(A);
		await s.run();
		expect(s.setError).toHaveBeenCalledWith(failed);
		expect(s.create).not.toHaveBeenCalled();
		expect(s.onCreated).not.toHaveBeenCalled();
	});
});
