// The season panel's repertoire read is dropped when the panel is reset or the request moves on.
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { createLatest } from '$lib/async/latest';
import { createAgendaLoader, createAgendaLoadState, createLoadCounters } from './agendaLoad';
import type { AgendaLoadDeps } from './agendaLoad';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import { deferred, testCfg } from '$lib/testing/entuFetchKit';

const CFG = testCfg('sampledb', 'jwt-1');
const ITEM: RepertoireItem = {
	id: 'ri-1',
	workId: 'work-1',
	editionId: '',
	status: 'active',
	name: 'A'
};

function setup(items: Promise<RepertoireItem[]>) {
	const ag = createAgendaLoadState();
	const panelSwitch = createLatest();
	const deps = {
		seasonManageSwitchCurrent: panelSwitch.whileCurrent,
		listRepertoireItems: vi.fn().mockReturnValue(items),
		listWorks: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
		listAllEditions: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
		listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
	} as unknown as AgendaLoadDeps;
	return {
		ag,
		loader: createAgendaLoader(ag, createLoadCounters(), deps),
		reset: panelSwitch.cancel
	};
}

describe('season panel repertoire load — staleness', () => {
	it('a read that answers after the panel was reset is not applied', async () => {
		const read = deferred<RepertoireItem[]>();
		const { ag, loader, reset } = setup(read.promise);

		const load = loader.loadPanelRepertoire(CFG, 'season-1');
		reset();
		read.resolve([ITEM]);
		await load;

		expect(ag.panelRepertoire).toEqual([]);
	});

	it('control: a read with no reset in between is applied', async () => {
		const read = deferred<RepertoireItem[]>();
		const { ag, loader } = setup(read.promise);

		const load = loader.loadPanelRepertoire(CFG, 'season-1');
		read.resolve([ITEM]);
		await load;

		expect(ag.panelRepertoire).toEqual([ITEM]);
	});
});

// (*MVOX:Josquin*)
