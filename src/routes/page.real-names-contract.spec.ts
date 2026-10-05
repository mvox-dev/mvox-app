// @vitest-environment happy-dom
// Every page that names members obeys roster_show_real_names: one toggle read, one records read.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceListsOverRealModule(importOriginal)
);
vi.mock('$lib/rsvp/rsvpData', async (importOriginal) => {
	const handles = await import('$lib/testing/moduleHandles');
	return {
		...(await importOriginal<object>()),
		findMyMemberId: handles.findMyMemberIdMock,
		listMyRsvps: handles.listMyRsvpsMock
	};
});
vi.mock('$lib/admin/roleManagement', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).roleManagementOverRealModule(importOriginal)
);
vi.mock('$lib/nav/adminStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).adminStoreOverRealModule(importOriginal)
);
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule({ libraryId: false })
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', async (importOriginal) => ({
	...(await importOriginal<object>()),
	...(await import('$lib/testing/mocks/admin')).collectiveNameModule()
}));
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteDataOverRealModule(importOriginal)
);
vi.mock('$lib/library/libraryData', async (importOriginal) => {
	const library = await import('$lib/testing/mocks/library');
	return {
		...(await importOriginal<object>()),
		listWorks: library.listWorksMock,
		listEditions: library.listEditionsMock,
		listCopies: library.listCopiesMock,
		listAllEditions: library.listAllEditionsMock,
		listAllCopies: library.listAllCopiesMock,
		listLendings: library.listLendingsMock,
		resolveCopyNames: library.resolveCopyNamesMock,
		resolveCopyChains: library.resolveCopyChainsMock
	};
});

import AgendaPage from './+page.svelte';
import AdminPage from './admin/+page.svelte';
import EventPage from './event/[id]/+page.svelte';
import LibraryPage from './library/+page.svelte';
import RosterPage from './roster/+page.svelte';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { q } from '$lib/testing/pages/dom';
import { agendaItem } from '$lib/testing/pages/agenda';
import { pagesReaching } from '$lib/testing/pageReach';
import { DB_ENTITY_ID, PROFILE_NAMES, REAL_NAMES, realNamesWire } from '$lib/testing/realNamesFence';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import {
	listAllRsvpsForEventMock,
	listAttendanceMock,
	listMyAttendanceMock
} from '$lib/testing/mocks/events';
import {
	listAdminsMock,
	listLibrariansMock,
	resolveAdminMock,
	resolveCollectiveNameMarkerMock,
	resolveLibrarianMock,
	resolveOwnerTierMock,
	resolveParentMock
} from '$lib/testing/mocks/admin';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveCopyChainsMock,
	resolveCopyNamesMock
} from '$lib/testing/mocks/library';

type Member = keyof typeof REAL_NAMES;

type Row = {
	route: string;
	Page: Component;
	members: Member[];
	arrange: () => void;
	extra?: (url: string) => unknown;
	/** Brings the names on screen; returns where they show and how many requests came before. */
	open: (container: HTMLElement, calls: () => number) => Promise<{ region: HTMLElement; from: number }>;
};

// The real-name producer's callers; a page that reaches one names members.
const PRODUCER = /import\s*\{[^}]*\b(loadRoster|resolveRealNameByPerson|applyRealNames)\b[^}]*\}\s*from\s*['"](\$lib\/roster\/rosterData|\.\/rosterData)['"]/;

const NAMES_NO_MEMBER: Record<string, string> = {
	'/profile': 'imports libraryData for its edition list only; it names no other member'
};

const until = async (container: HTMLElement, testid: string) => {
	await waitFor(() => expect(q(container, testid)).not.toBeNull());
	return q(container, testid)!;
};

async function openAttendancePanel(container: HTMLElement, calls: () => number) {
	await until(container, 'take-attendance-btn');
	const from = calls();
	await fireEvent.click(q(container, 'take-attendance-btn')!);
	await until(container, 'attendance-row-m1');
	return { region: await until(container, 'attendance-panel'), from };
}

const ROWS: Record<string, Row> = {
	'/ attendance panel': {
		route: '/',
		Page: AgendaPage,
		members: ['m1', 'm2'],
		arrange: () => {
			loadFullAgendaMock.mockResolvedValue(
				fullAgendaResult({
					seasons: [],
					upcoming: [],
					recent: [{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z'), editors: ['person-p'] }],
					seasonId: 's1',
					seasonConductors: ['person-p'],
					seasonOwners: [],
					seasonEditors: []
				})
			);
		},
		open: async (container, calls) => ({ ...(await openAttendancePanel(container, calls)), from: 0 })
	},
	'/ season summary': {
		route: '/',
		Page: AgendaPage,
		members: ['m1', 'm2', 'm9'],
		arrange: () => {
			loadFullAgendaMock.mockResolvedValue(
				fullAgendaResult({
					seasons: [],
					upcoming: [],
					recent: [
						agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
						agendaItem('past-2', '2026-06-03T16:00:00.000Z')
					],
					seasonId: 's1',
					seasonConductors: [],
					seasonOwners: ['person-p'],
					seasonEditors: []
				})
			);
			findMyMemberIdMock.mockResolvedValue('m1');
			listAttendanceMock.mockResolvedValue([
				{ attendanceId: 'a1', memberId: 'm1', status: 'present' },
				{ attendanceId: 'a2', memberId: 'm9', status: 'present' }
			]);
		},
		open: async (container, calls) => {
			await fireEvent.click(await until(container, 'season-summary-expand'));
			const from = calls();
			await until(container, 'member-rate-m1');
			await until(container, 'member-rate-inactive-m9');
			return { region: await until(container, 'season-summary-members'), from };
		}
	},
	'/admin pickers': {
		route: '/admin',
		Page: AdminPage,
		members: ['m1', 'm2'],
		arrange: () => {
			resolveAdminMock.mockResolvedValue('admin');
			resolveOwnerTierMock.mockResolvedValue('owner');
			listAdminsMock.mockResolvedValue({ persons: [], canManage: true });
			listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
			resolveParentMock.mockResolvedValue(DB_ENTITY_ID);
			resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
		},
		open: async (container) => {
			await waitFor(() => {
				const select = q<HTMLSelectElement>(container, 'admin-add-admin-select');
				expect(select?.querySelectorAll('option').length).toBeGreaterThan(1);
			});
			await until(container, 'invite-person-select');
			return { region: container, from: 0 };
		}
	},
	'/roster rows': {
		route: '/roster',
		Page: RosterPage,
		members: ['m1', 'm2'],
		arrange: () => adminStore.set('admin'),
		// The section picker's labels keep the profile name by a stated choice; the row names obey.
		open: async (container) => {
			await fireEvent.click(await until(container, 'section-toggle-unassigned'));
			await until(container, 'roster-row-m2');
			const names = document.createElement('div');
			names.textContent = [...container.querySelectorAll('[data-testid="roster-row-name"]')]
				.map((span) => span.textContent)
				.join(' ');
			return { region: names, from: 0 };
		}
	},
	'/event/[id] attendance panel': {
		route: '/event/ev1',
		Page: EventPage,
		members: ['m1', 'm2'],
		arrange: () => {},
		extra: (url) => {
			if (url.includes('/entity/ev1')) {
				return {
					entity: {
						_id: 'ev1',
						name: [{ string: 'Tuesday Rehearsal' }],
						event_type: [{ string: 'rehearsal' }],
						start_datetime: [{ datetime: '2026-01-13T16:00:00.000Z' }],
						duration_minutes: [{ number: 90 }],
						_editor: [{ reference: 'person-p' }],
						_parent: [{ reference: 'season1', entity_type: 'season' }]
					}
				};
			}
			if (url.includes('/entity/season1')) {
				return { entity: { _id: 'season1', name: [{ string: '2025/26' }], conductor: [{ reference: 'person-p' }] } };
			}
			return undefined;
		},
		open: openAttendancePanel
	},
	'/library borrower': {
		route: '/library',
		Page: LibraryPage,
		members: ['m1'],
		arrange: () => {
			resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
			listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Tallis' }]));
			listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: 'Original', publisher: 'B' }]));
			const copies = [{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }];
			listCopiesMock.mockResolvedValue(toListRead(copies));
			listAllEditionsMock.mockResolvedValue(
				toListRead([{ id: 'edition-1', name: 'Original', publisher: 'B', workId: 'work-1' }])
			);
			listAllCopiesMock.mockResolvedValue(toListRead(copies));
			listLendingsMock.mockResolvedValue(
				toListRead([
					{ id: 'lend-1', copyId: 'copy-1', memberId: 'm1', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
				])
			);
			resolveCopyNamesMock.mockResolvedValue(new Map());
			resolveCopyChainsMock.mockResolvedValue(new Map());
		},
		extra: (url) =>
			url.includes('/entity/m1?props=person') ? { entity: { person: [{ reference: 'person-p' }] } } : undefined,
		open: async (container) => {
			await fireEvent.click(await until(container, 'library-work-toggle-work-1'));
			await fireEvent.click(await until(container, 'library-edition-toggle-edition-1'));
			await waitFor(() => expect(container.textContent).toContain('Copy #1'));
			return { region: container, from: 0 };
		}
	}
};

function renderRow(row: Row, toggle: boolean) {
	const wire = realNamesWire({ toggle, extra: row.extra });
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }] });
	completionGateStore.set('complete');
	row.arrange();
	pageStub.url = new URL(`http://localhost${row.route}`);
	history.replaceState({}, '', row.route);
	const { container } = render(row.Page);
	const urls = (from: number) => wire.mock.calls.slice(from).map((call) => String(call[0]));
	return { container, wire, urls };
}

const reads = (urls: string[], needle: string) => urls.filter((url) => url.includes(needle)).length;

beforeEach(() => {
	resetTypeIdCache();
	listSectionsMock.mockResolvedValue([]);
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(toListRead([]));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetAppState();
	resetGate();
	resetAdmin();
	history.replaceState({}, '', '/');
});

describe('real names, on every page that names members', () => {
	it('the table covers every page that reaches the real-name producer', () => {
		const derived = pagesReaching((file) => PRODUCER.test(readFileSync(file, 'utf-8')));
		const routes = Object.values(ROWS).map((row) => row.route.replace('/ev1', '/[id]'));
		expect(derived).toEqual(expect.arrayContaining(Object.keys(NAMES_NO_MEMBER)));
		expect([...new Set(routes)].sort()).toEqual(
			derived.filter((page) => !(page in NAMES_NO_MEMBER))
		);
	});

	it.each(Object.keys(ROWS))('%s: toggle ON shows the real names, never the profile names', async (name) => {
		const row = ROWS[name];
		const { container, wire } = renderRow(row, true);
		const { region } = await row.open(container, () => wire.mock.calls.length);

		await waitFor(() => {
			for (const member of row.members) expect(region.textContent).toContain(REAL_NAMES[member]);
		});
		for (const member of row.members) expect(region.textContent).not.toContain(PROFILE_NAMES[member]);
	});

	it.each(Object.keys(ROWS))('%s: toggle ON costs one toggle read and one records read', async (name) => {
		const row = ROWS[name];
		const { container, wire, urls } = renderRow(row, true);
		const { region, from } = await row.open(container, () => wire.mock.calls.length);
		await waitFor(() => expect(region.textContent).toContain(REAL_NAMES[row.members[0]]));

		expect(reads(urls(from), 'roster_show_real_names')).toBe(1);
		expect(reads(urls(from), 'admin_member_record')).toBe(1);
	});

	it.each(Object.keys(ROWS))('%s: toggle OFF shows profile names on one toggle read and no records read', async (name) => {
		const row = ROWS[name];
		const { container, wire, urls } = renderRow(row, false);
		const { region, from } = await row.open(container, () => wire.mock.calls.length);

		await waitFor(() => {
			for (const member of row.members) expect(region.textContent).toContain(PROFILE_NAMES[member]);
		});
		for (const member of row.members) expect(container.textContent).not.toContain(REAL_NAMES[member]);
		expect(reads(urls(from), 'admin_member_record')).toBe(0);
		expect(reads(urls(from), 'roster_show_real_names')).toBe(1);
	});
});

// (*MVOX:Josquin*)
