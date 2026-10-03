// #683: the season panel keeps what loaded and reports each failed read to the problem-handler.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { createAgendaLoader, createAgendaLoadState, createLoadCounters } from './agendaLoad';
import type { AgendaLoadDeps } from './agendaLoad';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import { testCfg } from '$lib/testing/entuFetchKit';
import { reportProblem } from '$lib/testing/mocks/session';

const CFG = testCfg('sampledb', 'jwt-1');
const ITEM: RepertoireItem = {
	id: 'ri-1',
	workId: 'work-1',
	editionId: '',
	status: 'active',
	name: 'A'
};
const WORK = { id: 'work-1' };

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(fail: { items?: Error; sources?: Error } = {}) {
	const ag = createAgendaLoadState();
	const reject = (e: Error) => vi.fn().mockRejectedValue(e);
	const deps = {
		seasonManageSwitchGeneration: () => 0,
		listRepertoireItems: fail.items ? reject(fail.items) : vi.fn().mockResolvedValue([ITEM]),
		listWorks: fail.sources
			? reject(fail.sources)
			: vi.fn().mockResolvedValue({ items: [WORK], total: 1, truncated: false }),
		listAllEditions: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
		listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
	} as unknown as AgendaLoadDeps;
	return { ag, loader: createAgendaLoader(ag, createLoadCounters(), deps) };
}

beforeEach(() => {
	reportProblem.mockReset();
});

describe('season panel repertoire load', () => {
	it('a failed repertoire read keeps the works and is reported', async () => {
		const boom = new Error('items broke');
		const { ag, loader } = setup({ items: boom });

		loader.loadPanelRepertoire(CFG, 'season-1');
		await settle();

		expect(ag.panelWorks).toEqual([WORK]);
		expect(ag.panelRepertoire).toEqual([]);
		expect(ag.panelRepertoireError).toBe(true);
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 'loading the season-manage repertoire', error: boom }]
		]);
	});

	it('a failed works read keeps the repertoire and is reported', async () => {
		const boom = new Error('works broke');
		const { ag, loader } = setup({ sources: boom });

		loader.loadPanelRepertoire(CFG, 'season-1');
		await settle();

		expect(ag.panelRepertoire).toEqual([ITEM]);
		expect(ag.panelWorks).toEqual([]);
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 'loading the season-manage repertoire sources', error: boom }]
		]);
	});
});

// (*MVOX:Josquin*)
