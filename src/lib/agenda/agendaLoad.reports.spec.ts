// @vitest-environment happy-dom
// #756: every failed agenda read reaches the problem-handler; the view keeps its fallback.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const wire = vi.hoisted(() => ({
	loadFullAgenda: (() => new Promise(() => {})) as () => Promise<unknown>,
	workRows: (() => new Promise(() => {})) as () => Promise<unknown>
}));
vi.mock('$lib/agenda/agendaData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadFullAgenda: () => wire.loadFullAgenda()
}));
vi.mock('$lib/events/eventPageData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	refreshEventPageWorkRows: () => wire.workRows()
}));

import { createAgendaLoader, createAgendaLoadState, createLoadCounters } from './agendaLoad';
import type { AgendaLoadDeps } from './agendaLoad';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { testCfg } from '$lib/testing/entuFetchKit';
import { reportProblem } from '$lib/testing/mocks/session';

const CFG = testCfg('sampledb', 'jwt-1');
const never = () => new Promise<never>(() => {});
const settle = () => new Promise((r) => setTimeout(r, 0));

type Reads = Partial<
	Record<
		| 'findMyMemberId'
		| 'listMyAttendance'
		| 'listMyRsvps'
		| 'resolveManageRights'
		| 'listScheduleItemsByEventId'
		| 'listAttendance',
		() => Promise<unknown>
	>
>;

function setup(reads: Reads = {}) {
	const ag = createAgendaLoadState();
	const seq = createLoadCounters();
	const deps = {
		selected: () => ({ db: 'sampledb', personId: 'person-p' }),
		seasonManageOpen: () => false,
		seasonManageSwitchGeneration: () => 0,
		resetSeasonManage: () => {},
		closeSeasonCreateForm: () => {},
		closeEventCreateForm: () => {},
		closeSeriesCreateForm: () => {},
		restoreSeriesCreateRun: () => {},
		refreshPresence: () => {},
		findMyMemberId: reads.findMyMemberId ?? never,
		listMyRsvps: reads.listMyRsvps ?? never,
		rsvpsByEventId: () => ({}),
		listMyAttendance: reads.listMyAttendance ?? never,
		resolveManageRights: reads.resolveManageRights ?? never,
		listScheduleItemsByEventId: reads.listScheduleItemsByEventId ?? never,
		listAttendance: reads.listAttendance ?? never,
		loadActiveAndArchivedRosters: never,
		listWorks: never,
		listAllEditions: never,
		listRepertoireItems: never
	} as unknown as AgendaLoadDeps;
	return { ag, seq, loader: createAgendaLoader(ag, seq, deps) };
}

beforeEach(() => {
	reportProblem.mockReset();
	wire.loadFullAgenda = never;
	wire.workRows = never;
});

describe('agenda reads that fail are reported (#756)', () => {
	const boom = new Error('read broke');
	const fail = () => Promise.reject(boom);

	it.each([
		{ read: 'the member lookup', reads: { findMyMemberId: fail }, action: 'finding your member record', area: 'rsvp' },
		{
			read: 'your attendance',
			reads: { findMyMemberId: () => Promise.resolve('member-1'), listMyAttendance: fail },
			action: 'loading your attendance',
			area: 'agenda'
		},
		{ read: 'your answers', reads: { listMyRsvps: fail }, action: 'loading your answers', area: 'agenda' }
	])('a failed read of $read is reported', async ({ reads, action, area }) => {
		const { loader } = setup(reads as Reads);
		loader.loadForSelected();
		await settle();
		expect(reportProblem.mock.calls).toEqual([[{ area, action, error: boom }]]);
	});

	it('a failed member lookup still leaves membership loading', async () => {
		const { ag, loader } = setup({ findMyMemberId: fail });
		loader.loadForSelected();
		await settle();
		expect(ag.membership).toBe('loading');
	});

	it('a failed agenda read is reported and shows the agenda error', async () => {
		wire.loadFullAgenda = fail;
		const { ag, loader } = setup();
		loader.loadForSelected();
		await settle();
		expect(ag.agendaError).toBe(true);
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 'loading the agenda', error: boom }]
		]);
	});

	it('an expired session is not reported (entuFetch already redirects)', async () => {
		wire.loadFullAgenda = () => Promise.reject(new AuthExpiredError());
		const { ag, loader } = setup();
		loader.loadForSelected();
		await settle();
		expect(ag.sessionExpired).toBe(true);
		expect(reportProblem).not.toHaveBeenCalled();
	});

	it('a read superseded by a newer load is not reported', async () => {
		let rejectFirst!: (e: unknown) => void;
		const listMyRsvps = vi
			.fn()
			.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
			.mockImplementation(never);
		const { loader } = setup({ listMyRsvps });
		loader.loadForSelected();
		loader.loadForSelected();
		rejectFirst(boom);
		await settle();
		expect(reportProblem).not.toHaveBeenCalled();
	});

	it('a failed work-rows read is reported and shows no works', async () => {
		wire.workRows = fail;
		const { ag, seq, loader } = setup();
		loader.loadWorksAndManagement(CFG, ['ev-1'], 'season-1', seq.requestId);
		await settle();
		expect(ag.worksByEventId).toEqual({});
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 'loading the work rows', error: boom }]
		]);
	});

	it('a failed schedule read is reported and shows no schedule', async () => {
		const { ag, seq, loader } = setup({ listScheduleItemsByEventId: fail });
		loader.loadScheduleItems(CFG, ['ev-1'], seq.requestId);
		await settle();
		expect(ag.scheduleByEventId).toEqual({});
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 'loading the schedule items', error: boom }]
		]);
	});

	it('a failed season-rates read is reported and shows the rates error', async () => {
		const { ag, loader } = setup({ listAttendance: fail });
		ag.recentItems = [{ id: 'ev-1' } as (typeof ag.recentItems)[number]];
		loader.handleExpandSeasonSummary();
		await settle();
		expect(ag.seasonRatesError).toBe(true);
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 'loading the season attendance rates', error: boom }]
		]);
	});
});
