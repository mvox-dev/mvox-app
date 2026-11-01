// @vitest-environment happy-dom
// #1049: a rights read that comes back unusable shows as 'error' and keeps one report.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { resolveDbEditRight, resolveDbRight } from './dbRights';
import { json, testCfg } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

useKeptProblems();

const cfg = testCfg('sampledb', 'test-token');
const DB_ENTITY = '69c7f8718489bfcb0e81b065';

function fetchWith(database: unknown, entity: unknown): typeof fetch {
	return vi.fn(async (url: string) =>
		String(url).includes('_type.string=database') ? json(database) : json(entity)
	) as unknown as typeof fetch;
}

const NO_DATABASE = fetchWith({ entities: [] }, {});
const NO_ENTITY = fetchWith({ entities: [{ _id: DB_ENTITY }] }, {});

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	signIn({ selected: 'sampledb' });
});

afterEach(() => {
	vi.restoreAllMocks();
	resetAppState();
});

describe.each([
	['resolveDbEditRight', resolveDbEditRight, 'reading the admin rights'],
	['resolveDbRight', resolveDbRight, 'reading the owner tier']
] as const)('%s', (_, resolve, action) => {
	it('no database entity visible: error, and one report', async () => {
		expect(await resolve(cfg, 'person-p', NO_DATABASE)).toBe('error');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'admin', action, detail: 'no database entity is visible in this collective' }
			])
		);
	});

	it('the rights read answers without an entity: error, and one report', async () => {
		expect(await resolve(cfg, 'person-p', NO_ENTITY)).toBe('error');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'admin', action, detail: 'the database entity rights read came back without an entity' }
			])
		);
	});
});

// (*MVOX:Josquin*)
