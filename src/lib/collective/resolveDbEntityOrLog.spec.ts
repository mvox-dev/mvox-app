import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);

import { resolveDbEntityOrLog } from './resolveDbEntityOrLog';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';

const CFG = testCfg('sampledb', 't');
const LABEL = { area: 'agenda', action: 'event create' };

describe('resolveDbEntityOrLog', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		resolveDatabaseEntityIdMock.mockReset();
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => errorSpy.mockRestore());

	it('returns the resolved id and logs nothing', async () => {
		resolveDatabaseEntityIdMock.mockResolvedValue('db-entity-1');
		expect(await resolveDbEntityOrLog(CFG, LABEL, 'person-1')).toBe('db-entity-1');
		expect(resolveDatabaseEntityIdMock.mock.calls).toEqual([[CFG]]);
		expect(errorSpy.mock.calls).toEqual([]);
	});

	it('returns null and logs the error when the lookup throws', async () => {
		const failure = new Error('HTTP 500');
		resolveDatabaseEntityIdMock.mockRejectedValue(failure);
		expect(await resolveDbEntityOrLog(CFG, LABEL, 'person-1')).toBeNull();
		expect(errorSpy.mock.calls).toEqual([
			['agenda: resolving the database entity for event create failed', failure]
		]);
	});

	it('returns null and logs the person when no database entity is readable', async () => {
		resolveDatabaseEntityIdMock.mockResolvedValue(null);
		const label = { area: 'event detail', action: 'event conversion' };
		expect(await resolveDbEntityOrLog(CFG, label, 'person-1')).toBeNull();
		expect(errorSpy.mock.calls).toEqual([
			['event detail: event conversion with no resolvable database entity', 'person-1']
		]);
	});
});
