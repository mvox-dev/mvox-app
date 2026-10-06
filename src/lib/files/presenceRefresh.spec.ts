// #756: a failed read of which files are on this device is reported; a superseded one is not.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
const store = vi.hoisted(() => ({ heldFileIds: vi.fn() }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => store }));

import { createPresenceRefresh } from './presenceRefresh';
import { reportProblem } from '$lib/testing/mocks/session';

const boom = new Error('idb broke');
const settle = () => new Promise((r) => setTimeout(r, 0));
const failed = [{ area: 'library', action: 'reading which files are on this device', error: boom }];

beforeEach(() => {
	reportProblem.mockReset();
	store.heldFileIds.mockReset();
});

describe('createPresenceRefresh', () => {
	it('shows the held ids', async () => {
		store.heldFileIds.mockResolvedValue(['f-1']);
		const onIds = vi.fn();
		createPresenceRefresh('library', onIds)('db', 'p', () => true);
		await settle();
		expect(onIds.mock.calls).toEqual([[new Set(['f-1'])]]);
	});

	it('a failed read is reported', async () => {
		store.heldFileIds.mockRejectedValue(boom);
		createPresenceRefresh('library', vi.fn())('db', 'p', () => true);
		await settle();
		expect(reportProblem.mock.calls).toEqual([failed]);
	});

	it('a store that throws at once is reported', () => {
		store.heldFileIds.mockImplementation(() => {
			throw boom;
		});
		createPresenceRefresh('library', vi.fn())('db', 'p', () => true);
		expect(reportProblem.mock.calls).toEqual([failed]);
	});

	it('a read overtaken by a newer one is neither shown nor reported', async () => {
		let rejectFirst!: (e: unknown) => void;
		store.heldFileIds
			.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
			.mockResolvedValue(['f-2']);
		const onIds = vi.fn();
		const refresh = createPresenceRefresh('library', onIds);
		refresh('db', 'p', () => true);
		refresh('db', 'p', () => true);
		rejectFirst(boom);
		await settle();
		expect(reportProblem).not.toHaveBeenCalled();
		expect(onIds.mock.calls).toEqual([[new Set(['f-2'])]]);
	});
});
