import { describe, expect, it, vi } from 'vitest';

const wire = vi.hoisted(() => ({ rows: [] as Array<(v: unknown) => void> }));
vi.mock('$lib/events/eventPageData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	refreshEventPageWorkRows: () => new Promise((r) => wire.rows.push(r)),
	refreshEventPageDetail: async () => ({})
}));
vi.mock('$lib/agenda/nextEventFileIds', () => ({ nextEventFileIds: () => [] }));
vi.mock('$lib/files/retention', () => ({
	ensureRetentionSweep: async () => {},
	seedRetentionKeys: () => {}
}));

import { createAgendaLoadState, createLoadCounters } from './agendaLoad';
import type { AgendaLoadDeps } from './agendaLoad';
import { createAgendaWorksLoad } from './agendaWorksLoad';
import { testCfg } from '$lib/testing/entuFetchKit';

const CFG = testCfg('sampledb', 'jwt-1');
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup() {
	const schedules: Array<(v: unknown) => void> = [];
	const deps = {
		refreshPresence: () => {},
		collectiveIdentity: () => null,
		collectivesState: () => ({ status: 'loading' }),
		listScheduleItemsByEventId: () => new Promise((r) => schedules.push(r))
	} as unknown as AgendaLoadDeps;
	const ag = createAgendaLoadState();
	const seq = createLoadCounters();
	return { ag, schedules, works: createAgendaWorksLoad(ag, seq, deps), request: seq.request.next() };
}

describe('agenda works and schedule loads within one request', () => {
	it('an older works load answering last is not applied', async () => {
		const { ag, works, request } = setup();
		void works.loadWorksAndManagement(CFG, ['ev-1'], 's-1', request);
		void works.loadWorksAndManagement(CFG, ['ev-1'], 's-1', request);
		wire.rows[1]({ 'ev-1': [{ id: 'newer' }] });
		await settle();
		wire.rows[0]({ 'ev-1': [{ id: 'older' }] });
		await settle();
		expect(ag.worksByEventId).toEqual({ 'ev-1': [{ id: 'newer' }] });
	});

	it('an older schedule load answering last is not applied', async () => {
		const { ag, schedules, works, request } = setup();
		void works.loadScheduleItems(CFG, ['ev-1'], request);
		void works.loadScheduleItems(CFG, ['ev-1'], request);
		schedules[1]({ 'ev-1': ['newer'] });
		await settle();
		schedules[0]({ 'ev-1': ['older'] });
		await settle();
		expect(ag.scheduleByEventId).toEqual({ 'ev-1': ['newer'] });
	});
});

// (*MVOX:Josquin*)
