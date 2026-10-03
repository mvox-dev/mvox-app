// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket')
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const { reportProblem } = vi.hoisted(() => ({ reportProblem: vi.fn() }));
vi.mock('$lib/problems/reportProblem', () => ({ reportProblem }));

import { createAgendaPanelState, createAgendaRepertoireQueues } from './agendaRepertoireQueues';
import { createAgendaLoadState, createLoadCounters } from './agendaLoad';
import { createRepertoireWriteQueue } from '$lib/repertoire/repertoireActions';
import type { RepertoireRowActions } from '$lib/repertoire/repertoireRowHandlers';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import type { WorkRow } from '$lib/repertoire/types';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const RI_1: RepertoireItem = { id: 'ri-1', workId: 'work-1', editionId: '', status: 'active', name: 'A' };
const RI_2: RepertoireItem = { id: 'ri-2', workId: 'work-2', editionId: '', status: 'active', name: 'B' };

function row(item: RepertoireItem): WorkRow {
	return { id: item.id, kind: 'repertoire', workId: item.workId, status: 'active' } as WorkRow;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const NEVER = () => new Promise<RepertoireItem[]>(() => {});

function setup(listRepertoireItems = vi.fn(NEVER)) {
	const ag = createAgendaLoadState();
	ag.currentSeasonId = 'season-1';
	ag.manageableSeasonId = 'season-1';
	ag.seasonRepertoire = [RI_1, RI_2];
	ag.panelRepertoire = [RI_1, RI_2];
	const seq = createLoadCounters();
	seq.panelRepertoireSeasonId = 'season-1';
	const panel = createAgendaPanelState();
	let rows = [row(RI_1), row(RI_2)];
	let generation = 0;
	const write = deferred();
	const actions = {
		updateRepertoireStatus: vi.fn(() => write.promise),
		deleteRepertoireItem: vi.fn(() => write.promise)
	} as unknown as RepertoireRowActions;
	const queues = createAgendaRepertoireQueues(ag, seq, panel, {
		selected: () => ({ db: 'sampledb' }),
		isOffline: () => false,
		seasonManageOpen: () => true,
		switchGeneration: () => generation,
		refreshWorksAfterWrite: vi.fn(),
		rows: {
			list: () => rows,
			find: (id) => rows.find((r) => r.id === id),
			patch: (id, patch) => (rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r))),
			drop: (id) => (rows = rows.filter((r) => r.id !== id)),
			snapshot: () => {
				const before = rows;
				return () => (rows = before);
			},
			setOrdinals: () => {}
		},
		actions,
		createRepertoireWriteQueue,
		listRepertoireItems
	});
	return {
		ag,
		panel,
		queues,
		write,
		actions,
		rows: () => rows,
		bumpGeneration: () => (generation += 1)
	};
}

beforeEach(() => {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'crede', name: 'Crede', personId: 'person-p' }] });
});

afterEach(() => {
	resetAppState();
});

describe('#605 — the card and the panel write through one queue', () => {
	it('a settled card write says saved on the card, not on the panel', async () => {
		const t = setup();
		t.queues.rowHandlers.statusChange('ri-1', 'retired');
		t.write.resolve();
		await settle();
		expect(t.ag.manageStatus).toBe('[repertoire_manage_saved]');
		expect(t.panel.manageStatus).toBe('');
	});

	it('a settled panel write says saved on the panel, not on the card', async () => {
		const t = setup();
		t.queues.handlePanelStatusChange('ri-1', 'retired');
		t.write.resolve();
		await settle();
		expect(t.panel.manageStatus).toBe('[repertoire_manage_saved]');
		expect(t.ag.manageStatus).toBe('');
	});

	it('a panel write on an item the card is writing is refused, and both lists show it pending', () => {
		const t = setup();
		t.queues.rowHandlers.statusChange('ri-1', 'retired');
		t.queues.handlePanelStatusChange('ri-1', 'learning');
		expect(t.actions.updateRepertoireStatus).toHaveBeenCalledTimes(1);
		expect(t.ag.managePendingKeys).toEqual(new Set(['ri-1']));
		expect(t.panel.pendingKeys).toEqual(new Set(['ri-1']));
	});

	it('a panel remove drops the item from the season repertoire, and a rejected one restores it', async () => {
		const t = setup();
		t.queues.handlePanelRemoveItem('ri-1');
		expect(t.ag.seasonRepertoire).toEqual([RI_2]);
		expect(t.ag.panelRepertoire).toEqual([RI_2]);
		t.write.reject(new Error('nope'));
		await settle();
		expect(t.ag.seasonRepertoire).toEqual([RI_1, RI_2]);
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

	it('a card write rejected after the panel switched season is not rolled back', async () => {
		const t = setup();
		t.queues.rowHandlers.statusChange('ri-1', 'retired');
		t.bumpGeneration();
		t.write.reject(new Error('nope'));
		await settle();
		expect(t.rows().map((r) => r.status)).toEqual(['retired', 'active']);
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
