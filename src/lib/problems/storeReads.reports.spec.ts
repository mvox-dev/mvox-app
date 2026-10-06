// @vitest-environment happy-dom
// #756: the library, roster, admin, profile and collective reads report a failure.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/files/appByteStore', async () =>
	(await import('$lib/testing/mocks/files')).fakeAppByteStoreModule()
);
const page = vi.hoisted(() => {
	const pending = () => new Promise<never>(() => {});
	return {
		editions: pending as () => Promise<unknown>,
		state: pending as () => Promise<unknown>,
		pickers: pending as () => Promise<unknown>,
		names: pending as () => Promise<unknown>
	};
});
vi.mock('$lib/library/libraryPageData', () => ({
	loadLibraryEditions: () => page.editions(),
	loadLibraryCopies: () => page.editions(),
	loadLibrarianState: () => page.state(),
	loadLibrarianPickers: () => page.pickers(),
	loadLibrarianMemberNames: () => page.names()
}));

import { resolveLibrarian } from '$lib/library/librarianStore';
import { createLibrarianLoad, createLibraryTreeLoads } from '$lib/library/libraryPageLoads';
import { createLibraryState } from '$lib/library/libraryState';
import { resolveAdmin, resolveOwnerTier } from '$lib/nav/adminStore';
import { resolveGate } from '$lib/profile/completionGate';
import { resolveMembership } from '$lib/collective/membershipStore';
import { checkCollectiveMarker } from '$lib/collectives/marker';
import { resolveRealNameByPerson } from '$lib/roster/rosterData';
import { ensureRetentionSweep, resetRetentionForTests } from '$lib/files/retention';
import { createRestoreSections } from '$lib/sections/sectionArrangeRestore';
import { createDeactivateOps } from '$lib/roster/rosterDeactivateOps';
import { createRecordOps } from '$lib/roster/rosterRecordOps';
import type { MemberOpsDeps } from '$lib/roster/rosterMemberOps';
import { createMemberOpsState, createRosterState } from '$lib/roster/rosterPageState';
import type { RosterRow } from '$lib/roster/rosterData';
import { setToken } from '$lib/auth/storage';
import { testCfg } from '$lib/testing/entuFetchKit';
import { reportProblem } from '$lib/testing/mocks/session';

const CFG = testCfg('sampledb', 'jwt-1');
const SELECTED = { db: 'sampledb', personId: 'person-p' };
const boom = new Error('read broke');
const fail = () => Promise.reject(boom);
const failFetch = vi.fn(fail) as unknown as typeof fetch;
const settle = () => new Promise((r) => setTimeout(r, 0));

function memberDeps(actions: object, current = () => true) {
	return {
		roster: createRosterState(),
		mo: createMemberOpsState(),
		actions,
		cfg: () => CFG,
		generation: () => 0,
		isCurrent: current,
		isOffline: () => false,
		readRosterHalves: fail
	} as unknown as MemberOpsDeps<unknown>;
}

function librarian(stage: 'pickers' | 'names') {
	page.state = () => Promise.resolve({ state: 'librarian', libraryId: 'lib-1' });
	page.pickers =
		stage === 'pickers'
			? fail
			: () =>
					Promise.resolve({
						editions: { items: [], truncated: false },
						copies: { items: [], truncated: false },
						members: { items: [], truncated: false }
					});
	return createLibrarianLoad(createLibraryState());
}

beforeEach(() => {
	reportProblem.mockReset();
	resetRetentionForTests();
	setToken('jwt-1');
});

describe('a failed store read is reported (#756)', () => {
	it.each([
		{
			read: 'the librarian rights',
			run: () => resolveLibrarian(CFG, 'person-p', failFetch),
			area: 'library',
			action: 'reading the librarian rights'
		},
		{
			read: 'the admin rights',
			run: () => resolveAdmin(CFG, 'person-p', failFetch, 'db-entity'),
			area: 'admin',
			action: 'reading the admin rights'
		},
		{
			read: 'the owner tier',
			run: () => resolveOwnerTier(CFG, 'person-p', failFetch, 'db-entity'),
			area: 'admin',
			action: 'reading the owner tier'
		},
		{
			read: 'the completion gate',
			run: () => resolveGate(CFG, 'person-p', failFetch),
			area: 'profile',
			action: 'reading your profiles for the completion gate'
		},
		{
			read: 'the membership',
			run: () => resolveMembership(CFG, 'person-p', failFetch),
			area: 'membership',
			action: 'reading your membership'
		},
		{
			read: 'the collective marker',
			run: () => checkCollectiveMarker('sampledb', 'person-p', 'jwt-1', failFetch),
			area: 'collectives',
			action: 'checking a database for the collective marker'
		},
		{
			read: 'the real-names overlay',
			run: () => resolveRealNameByPerson(CFG, failFetch),
			area: 'roster',
			action: 'loading the real-names overlay'
		},
		{
			read: 'the protected set',
			run: () =>
				ensureRetentionSweep({ token: 'jwt-1', collectives: [SELECTED], fetchImpl: failFetch }),
			area: 'retention',
			action: 'reading the protected set'
		},
		{
			read: 'the sections after a failed write',
			run: () =>
				createRestoreSections({
					roster: { sections: [] },
					actions: { listSections: fail },
					generation: () => 0
				} as never)(CFG, 0, () => [], 'rename'),
			area: 'roster',
			action: 're-reading the sections after a failed rename'
		},
		{
			read: 'the inactive roster',
			run: () => createDeactivateOps(memberDeps({})).toggleInactive(),
			area: 'roster',
			action: 'loading the inactive roster'
		},
		{
			read: 'the member record',
			run: () =>
				createRecordOps(memberDeps({ loadMemberRecord: fail })).openRecordEditor({
					memberId: 'm-1',
					personId: 'p-1'
				} as RosterRow),
			area: 'roster',
			action: 'loading the member record'
		},
		{
			read: 'the editions of a work',
			run: () => {
				page.editions = fail;
				const lib = createLibraryState();
				const ctx = { selected: () => SELECTED, lib, setStatus: () => {} };
				return createLibraryTreeLoads(ctx as never).loadEditionsFor('work-1');
			},
			area: 'library',
			action: 'loading the editions'
		},
		{
			read: 'the checkout data',
			run: () => librarian('pickers').select(SELECTED),
			area: 'library',
			action: 'loading the checkout data'
		},
		{
			read: 'the member names',
			run: () => {
				page.names = fail;
				librarian('names').select(SELECTED);
			},
			area: 'library',
			action: 'loading the member names'
		}
	])('a failed read of $read is reported', async ({ run, area, action }) => {
		await run();
		await settle();
		expect(reportProblem.mock.calls).toEqual([[{ area, action, error: boom }]]);
	});

	it('a checkout read superseded by a collective switch is not reported', async () => {
		let rejectPickers!: (e: unknown) => void;
		const load = librarian('names');
		page.pickers = () => new Promise((_, reject) => (rejectPickers = reject));
		load.select(SELECTED);
		await settle();
		load.select(null);
		rejectPickers(boom);
		await settle();
		expect(reportProblem).not.toHaveBeenCalled();
	});

	it('a member record read for a closed editor is not reported', async () => {
		const ops = createRecordOps(memberDeps({ loadMemberRecord: fail }, () => false));
		await ops.openRecordEditor({ memberId: 'm-1', personId: 'p-1' } as RosterRow);
		await settle();
		expect(reportProblem).not.toHaveBeenCalled();
	});
});
