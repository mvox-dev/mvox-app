// @vitest-environment happy-dom
// A page whose own list read comes back partial says so; the fact never outlives its collective.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
const pageStub = vi.hoisted(() => ({ params: { id: 'ev1' }, url: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/mocks/events')).attendanceHandlesModule({
		lists: true,
		writes: false,
		mine: 'handle'
	})
);
vi.mock('$lib/rsvp/rsvpData', async (importOriginal) => {
	const handles = await import('$lib/testing/moduleHandles');
	return {
		...(await importOriginal<object>()),
		findMyMemberId: handles.findMyMemberIdMock,
		listMyRsvps: handles.listMyRsvpsMock
	};
});
vi.mock('$lib/roster/rosterData', async (importOriginal) => {
	const roster = await import('$lib/testing/mocks/roster');
	return {
		...(await roster.rosterOverRealModule(importOriginal)),
		listActiveMembers: roster.listActiveMembersMock
	};
});
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule({ libraryId: false })
);

import AgendaPage from './+page.svelte';
import EventPage from './event/[id]/+page.svelte';
import LibraryPage from './library/+page.svelte';
import RosterPage from './roster/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { deferred } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { q } from '$lib/testing/pages/dom';
import { DB_A, DB_B, complete, truncated } from '$lib/testing/pages/agenda';
import { pagesReaching } from '$lib/testing/pageReach';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock
} from '$lib/testing/moduleHandles';
import {
	listAllRsvpsForEventMock,
	listAttendanceMock,
	listMyAttendanceMock
} from '$lib/testing/mocks/events';
import { listActiveMembersMock, loadRosterMock } from '$lib/testing/mocks/roster';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveCopyChainsMock,
	resolveCopyNamesMock,
	resolveLibrarianMock
} from '$lib/testing/mocks/library';

type Row = {
	route: string;
	Page: Component;
	notice: string;
	key: string;
	read: Mock;
	items: unknown[];
	ready: (container: HTMLElement) => Promise<unknown>;
	switches: boolean;
};

const MEMBER = { memberId: 'member-1', personId: 'p-ada', name: 'Ada Lovelace', email: '', sectionIds: [] };

const agendaReady = (c: HTMLElement) => waitFor(() => expect(q(c, 'agenda-skeleton')).toBeNull());
const libraryReady = (c: HTMLElement) =>
	waitFor(() => expect(q(c, 'library-work-toggle-work-1')).not.toBeNull());

const ROWS: Record<string, Row> = {
	'/ own answers': {
		route: '/',
		Page: AgendaPage,
		notice: 'rsvp-partial-notice',
		key: 'rsvp_partial_notice',
		read: listMyRsvpsMock,
		items: [{ rsvpId: 'rsvp-1', eventId: 'event-1', status: 'going' }],
		ready: agendaReady,
		switches: true
	},
	'/ own attendance': {
		route: '/',
		Page: AgendaPage,
		notice: 'attendance-partial-notice',
		key: 'attendance_partial_notice',
		read: listMyAttendanceMock,
		items: [{ attendanceId: 'att-1', eventId: 'event-1', status: 'present' }],
		ready: agendaReady,
		switches: true
	},
	'/library works': {
		route: '/library',
		Page: LibraryPage,
		notice: 'library-partial-notice',
		key: 'library_partial_notice',
		read: listWorksMock,
		items: [{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }],
		ready: libraryReady,
		switches: true
	},
	'/library lendings': {
		route: '/library',
		Page: LibraryPage,
		notice: 'library-partial-notice',
		key: 'library_partial_notice',
		read: listLendingsMock,
		items: [],
		ready: libraryReady,
		switches: true
	},
	'/roster members': {
		route: '/roster',
		Page: RosterPage,
		notice: 'roster-partial-notice',
		key: 'roster_partial_notice',
		read: loadRosterMock,
		items: [MEMBER],
		ready: (c) => waitFor(() => expect(q(c, 'section-toggle-unassigned')).not.toBeNull()),
		switches: true
	},
	'/event/[id] attendance panel': {
		route: '/event/ev1',
		Page: EventPage,
		notice: 'attendance-panel-partial-notice',
		key: 'picker_partial_members_notice',
		read: loadRosterMock,
		items: [MEMBER],
		ready: async (c) => {
			await waitFor(() => expect(q(c, 'take-attendance-btn')).not.toBeNull());
			await fireEvent.click(q(c, 'take-attendance-btn')!);
			await waitFor(() => expect(q(c, 'attendance-row-member-1')).not.toBeNull());
		},
		switches: false
	}
};

function eventWire(url: string): unknown {
	if (url.includes('/entity/ev1')) {
		return {
			entity: {
				_id: 'ev1',
				name: [{ string: 'Tuesday Rehearsal' }],
				event_type: [{ string: 'rehearsal' }],
				start_datetime: [{ datetime: '2026-01-13T16:00:00.000Z' }],
				duration_minutes: [{ number: 90 }],
				_editor: [{ reference: 'p-viewer' }],
				_parent: [{ reference: 'season1', entity_type: 'season' }]
			}
		};
	}
	if (url.includes('/entity/season1')) {
		return {
			entity: {
				_id: 'season1',
				name: [{ string: '2025/26' }],
				start_date: [{ date: '2025-08-01' }],
				conductor: [{ reference: 'p-viewer' }]
			}
		};
	}
	return { entities: [] };
}

function arrangeComplete() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(eventWire(String(input)))))
	);
	adminStore.set('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	listSectionsMock.mockResolvedValue([]);
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({ seasons: [], upcoming: [], recent: [], seasonId: null, seasonConductors: [] })
	);
	findMyMemberIdMock.mockResolvedValue('member-1');
	listMyRsvpsMock.mockResolvedValue(complete([]));
	listMyAttendanceMock.mockResolvedValue(complete([]));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	loadRosterMock.mockResolvedValue(complete([MEMBER]));
	listActiveMembersMock.mockResolvedValue(complete([]));
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	listWorksMock.mockResolvedValue(complete(ROWS['/library works'].items));
	for (const read of [listLendingsMock, listEditionsMock, listCopiesMock, listAllEditionsMock, listAllCopiesMock]) {
		read.mockResolvedValue(complete([]));
	}
	for (const names of [resolveBorrowerNamesMock, resolveCopyNamesMock, resolveCopyChainsMock]) {
		names.mockResolvedValue(new Map());
	}
}

function renderRow(row: Row) {
	pageStub.url = new URL(`http://localhost${row.route}`);
	history.replaceState({}, '', row.route);
	return render(row.Page);
}

function expectVisibleNotice(container: HTMLElement, row: Row) {
	const el = q(container, row.notice)!;
	expect(el.getAttribute('role')).toBe('status');
	expect(el.className).not.toMatch(/sr-only|hidden/);
	expect(el.getAttribute('aria-hidden')).not.toBe('true');
	expect(el.textContent).toContain(row.key);
}

beforeEach(() => {
	resetTypeIdCache();
	arrangeComplete();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
	history.replaceState({}, '', '/');
});

describe('a partial list read, on every page that can show one', () => {
	it('the table covers every page that renders the partial notice', () => {
		const routes = Object.values(ROWS).map((row) => row.route.replace('/ev1', '/[id]'));
		expect([...new Set(routes)].sort()).toEqual(pagesReaching('src/lib/components/PartialNotice.svelte'));
	});

	it.each(Object.keys(ROWS))('%s: a truncated read shows a visible role=status notice', async (name) => {
		const row = ROWS[name];
		row.read.mockResolvedValue(truncated(row.items, 600));
		signIn({ collectives: [{ db: DB_A, name: 'Sampledb', personId: 'p-viewer' }] });

		const { container } = renderRow(row);

		await row.ready(container);
		await waitFor(() => expect(q(container, row.notice)).not.toBeNull());
		expectVisibleNotice(container, row);
	});

	it.each(Object.keys(ROWS))('%s: a complete read leaves the notice absent', async (name) => {
		const row = ROWS[name];
		row.read.mockResolvedValue(complete(row.items));
		signIn({ collectives: [{ db: DB_A, name: 'Sampledb', personId: 'p-viewer' }] });

		const { container } = renderRow(row);

		await row.ready(container);
		await waitFor(() => expect(row.read).toHaveBeenCalled());
		expect(q(container, row.notice)).toBeNull();
	});

	const switching = Object.keys(ROWS).filter((name) => ROWS[name].switches);
	it.each(switching)('%s: the notice is gone as soon as the collective switches', async (name) => {
		const row = ROWS[name];
		const bRead = deferred<unknown>();
		row.read.mockImplementation((cfg: { db: string }) =>
			cfg.db === DB_A ? Promise.resolve(truncated(row.items, 600)) : bRead.promise
		);
		signIn({
			collectives: [
				{ db: DB_A, name: 'Sampledb', personId: 'p-viewer' },
				{ db: DB_B, name: 'Other Choir', personId: 'p-other' }
			]
		});
		const { container } = renderRow(row);
		await waitFor(() => expect(q(container, row.notice)).not.toBeNull());

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => {
			expect(row.read.mock.calls.some(([cfg]) => cfg?.db === DB_B)).toBe(true);
			expect(q(container, row.notice)).toBeNull();
		});

		bRead.resolve(complete(row.items));
		await bRead.promise;
		await waitFor(() => expect(q(container, row.notice)).toBeNull());
	});
});

// (*MVOX:Tallis* — RED spec, #321)
// (*MVOX:Josquin* — #321 review F1/F2: roster, season_manage, season_summary notices)
// (*MVOX:Josquin*)
