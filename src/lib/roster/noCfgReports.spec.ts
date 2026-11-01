// @vitest-environment happy-dom
// #1049: a roster or section write that finds no usable cfg shows its error and keeps a reason.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import type { SectionNode } from '$lib/sections/sectionData';
import { createArrangeOps, createArrangeState, type ArrangeActions } from '$lib/sections/sectionArrangeOps';
import { createMemberOps, type MemberActions } from '$lib/roster/rosterMemberOps';
import { createMemberOpsState, createRosterState } from '$lib/roster/rosterPageState';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { signIn } from '$lib/testing/session';
import { resetAppState } from '$lib/testing/appReset';
import { NO_CFG } from './rosterProblems';

useKeptProblems();

const node = (id: string, parentId: string | null, children: SectionNode[] = []): SectionNode => ({
	id,
	name: id,
	displayOrder: 1,
	parentId,
	dbEntityId: null,
	depth: parentId === null ? 0 : 1,
	ownerIds: ['person-p'],
	children
});

function world(cfg: { db: string; token: string } | null) {
	const roster = createRosterState();
	roster.sections = [node('sec-sop', null, [node('sec-child', 'sec-sop')]), node('sec-alto', null)];
	roster.rows = [{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada', email: '', sectionIds: ['sec-sop'] }];
	const arrange = createArrangeState();
	const mo = createMemberOpsState();
	const common = { roster, cfg: () => cfg, generation: () => 1, isOffline: () => false };
	const arrangeOps = createArrangeOps({
		...common,
		arrange,
		actions: {} as ArrangeActions,
		visibleSections: () => roster.sections,
		currentDbEntityId: () => null,
		personId: () => 'person-p',
		canEditDb: () => true
	});
	const memberOps = createMemberOps({
		...common,
		mo,
		actions: {} as MemberActions,
		isCurrent: () => true,
		currentDbEntityId: () => null,
		loadForSelected: async () => {},
		sessionExpired: () => {},
		readRosterHalves: async () => null,
		applyRosterHalves: () => {}
	});
	return { arrange, mo, arrangeOps, memberOps };
}

type World = ReturnType<typeof world>;

const ROWS: Array<[string, (w: World) => Promise<unknown>, (w: World) => unknown, string]> = [
	['reorder', (w) => w.arrangeOps.performReorder(['sec-sop', 'sec-alto'], ['sec-alto', 'sec-sop'], 'sec-sop'), (w) => w.arrange.reorderError, 'reordering the sections'],
	['indent', (w) => w.arrangeOps.handleIndent(node('sec-alto', null)), (w) => w.arrange.reorderError, 'moving a section under another'],
	['remove', (w) => w.arrangeOps.handleRemoveSection('sec-alto'), (w) => w.arrange.removeError, 'removing a section'],
	['create', async (w) => {
		w.arrange.pageCreateName = 'Chorus';
		await w.arrangeOps.submitPageCreate();
	}, (w) => w.arrange.pageCreateError, 'creating a section'],
	['rename', async (w) => {
		w.arrange.renamingSectionId = 'sec-alto';
		w.arrange.renameValue = 'Altos';
		await w.arrangeOps.submitRename({ refocus: false });
	}, (w) => w.arrange.renameError, 'renaming a section'],
	['assign', (w) => w.memberOps.handleAssign('m-ada', 'sec-alto'), (w) => w.mo.sectionWriteError, 'assigning a member to a section'],
	['unassign', (w) => w.memberOps.handleUnassign('m-ada', 'sec-sop'), (w) => w.mo.sectionWriteError, 'taking a member out of a section'],
	['move', (w) => w.memberOps.handleMove('m-ada', 'sec-sop', 'sec-alto'), (w) => w.mo.sectionWriteError, 'moving a member']
];

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	signIn();
});

afterEach(() => {
	vi.restoreAllMocks();
	resetAppState();
});

describe('roster writes with no cfg (#1049)', () => {
	it.each(ROWS)('%s shows its error and keeps the reason', async (_, run, error, action) => {
		const w = world(null);

		await run(w);

		expect(error(w)).toBeTruthy();
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([{ area: 'roster', action, detail: NO_CFG }])
		);
	});

	it('unindent to the top level with no known collective id shows its error and keeps the reason', async () => {
		const w = world({ db: 'sampledb', token: 'jwt-abc' });

		await w.arrangeOps.handleUnindent(node('sec-child', 'sec-sop'));

		expect(w.arrange.reorderError).toBe(true);
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'roster', action: 'moving a section to the top level', detail: 'no collective (database entity) id is known' }
			])
		);
	});
});

// (*MVOX:Josquin*)
