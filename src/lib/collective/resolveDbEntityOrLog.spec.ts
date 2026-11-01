// @vitest-environment happy-dom
// A lookup that fails or finds no database entity keeps one report, under the write's collective.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);

import { resolveDbEntityOrLog } from './resolveDbEntityOrLog';
import { testCfg } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

useKeptProblems();

const A = { db: 'org-a', name: 'Org A', personId: 'person-a' };
const B = { db: 'org-b', name: 'Org B', personId: 'person-b' };
const CFG = testCfg(A.db, 't');
const LABEL = { area: 'agenda', action: 'creating an event' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('resolveDbEntityOrLog', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		signIn({ collectives: [A, B], selected: B.db });
	});
	afterEach(() => {
		resolveDatabaseEntityIdMock.mockReset();
		vi.restoreAllMocks();
		resetAppState();
	});

	it('returns the resolved id and keeps nothing', async () => {
		resolveDatabaseEntityIdMock.mockResolvedValue('db-entity-1');
		expect(await resolveDbEntityOrLog(CFG, LABEL)).toBe('db-entity-1');
		expect(resolveDatabaseEntityIdMock.mock.calls).toEqual([[CFG]]);
		await settle();
		expect(await keptProblems(A)).toEqual([]);
	});

	it('the lookup throws: null, and one report under the collective written to', async () => {
		resolveDatabaseEntityIdMock.mockRejectedValue(new Error('HTTP 500'));
		expect(await resolveDbEntityOrLog(CFG, LABEL)).toBeNull();
		await vi.waitFor(async () =>
			expect(await keptProblems(A)).toEqual([
				{ area: 'agenda', action: 'resolving the database entity for creating an event', detail: 'Error: HTTP 500' }
			])
		);
		expect(await keptProblems(B)).toEqual([]);
	});

	it('no database entity is visible: null, and one report with the reason', async () => {
		resolveDatabaseEntityIdMock.mockResolvedValue(null);
		expect(await resolveDbEntityOrLog(CFG, LABEL)).toBeNull();
		await vi.waitFor(async () =>
			expect(await keptProblems(A)).toEqual([
				{
					area: 'agenda',
					action: 'resolving the database entity for creating an event',
					detail: 'no database entity is visible in this collective'
				}
			])
		);
		expect(await keptProblems(B)).toEqual([]);
	});
});

// (*MVOX:Josquin*)
