// @vitest-environment happy-dom
// #756: every failed agenda read reaches the problem-handler; the view keeps its fallback.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const wire = vi.hoisted(() => {
	const pending = (() => new Promise(() => {})) as () => Promise<unknown>;
	return {
		loadFullAgenda: pending,
		workRows: pending,
		detail: pending,
		dbEntity: pending,
		parts: pending,
		roster: pending,
		sections: pending
	};
});
type Wire = Partial<Record<keyof typeof wire, () => Promise<unknown>>>;
vi.mock('$lib/agenda/agendaData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadFullAgenda: () => wire.loadFullAgenda()
}));
vi.mock('$lib/events/eventPageData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	refreshEventPageWorkRows: () => wire.workRows(),
	refreshEventPageDetail: () => wire.detail()
}));
vi.mock('$lib/collective/databaseEntity', () => ({ resolveDatabaseEntityId: () => wire.dbEntity() }));
vi.mock('$lib/agenda/nextEventFileIds', () => ({ nextEventFileIds: () => ['file-1'] }));
vi.mock('$lib/files/prefetch', () => ({ prefetchNextEventParts: () => wire.parts() }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => ({}) }));
vi.mock('$lib/roster/rosterData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadRoster: () => wire.roster()
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<object>()),
	listSections: () => wire.sections()
}));

import { createAgendaLoader, createAgendaLoadState, createLoadCounters } from './agendaLoad';
import type { AgendaLoadDeps } from './agendaLoad';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { testCfg } from '$lib/testing/entuFetchKit';
import { reportProblem } from '$lib/testing/mocks/session';

const CFG = testCfg('sampledb', 'jwt-1');
const never = () => new Promise<never>(() => {});
const settle = () => new Promise((r) => setTimeout(r, 0));

type Loader = ReturnType<typeof setup>;
type Read = () => Promise<unknown>;
const boom = new Error('read broke');
const fail: Read = () => Promise.reject(boom);

function setup(reads: Partial<Record<string, Read>> = {}) {
	const ag = createAgendaLoadState();
	const seq = createLoadCounters();
	const noop = () => {};
	const deps = {
		...Object.fromEntries(
			[
				'findMyMemberId',
				'listMyRsvps',
				'listMyAttendance',
				'resolveManageRights',
				'listScheduleItemsByEventId',
				'listAttendance',
				'loadActiveAndArchivedRosters'
			].map((name) => [name, reads[name] ?? never])
		),
		selected: () => ({ db: 'sampledb', personId: 'person-p' }),
		collectiveIdentity: () => ({ db: 'sampledb', personId: 'person-p' }),
		seasonManageOpen: () => false,
		...Object.fromEntries(
			[
				'resetSeasonManage',
				'closeSeasonCreateForm',
				'closeEventCreateForm',
				'closeSeriesCreateForm',
				'restoreSeriesCreateRun',
				'refreshPresence'
			].map((name) => [name, noop])
		),
		rsvpsByEventId: () => ({})
	} as unknown as AgendaLoadDeps;
	return { ag, seq, loader: createAgendaLoader(ag, seq, deps) };
}

const select = ({ loader }: Loader) => loader.loadForSelected();
const prefetch = (l: Loader) => {
	l.ag.agendaItems = [{ id: 'ev-1' } as (typeof l.ag.agendaItems)[number]];
	l.loader.prefetchNextEventPartsAfterSettle(CFG, l.seq.requestId);
};

beforeEach(() => {
	reportProblem.mockReset();
	for (const key of Object.keys(wire) as Array<keyof typeof wire>) wire[key] = never;
});

describe('agenda reads that fail are reported (#756)', () => {
	it.each([
		{
			read: 'the member lookup',
			reads: { findMyMemberId: fail },
			run: select,
			area: 'rsvp',
			action: 'finding your member record',
			shown: (l: Loader) => expect(l.ag.membership).toBe('loading')
		},
		{
			read: 'your attendance',
			reads: { findMyMemberId: () => Promise.resolve('member-1'), listMyAttendance: fail },
			run: select,
			action: 'loading your attendance'
		},
		{ read: 'your answers', reads: { listMyRsvps: fail }, run: select, action: 'loading your answers' },
		{
			read: 'the agenda',
			wire: { loadFullAgenda: fail },
			run: select,
			action: 'loading the agenda',
			shown: (l: Loader) => expect(l.ag.agendaError).toBe(true)
		},
		{
			read: 'the work rows',
			wire: { workRows: fail },
			run: (l: Loader) => l.loader.loadWorksAndManagement(CFG, ['ev-1'], 's-1', l.seq.requestId),
			action: 'loading the work rows',
			shown: (l: Loader) => expect(l.ag.worksByEventId).toEqual({})
		},
		{
			read: 'the schedule items',
			reads: { listScheduleItemsByEventId: fail },
			run: (l: Loader) => l.loader.loadScheduleItems(CFG, ['ev-1'], l.seq.requestId),
			action: 'loading the schedule items',
			shown: (l: Loader) => expect(l.ag.scheduleByEventId).toEqual({})
		},
		{
			read: 'the season rates',
			reads: { listAttendance: fail },
			run: (l: Loader) => {
				l.ag.recentItems = [{ id: 'ev-1' } as (typeof l.ag.recentItems)[number]];
				l.loader.handleExpandSeasonSummary();
			},
			action: 'loading the season attendance rates',
			shown: (l: Loader) => expect(l.ag.seasonRatesError).toBe(true)
		},
		{
			read: 'the database entity rights',
			wire: { dbEntity: fail },
			run: (l: Loader) => void l.loader.loadDatabaseEntityRights(CFG, 'person-p'),
			action: 'resolving the database entity rights'
		},
		{
			read: 'the next event',
			wire: { detail: fail },
			run: prefetch,
			action: 'prefetching the next event'
		},
		{
			read: 'the next event parts',
			wire: { parts: fail },
			run: prefetch,
			action: 'prefetching the next event parts'
		},
		{
			read: 'the roster',
			wire: { roster: fail },
			run: (l: Loader) => void l.loader.getRoster(CFG).catch(() => {}),
			action: 'loading the roster',
			shown: (l: Loader) => expect(l.ag.rosterReadFailed).toBe(true)
		},
		{
			read: 'the section tree',
			wire: { sections: fail },
			run: (l: Loader) => void l.loader.getSections(CFG).catch(() => {}),
			action: 'loading the section tree',
			shown: (l: Loader) => expect(l.ag.sectionsReadFailed).toBe(true)
		}
	] as Array<{
		read: string;
		reads?: Partial<Record<string, Read>>;
		wire?: Wire;
		run: (l: Loader) => void;
		area?: string;
		action: string;
		shown?: (l: Loader) => void;
	}>)('a failed read of $read is reported', async (row) => {
		Object.assign(wire, row.wire);
		const l = setup(row.reads);
		row.run(l);
		await settle();
		row.shown?.(l);
		expect(reportProblem.mock.calls).toEqual([
			[{ area: row.area ?? 'agenda', action: row.action, error: boom }]
		]);
	});

	it('an expired session is not reported (entuFetch already redirects)', async () => {
		wire.loadFullAgenda = () => Promise.reject(new AuthExpiredError());
		const l = setup();
		select(l);
		await settle();
		expect(l.ag.sessionExpired).toBe(true);
		expect(reportProblem).not.toHaveBeenCalled();
	});

	it('a prefetch superseded by a newer load is not reported', async () => {
		Object.assign(wire, { detail: fail, parts: fail });
		const l = setup();
		l.ag.agendaItems = [{ id: 'ev-1' } as (typeof l.ag.agendaItems)[number]];
		l.loader.prefetchNextEventPartsAfterSettle(CFG, l.seq.requestId - 1);
		await settle();
		expect(reportProblem).not.toHaveBeenCalled();
	});

	it('a read superseded by a newer load is not reported', async () => {
		let rejectFirst!: (e: unknown) => void;
		const listMyRsvps = vi
			.fn()
			.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
			.mockImplementation(never);
		const l = setup({ listMyRsvps });
		select(l);
		select(l);
		rejectFirst(boom);
		await settle();
		expect(reportProblem).not.toHaveBeenCalled();
	});
});
