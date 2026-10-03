// #683: one failed picker read costs only its own list; the failure goes to the problem-handler.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportProblem } = vi.hoisted(() => ({ reportProblem: vi.fn() }));
vi.mock('$lib/problems/reportProblem', () => ({ reportProblem }));
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { readManagePickers } from '$lib/repertoire/managePickers';
import type { Edition, Work } from '$lib/library/libraryData';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import { testCfg } from '$lib/testing/entuFetchKit';

const CFG = testCfg('sampledb', 'jwt-1');
const WORK = { id: 'work-1', title: 'Ave verum' } as unknown as Work;
const EDITION = { id: 'ed-1', workId: 'work-1' } as unknown as Edition;
const ITEM: RepertoireItem = {
	id: 'ri-1',
	workId: 'work-1',
	editionId: '',
	status: 'active',
	name: 'Ave verum'
};

function reads(fail: Partial<Record<'works' | 'editions' | 'repertoire', Error>> = {}) {
	return {
		listWorks: vi.fn(async () => {
			if (fail.works) throw fail.works;
			return { items: [WORK], total: 1, truncated: true };
		}),
		listAllEditions: vi.fn(async () => {
			if (fail.editions) throw fail.editions;
			return { items: [EDITION], total: 1, truncated: false };
		}),
		listRepertoireItems: vi.fn(async () => {
			if (fail.repertoire) throw fail.repertoire;
			return [ITEM];
		})
	};
}

beforeEach(() => {
	reportProblem.mockReset();
});

describe('readManagePickers', () => {
	it('all three reads land: every list, complete, nothing reported', async () => {
		const read = await readManagePickers(CFG, 'season-1', reads());

		expect(read).toEqual({
			pickers: {
				libraryWorks: [WORK],
				libraryEditions: [EDITION],
				libraryWorksPartial: true,
				libraryEditionsPartial: false,
				seasonRepertoire: [ITEM]
			},
			complete: true
		});
		expect(reportProblem).not.toHaveBeenCalled();
	});

	it('a failed works read keeps the editions and the repertoire, and is reported', async () => {
		const boom = new Error('works read broke');

		const read = await readManagePickers(CFG, 'season-1', reads({ works: boom }));

		expect(read).toEqual({
			pickers: {
				libraryWorks: [],
				libraryEditions: [EDITION],
				libraryWorksPartial: false,
				libraryEditionsPartial: false,
				seasonRepertoire: [ITEM]
			},
			complete: false
		});
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'repertoire pickers', action: 'loading the library works', error: boom }]
		]);
	});

	it('a failed repertoire read keeps both library lists, and is reported', async () => {
		const boom = new Error('repertoire read broke');

		const read = await readManagePickers(CFG, 'season-1', reads({ repertoire: boom }));

		expect(read).toEqual({
			pickers: {
				libraryWorks: [WORK],
				libraryEditions: [EDITION],
				libraryWorksPartial: true,
				libraryEditionsPartial: false,
				seasonRepertoire: []
			},
			complete: false
		});
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'repertoire pickers', action: 'loading the season repertoire', error: boom }]
		]);
	});

	it('each failed read is reported on its own', async () => {
		const works = new Error('works');
		const editions = new Error('editions');

		await readManagePickers(CFG, 'season-1', reads({ works, editions }));

		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'repertoire pickers', action: 'loading the library works', error: works }],
			[{ area: 'repertoire pickers', action: 'loading the library editions', error: editions }]
		]);
	});

	it('no season: no repertoire read, an empty repertoire list', async () => {
		const r = reads();

		const read = await readManagePickers(CFG, null, r);

		expect(read.pickers.seasonRepertoire).toEqual([]);
		expect(read.complete).toBe(true);
		expect(r.listRepertoireItems).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
