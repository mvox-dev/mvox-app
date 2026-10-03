// @vitest-environment happy-dom
// #550: admin roles write and invite create with no token send nothing and expire the session.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const h = vi.hoisted(() => {
	class InviteCreateError extends Error {
		readonly phase: string;
		readonly reason: string;
		constructor(message: string, opts: { phase: string; reason: string }) {
			super(message);
			this.name = 'InviteCreateError';
			this.phase = opts.phase;
			this.reason = opts.reason;
		}
	}
	return {
		InviteCreateError,
		gotoMock: vi.fn(),
		postThrough: async (cfg: { db: string; token: string }) => {
			const { entuFetch } = await import('$lib/entu/request');
			return entuFetch(cfg.db, 'entity', cfg.token, { method: 'POST' });
		}
	};
});
vi.mock('$lib/admin/roleManagement', () => ({
	RoleLockoutError: class extends Error {},
	RoleGrantMissingError: class extends Error {},
	fetchRights: vi.fn(),
	listAdmins: vi.fn().mockResolvedValue({
		persons: [{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-1'] }],
		canManage: true
	}),
	addAdmin: vi.fn(h.postThrough),
	removeAdmin: vi.fn(),
	listLibrarians: vi.fn().mockResolvedValue({ persons: [], canManage: true }),
	addLibrarian: vi.fn(),
	removeLibrarian: vi.fn()
}));
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: vi.fn().mockResolvedValue('admin'),
	resolveOwnerTier: vi.fn().mockResolvedValue('error')
}));
vi.mock('$lib/library/librarianStore', () => ({
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' })
}));
vi.mock('$lib/profile/linkedIdentities', () => ({ listJoinStates: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/collective/databaseEntity', () => ({
	resolveDatabaseEntityId: vi.fn().mockResolvedValue('org-1')
}));
vi.mock('$lib/roster/rosterData', async () => {
	const { toListRead } = await import('$lib/testing/listReadFixtures');
	return {
		loadRoster: vi.fn().mockResolvedValue(
			toListRead([
				{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
				{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' }
			])
		)
	};
});
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: vi.fn().mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' }),
	updateCollectiveName: vi.fn()
}));
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: vi.fn().mockResolvedValue('parent-1'),
	resolveInviteParentId: vi.fn().mockResolvedValue('org-1'),
	createInvite: vi.fn(h.postThrough)
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: h.gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import AdminPage from './admin/+page.svelte';
import InvitePage from './admin/invite/+page.svelte';
import { clearAll } from '$lib/auth/storage';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { nonGetCalls, settle } from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

let fetchStub: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
	fetchStub = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetchStub);
	install401Recovery();
	h.gotoMock.mockReset();
	history.replaceState({}, '', '/admin');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	resetAppState();
	history.replaceState({}, '', '/');
});

async function expectSessionExpiredAndNothingSent() {
	await waitFor(() => expect(h.gotoMock).toHaveBeenCalledTimes(1));
	expect(String(h.gotoMock.mock.calls[0][0])).toContain('session_expired');
	await settle();
	expect(nonGetCalls(fetchStub)).toEqual([]);
}

describe('#550 — admin writes with no token', () => {
	it('a roles write whose token vanished after load sends nothing and goes to session-expired', async () => {
		selectSampledb();
		const { container } = render(AdminPage);
		await waitFor(() => expect(q(container, 'admin-add-admin-select')).not.toBeNull());
		clearAll({ preserveProvider: false });

		await fireEvent.change(q<HTMLSelectElement>(container, 'admin-add-admin-select')!, {
			target: { value: 'p-bela' }
		});
		await expectSessionExpiredAndNothingSent();
	});

	it('an invite create with no token shows the session-expired notice, not a create error', async () => {
		selectSampledb();
		const { container } = render(InvitePage);
		await waitFor(() => {
			expect(q<HTMLButtonElement>(container, 'invite-admin-submit')?.disabled).toBe(false);
		});
		clearAll({ preserveProvider: false });

		await fireEvent.click(q<HTMLButtonElement>(container, 'invite-admin-submit')!);
		await waitFor(() => expect(q(container, 'session-expired')).not.toBeNull());
		expect(q(container, 'invite-admin-error')).toBeNull();
		await expectSessionExpiredAndNothingSent();
	});
});

// (*MVOX:Josquin*)
