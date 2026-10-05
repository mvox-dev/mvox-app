// @vitest-environment happy-dom
// #550: a write whose token is gone sends nothing and gets the 401 session-expired handling.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
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
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/profile/linkedIdentities', async (importOriginal) => ({
	...(await importOriginal<object>()),
	...(await import('$lib/testing/mocks/profile')).noLinkedIdentitiesModule(),
	...(await import('$lib/testing/mocks/admin')).joinStatesModule()
}));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);
vi.mock('$lib/nav/adminStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).adminStoreOverRealModule(importOriginal)
);
vi.mock('$lib/admin/roleManagement', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).roleManagementOverRealModule(importOriginal)
);
vi.mock('$lib/collectives/collectiveName', async (importOriginal) => ({
	...(await importOriginal<object>()),
	...(await import('$lib/testing/mocks/admin')).collectiveNameModule()
}));
vi.mock('$lib/invite/inviteData', async (importOriginal) => {
	const admin = await import('$lib/testing/mocks/admin');
	return {
		...(await importOriginal<object>()),
		resolvePersonParentId: admin.resolveParentMock,
		resolveInviteParentId: admin.resolveInviteParentMock,
		createInvite: admin.createInviteMock
	};
});

import { clearAll } from '$lib/auth/storage';
import { resetAdmin } from '$lib/nav/adminStore';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { nonGetCalls, settle } from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { gotoMock } from '$lib/testing/routeMocks';
import { q } from '$lib/testing/pages/dom';
import {
	WRITE_PAGES,
	WRITE_PAGE_HANDLES,
	must,
	renderWritable,
	stubWriteWire,
	writingPages
} from '$lib/testing/pages/writePages';

// gap: a write that still sends with the token it read at load; the case is expected to fail.
type Row = { page: string; write: (container: HTMLElement) => Promise<unknown>; gap?: string };

const library = (write: Row['write']): Row => ({ page: '/library', write });

const ROWS: Record<string, Row> = {
	'/ rsvp': {
		page: '/',
		write: (c) =>
			fireEvent.click(c.querySelector('[data-testid="agenda-row-e1"] [data-testid="rsvp-btn-going"]')!)
	},
	'/admin roles': {
		page: '/admin',
		write: (c) => fireEvent.change(must(c, 'admin-add-admin-select'), { target: { value: 'p-bela' } })
	},
	'/admin/invite create': {
		page: '/admin/invite',
		write: async (c) => {
			await fireEvent.click(must(c, 'invite-admin-submit'));
			await waitFor(() => must(c, 'session-expired'));
			expect(q(c, 'invite-admin-error')).toBeNull();
		}
	},
	'/profile save': {
		page: '/profile',
		write: async (c) => {
			await fireEvent.click(must(c, 'profile-name-edit'));
			await waitFor(() => must(c, 'profile-name'));
			await fireEvent.input(must(c, 'profile-name'), { target: { value: 'Ada L' } });
			await fireEvent.keyDown(must(c, 'profile-name'), { key: 'Enter' });
			await waitFor(() => expect(gotoMock).toHaveBeenCalled());
			expect(q(c, 'profile-load-error')).toBeNull();
		}
	},
	'/event/[id] rsvp': {
		page: '/event/[id]',
		write: (c) => fireEvent.click(must(c, 'rsvp-btn-not_going'))
	},
	'/links add': {
		page: '/links',
		gap: '#795 fix pending: posts with the load-time token',
		write: async (c) => {
			await fireEvent.input(must(c, 'links-add-name'), { target: { value: 'Scores' } });
			await fireEvent.input(must(c, 'links-add-url'), { target: { value: 'https://example.test' } });
			await fireEvent.click(must(c, 'links-add-submit'));
		}
	},
	'/roster new section': {
		page: '/roster',
		gap: '#795 fix pending: posts with the load-time token',
		write: async (c) => {
			await fireEvent.click(must(c, 'roster-new-section'));
			await waitFor(() => must(c, 'roster-new-section-name'));
			await fireEvent.input(must(c, 'roster-new-section-name'), { target: { value: 'Tenor 2' } });
			await fireEvent.click(must(c, 'roster-new-section-submit'));
		}
	},
	'/library create work': library(async (c) => {
		await fireEvent.click(must(c, 'create-work-button'));
		await waitFor(() => must(c, 'create-work-name'));
		await fireEvent.input(must(c, 'create-work-name'), { target: { value: 'Ave verum' } });
		await fireEvent.click(must(c, 'create-work-submit'));
	}),
	'/library create edition': library(async (c) => {
		await fireEvent.click(must(c, 'create-edition-button-work-1'));
		await waitFor(() => must(c, 'create-edition-name-work-1'));
		await fireEvent.input(must(c, 'create-edition-name-work-1'), { target: { value: 'Novello' } });
		await fireEvent.click(must(c, 'create-edition-submit-work-1'));
	}),
	'/library attach files': library(async (c) => {
		const file = new File(['%PDF'], 'score.pdf', { type: 'application/pdf' });
		await fireEvent.change(must(c, 'library-attach-file-edition-1'), { target: { files: [file] } });
	}),
	'/library checkout': library((c) =>
		fireEvent.change(must(c, 'inline-checkout-copy-1'), { target: { value: 'member-b' } })
	),
	'/library return': library((c) => fireEvent.click(must(c, 'library-return-copy-2'))),
	'/library bulk checkout': library(async (c) => {
		await fireEvent.change(must(c, 'bulk-checkout-edition-select'), { target: { value: 'edition-1' } });
		await waitFor(() => must(c, 'bulk-checkout-member-list'));
		await fireEvent.click(
			c.querySelector('[data-testid="bulk-checkout-member-list"] input[type="checkbox"]:not([disabled])')!
		);
		await fireEvent.click(must(c, 'bulk-checkout-submit'));
	})
};

beforeEach(() => {
	install401Recovery();
	resetTypeIdCache();
	gotoMock.mockReset();
});

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	for (const handle of WRITE_PAGE_HANDLES) handle.mockReset();
	resetAppState();
	resetGate();
	resetAdmin();
	history.replaceState({}, '', '/');
});

describe('a write with no token, on every page that writes', () => {
	it('the table covers every page whose components read the write gate', () => {
		expect([...new Set(Object.values(ROWS).map((row) => row.page))].sort()).toEqual(writingPages());
	});

	async function writeWithoutToken(name: string) {
		const row = ROWS[name];
		const fetchStub = stubWriteWire(WRITE_PAGES[row.page]);
		const { container } = await renderWritable(WRITE_PAGES[row.page], pageStub);
		await settle();
		clearAll({ preserveProvider: false });
		fetchStub.mockClear();

		await row.write(container);

		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
		await settle();
		expect(nonGetCalls(fetchStub)).toEqual([]);
	}

	const names = Object.keys(ROWS);
	it.each(names.filter((name) => !ROWS[name].gap))('%s: sends nothing and goes to session-expired', writeWithoutToken);
	it.fails.each(names.filter((name) => ROWS[name].gap))('%s: known gap (#795 fix pending), still sends; this flips red when fixed', writeWithoutToken);
});

// (*MVOX:Josquin*)
