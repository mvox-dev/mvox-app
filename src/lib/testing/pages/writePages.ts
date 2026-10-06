// Every page that writes, loaded to a writable state: the write contracts' shared page table.
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { readFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import AgendaPage from '../../../routes/+page.svelte';
import AdminPage from '../../../routes/admin/+page.svelte';
import InvitePage from '../../../routes/admin/invite/+page.svelte';
import EventPage from '../../../routes/event/[id]/+page.svelte';
import LibraryPage from '../../../routes/library/+page.svelte';
import LinksPage from '../../../routes/links/+page.svelte';
import ProfilePage from '../../../routes/profile/+page.svelte';
import RosterPage from '../../../routes/roster/+page.svelte';
import { adminStore } from '$lib/nav/adminStore';
import { completionGateStore } from '$lib/profile/completionGate';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { toListRead } from '$lib/testing/listReadFixtures';
import { pagesReaching } from '$lib/testing/pageReach';
import { signIn } from '$lib/testing/session';
import { q } from './dom';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock
} from '$lib/testing/moduleHandles';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { listActiveMembersMock, loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addAdminMock,
	createInviteMock,
	listAdminsMock,
	listJoinStatesMock,
	listLibrariansMock,
	resolveAdminMock,
	resolveCollectiveNameMarkerMock,
	resolveInviteParentMock,
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
	resolveBorrowerNamesMock,
	resolveCopyChainsMock,
	resolveCopyNamesMock,
	resolveLibrarianMock,
	resolveMyLibraryIdMock
} from '$lib/testing/mocks/library';

export type WritePage = {
	path: string;
	Page: Component;
	arrange: () => void;
	ready: (container: HTMLElement) => Promise<unknown>;
	wire?: (url: string) => unknown;
};

/** The pages whose components read the write gate: every page that can write. */
export function writingPages(): string[] {
	const readsGate = (file: string) =>
		file.endsWith('.svelte') && readFileSync(file, 'utf-8').includes("'$lib/net/online'");
	return pagesReaching(readsGate);
}

export const must = (container: HTMLElement, testid: string): HTMLElement => {
	const el = q(container, testid);
	if (!el) throw new Error(`missing ${testid}`);
	return el;
};

async function postThrough(cfg: { db: string; token: string }) {
	const { entuFetch } = await import('$lib/entu/request');
	return entuFetch(cfg.db, 'entity', cfg.token, { method: 'POST' });
}

function arrangeAdmin() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveAdminMock.mockResolvedValue('admin');
	resolveOwnerTierMock.mockResolvedValue('error');
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	listAdminsMock.mockResolvedValue({
		persons: [{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-1'] }],
		canManage: true
	});
	listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	addAdminMock.mockImplementation(postThrough);
	loadRosterMock.mockResolvedValue(
		toListRead([
			{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
			{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' }
		])
	);
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
	createInviteMock.mockImplementation(postThrough);
	listJoinStatesMock.mockResolvedValue({});
}

function arrangeAdminRights() {
	signIn();
	adminStore.set('admin');
	resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
}

function arrangeAgenda() {
	signIn();
	completionGateStore.set('complete');
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [
				{
					id: 'e1',
					name: 'Rehearsal e1',
					startDatetime: '2099-06-15T09:00:00.000Z',
					durationMinutes: 90,
					location: '',
					conductors: [],
					owners: [],
					editors: []
				}
			],
			recent: [],
			seasonId: null,
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: []
		})
	);
	findMyMemberIdMock.mockResolvedValue('member-1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
}

function arrangeLibrary() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	resolveMyLibraryIdMock.mockResolvedValue('lib-1');
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }]));
	listLendingsMock.mockResolvedValue(
		toListRead([
			{ id: 'lend-1', copyId: 'copy-2', memberId: 'member-a', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '' }
		])
	);
	resolveBorrowerNamesMock.mockResolvedValue(
		new Map([
			['member-a', 'Ada Lovelace'],
			['member-b', 'Ben Jonson']
		])
	);
	listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter' }]));
	const copies = [
		{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
		{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' }
	];
	listCopiesMock.mockResolvedValue(toListRead(copies));
	listAllEditionsMock.mockResolvedValue(
		toListRead([{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', workId: 'work-1' }])
	);
	listAllCopiesMock.mockResolvedValue(toListRead(copies));
	listActiveMembersMock.mockResolvedValue(
		toListRead([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] }
		])
	);
}

function eventWire(url: string): unknown {
	if (url.includes('/entity/rsvp-77')) {
		return { entity: { _id: 'rsvp-77', status: [{ _id: 'val-status-1' }], event: [{ reference: 'ev1' }] } };
	}
	if (url.includes('/entity/ev1')) {
		return {
			entity: {
				_id: 'ev1',
				name: [{ string: 'Tuesday Rehearsal' }],
				event_type: [{ string: 'rehearsal' }],
				start_datetime: [{ datetime: '2099-09-01T16:00:00.000Z' }],
				duration_minutes: [{ number: 90 }],
				_parent: [{ reference: 'season1', entity_type: 'season' }]
			}
		};
	}
	if (url.includes('/entity/season1')) {
		return { entity: { _id: 'season1', name: [{ string: '2099/00' }], start_date: [{ date: '2099-08-01' }] } };
	}
	if (url.includes('_type.string=rsvp') && url.includes('event.reference=ev1')) {
		return { entities: [{ _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] }] };
	}
	return undefined;
}

export const WRITE_PAGES: Record<string, WritePage> = {
	'/': {
		path: '/',
		Page: AgendaPage,
		arrange: arrangeAgenda,
		ready: (c) =>
			waitFor(() => {
				const going = c.querySelector<HTMLButtonElement>('[data-testid="agenda-row-e1"] [data-testid="rsvp-btn-going"]');
				expect(going?.disabled).toBe(false);
			})
	},
	'/admin': {
		path: '/admin',
		Page: AdminPage,
		arrange: arrangeAdmin,
		ready: (c) => waitFor(() => must(c, 'admin-add-admin-select'))
	},
	'/admin/invite': {
		path: '/admin/invite',
		Page: InvitePage,
		arrange: arrangeAdmin,
		ready: (c) => waitFor(() => expect((must(c, 'invite-admin-submit') as HTMLButtonElement).disabled).toBe(false))
	},
	'/event/[id]': {
		path: '/event/ev1',
		Page: EventPage,
		arrange: () => {
			signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }] });
			findMyMemberIdMock.mockResolvedValue('member-1');
		},
		wire: eventWire,
		ready: (c) => waitFor(() => expect(q<HTMLButtonElement>(c, 'rsvp-btn-not_going')?.disabled).toBe(false))
	},
	'/library': {
		path: '/library',
		Page: LibraryPage,
		arrange: arrangeLibrary,
		ready: async (c) => {
			await fireEvent.click(await waitFor(() => must(c, 'library-work-toggle-work-1')));
			await fireEvent.click(await waitFor(() => must(c, 'library-edition-toggle-edition-1')));
			await waitFor(() => {
				must(c, 'inline-checkout-copy-1');
				must(c, 'library-return-copy-2');
				must(c, 'bulk-checkout-edition-select');
				must(c, 'library-attach-file-edition-1');
			});
		}
	},
	'/links': {
		path: '/links',
		Page: LinksPage,
		arrange: arrangeAdminRights,
		wire: (url) =>
			url.includes('_type.string=link')
				? {
						entities: [
							{ _id: 'link-1', name: [{ string: 'Scores' }], url: [{ string: 'https://a.test' }], display_order: [{ number: 1 }] },
							{ _id: 'link-2', name: [{ string: 'Rota' }], url: [{ string: 'https://b.test' }], display_order: [{ number: 2 }] }
						]
					}
				: undefined,
		ready: (c) =>
			waitFor(() => {
				must(c, 'links-add-submit');
				expect(c.querySelectorAll('[data-testid="links-row"]')).toHaveLength(2);
			})
	},
	'/profile': {
		path: '/profile',
		Page: ProfilePage,
		arrange: () => {
			signIn({ token: 'jwt-member' });
			listMyProfilesMock.mockResolvedValue([{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }]);
		},
		ready: (c) => waitFor(() => must(c, 'profile-name-edit'))
	},
	'/roster': {
		path: '/roster',
		Page: RosterPage,
		arrange: () => {
			arrangeAdminRights();
			loadRosterMock.mockResolvedValue(
				toListRead([{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '', sectionIds: [] }])
			);
			const root = (id: string, name: string, displayOrder: number) => ({
				id,
				name,
				displayOrder,
				parentId: null,
				dbEntityId: 'org-1',
				depth: 0,
				children: []
			});
			listSectionsMock.mockResolvedValue([root('sec-s', 'Soprano', 1), root('sec-a', 'Alto', 2)]);
		},
		wire: (url) =>
			url.includes('/entity/sec-a?props=_parent')
				? { entity: { _id: 'sec-a', _parent: [{ _id: 'pv-a', reference: 'org-1' }] } }
				: undefined,
		ready: async (c) => {
			await fireEvent.click(await waitFor(() => must(c, 'roster-view-chip-arrange')));
			await waitFor(() => {
				must(c, 'roster-new-section');
				must(c, 'arrange-row-sec-a');
			});
		}
	}
};

/** The handles the table arranges; reset after each case so no answer outlives it. */
export const WRITE_PAGE_HANDLES = [
	addAdminMock,
	createInviteMock,
	findMyMemberIdMock,
	listActiveMembersMock,
	listAdminsMock,
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listJoinStatesMock,
	listLendingsMock,
	listLibrariansMock,
	listMyProfilesMock,
	listMyRsvpsMock,
	listSectionsMock,
	listWorksMock,
	loadFullAgendaMock,
	loadRosterMock,
	resolveAdminMock,
	resolveBorrowerNamesMock,
	resolveCollectiveNameMarkerMock,
	resolveCopyChainsMock,
	resolveCopyNamesMock,
	resolveDatabaseEntityIdMock,
	resolveInviteParentMock,
	resolveLibrarianMock,
	resolveMyLibraryIdMock,
	resolveOwnerTierMock,
	resolveParentMock
];

/** A 200 wire: the page's own routes first, then type ids, then empty lists. */
export function stubWriteWire(page: WritePage): ReturnType<typeof vi.fn<typeof fetch>> {
	const fetchStub = vi.fn<typeof fetch>(async (input) => {
		const url = String(input);
		const typeName = new URL(url).searchParams.get('name.string');
		const body = page.wire?.(url) ?? (typeName ? { entities: [{ _id: `type-${typeName}` }] } : { entities: [] });
		return new Response(JSON.stringify(body), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchStub);
	return fetchStub;
}

/** Arranges and renders `page` at its path, resolved once it is writable. */
export async function renderWritable(page: WritePage, pageStub: { url: URL }) {
	resolveDatabaseEntityIdMock.mockResolvedValue(null);
	listSectionsMock.mockResolvedValue([]);
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	pageStub.url = new URL(`http://localhost${page.path}`);
	history.replaceState({}, '', page.path);
	page.arrange();
	const utils = render(page.Page);
	await page.ready(utils.container);
	return utils;
}
