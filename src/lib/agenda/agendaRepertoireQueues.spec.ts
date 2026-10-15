// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);

import { createAgendaPanelState, createAgendaRepertoireQueues } from './agendaRepertoireQueues';
import { createAgendaLoadState, createLoadCounters } from './agendaLoad';
import { createRepertoireWriteQueue } from '$lib/repertoire/repertoireActions';
import type { RepertoireRowActions } from '$lib/repertoire/repertoireRowHandlers';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { reportProblem } from '$lib/testing/mocks/session';

const RI_1: RepertoireItem = { id: 'ri-1', workId: 'work-1', editionId: '', status: 'active', name: 'A' };
const RI_2: RepertoireItem = { id: 'ri-2', workId: 'work-2', editionId: '', status: 'active', name: 'B' };

const settle = () => new Promise((r) => setTimeout(r, 0));

const NEVER = () => new Promise<RepertoireItem[]>(() => {});

function setup(listRepertoireItems = vi.fn(NEVER)) {
	const ag = createAgendaLoadState();
	ag.currentSeasonId = 'season-1';
	ag.manageableSeasonId = 'season-1';
	ag.panelRepertoire = [RI_1, RI_2];
	const seq = createLoadCounters();
	seq.panelRepertoireSeasonId = 'season-1';
	const panel = createAgendaPanelState();
	const write = deferred();
	const actions = {
		updateRepertoireStatus: vi.fn(() => write.promise),
		deleteRepertoireItem: vi.fn(() => write.promise)
	} as unknown as RepertoireRowActions;
	const queues = createAgendaRepertoireQueues(ag, seq, panel, {
		selected: () => ({ db: 'sampledb' }),
		isOffline: () => false,
		switchGeneration: () => 0,
		refreshWorksAfterWrite: vi.fn(),
		actions,
		createRepertoireWriteQueue,
		listRepertoireItems
	});
	return {
		ag,
		panel,
		queues,
		write,
		actions
	};
}

beforeEach(() => {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'crede', name: 'Crede', personId: 'person-p' }] });
});

afterEach(() => {
	resetAppState();
});

describe('#605 — the season-manage panel writes through the agenda queue', () => {
	it('a settled panel write says saved on the panel', async () => {
		const t = setup();
		t.queues.handlePanelStatusChange('ri-1', 'retired');
		t.write.resolve();
		await settle();
		expect(t.panel.manageStatus).toBe('[repertoire_manage_saved]');
	});

	it('a panel remove drops the item from the panel, and a rejected one restores it', async () => {
		const t = setup();
		t.queues.handlePanelRemoveItem('ri-1');
		expect(t.ag.panelRepertoire).toEqual([RI_2]);
		t.write.reject(new Error('nope'));
		await settle();
		expect(t.ag.panelRepertoire).toEqual([RI_1, RI_2]);
		expect(t.panel.manageError).toBe(true);
	});

	it('a failed panel re-read after a write is reported to the problem-handler', async () => {
		const boom = new Error('re-read broke');
		const t = setup(vi.fn(() => Promise.reject(boom)));
		t.queues.handlePanelRemoveItem('ri-1');
		t.write.resolve();
		await settle();
		expect(t.ag.panelRepertoire).toEqual([RI_2]);
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 're-reading the season-manage repertoire', error: boom }]
		]);
	});

	it('a panel write rejected after a collective switch is not rolled back', async () => {
		const t = setup();
		t.queues.handlePanelStatusChange('ri-1', 'retired');
		selectedCollectiveDbStore.set('crede');
		t.write.reject(new Error('nope'));
		await settle();
		expect(t.ag.panelRepertoire.map((i) => i.status)).toEqual(['retired', 'active']);
	});
});
