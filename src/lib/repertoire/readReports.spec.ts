// #756: shared repertoire reads report a failure; a superseded one does not.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const wire = vi.hoisted(() => ({ workRows: (() => Promise.resolve({})) as () => Promise<unknown> }));
vi.mock('$lib/events/eventPageData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	refreshEventPageWorkRows: () => wire.workRows()
}));

import { resolveManageRights } from './repertoireActions';
import { refetchSeasonRepertoire, refetchWorkRows } from './refetchWorkRows';
import { readScopedEditions } from './editionOptions';
import { json, testCfg } from '$lib/testing/entuFetchKit';
import { reportProblem } from '$lib/testing/mocks/session';

const CFG = testCfg('sampledb', 'jwt-1');
const boom = new Error('read broke');
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	reportProblem.mockReset();
});

describe('resolveManageRights reports a failed rights read', () => {
	it('a rejected read is reported and resolves error', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(boom);
		expect(await resolveManageRights(CFG, 'season-s', 'person-me', fetchImpl)).toBe('error');
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'rights', action: 'reading the rights on season-s', error: boom }]
		]);
	});

	it('a non-2xx read is reported with its status and resolves error', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		expect(await resolveManageRights(CFG, 'season-s', 'person-me', fetchImpl)).toBe('error');
		expect(reportProblem.mock.calls).toEqual([
			[
				{
					area: 'rights',
					action: 'reading the rights on season-s',
					error: new Error('HTTP 500')
				}
			]
		]);
	});
});

type Site = {
	name: string;
	action: string;
	run: (isCurrent: () => boolean) => void;
};

const SITES: Site[] = [
	{
		name: 'refetchWorkRows',
		action: 're-reading the work rows',
		run: (isCurrent) => {
			wire.workRows = () => Promise.reject(boom);
			refetchWorkRows(CFG, ['ev-1'], 'season-1', {
				includeInactive: false,
				isCurrent,
				onRows: () => {}
			});
		}
	},
	{
		name: 'refetchSeasonRepertoire',
		action: 're-reading the season repertoire',
		run: (isCurrent) =>
			refetchSeasonRepertoire(CFG, 'season-1', () => Promise.reject(boom), isCurrent, () => {})
	},
	{
		name: 'readScopedEditions',
		action: 'loading the editions of a work',
		run: (isCurrent) =>
			readScopedEditions(['work-1'], new Set(), () => Promise.reject(boom), isCurrent, () => {})
	}
];

describe.each(SITES)('$name', ({ action, run }) => {
	it('a failed read is reported', async () => {
		run(() => true);
		await settle();
		expect(reportProblem.mock.calls).toEqual([[{ area: 'repertoire', action, error: boom }]]);
	});

	it('a superseded failed read is not reported', async () => {
		run(() => false);
		await settle();
		expect(reportProblem).not.toHaveBeenCalled();
	});
});
