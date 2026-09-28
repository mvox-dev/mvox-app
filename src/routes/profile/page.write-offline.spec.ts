// @vitest-environment happy-dom
//
// #434 slice 6/6 review F1 — /profile writes are gated while offline, on the
// REAL page (harness: src/routes/page.profile.spec.ts — the profile read and the
// save primitive are module-mocked, so "no write" is observable).
//
// THE FINDING, and why this page is the awkward one: its main write has NO
// BUTTON. A 2-second idle autosave fires on its own, with no user click to
// disable — so the gate had to land in `onAutosave` itself (nothing writes) and
// in `handleValueChange` (nothing is even scheduled), not only on controls.
//
// CONTRACT — a loaded profile, the signal offline:
//   • ONE visible sentence [data-testid="profile-write-unavailable"];
//   • the whole-field activators, the visibility buttons, the roster-names
//     toggle and the account-link controls are disabled;
//   • an editor already open keeps its typed text, and NEITHER the 2s idle timer
//     NOR a blur writes anything (nothing queued — no retry when the signal
//     returns either);
//   • back online: enabled again, the sentence gone, an edit autosaves.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const h = vi.hoisted(() => {
	class ProfileSaveError extends Error {}
	return {
		ProfileSaveError,
		listMyProfilesMock: vi.fn(),
		applyProfileSaveMock: vi.fn(),
		applyConflictResolutionMock: vi.fn(),
		readRosterNamesSettingMock: vi.fn(),
		updateRosterShowRealNamesMock: vi.fn(),
		listLinkedIdentitiesMock: vi.fn(),
		mintSelfLinkInviteMock: vi.fn()
	};
});
vi.mock('$lib/profile/fieldMove', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/profile/fieldMove')>('$lib/profile/fieldMove');
	return { ...actual, applyConflictResolution: h.applyConflictResolutionMock };
});
vi.mock('$lib/profile/profileData', () => {
	const NARROWNESS: Record<string, number> = { private: 0, domain: 1, public: 2 };
	return {
		listMyProfiles: h.listMyProfilesMock,
		profilesByLevel: (ps: Array<{ _sharing: string }>) => {
			const by: Record<string, unknown> = {};
			for (const p of ps) by[p._sharing] = p;
			return by;
		},
		NARROWNESS,
		resolveField: (
			ps: Array<{ _id: string; name: string; email: string; _sharing: string }>,
			field: 'name' | 'email'
		) => {
			const withValue = ps
				.filter((p) => p[field] !== '')
				.slice()
				.sort((a, b) => NARROWNESS[a._sharing] - NARROWNESS[b._sharing]);
			return {
				value: withValue.length > 0 ? withValue[0][field] : '',
				holders: withValue.map((p) => ({ level: p._sharing, id: p._id }))
			};
		}
	};
});
vi.mock('$lib/profile/applyProfileSave', () => ({
	applyProfileSave: h.applyProfileSaveMock,
	ProfileSaveError: h.ProfileSaveError
}));
vi.mock('$lib/collective/rosterNames', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/rosterNames')>()),
	readRosterNamesSetting: h.readRosterNamesSettingMock,
	updateRosterShowRealNames: h.updateRosterShowRealNamesMock
}));
vi.mock('$lib/profile/linkedIdentities', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/linkedIdentities')>()),
	listLinkedIdentities: h.listLinkedIdentitiesMock
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	mintSelfLinkInvite: h.mintSelfLinkInviteMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetGate } from '$lib/profile/completionGate';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	isWriteDisabled,
	expectVisibleReason,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';

const REASON = '[write_unavailable_no_signal]';
/** The page's own idle window (createAutosave({ idleMs: 2_000 })). */
const IDLE_MS = 2_000;

function selectSampledb() {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

beforeEach(async () => {
	for (const mock of [
		h.listMyProfilesMock,
		h.applyProfileSaveMock,
		h.applyConflictResolutionMock,
		h.readRosterNamesSettingMock,
		h.updateRosterShowRealNamesMock,
		h.listLinkedIdentitiesMock,
		h.mintSelfLinkInviteMock
	]) {
		mock.mockReset();
	}
	h.listMyProfilesMock.mockResolvedValue([
		{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
	]);
	h.applyProfileSaveMock.mockResolvedValue({ _id: 'prof-dom' });
	h.readRosterNamesSettingMock.mockResolvedValue({ dbEntityId: 'db-1', showRealNames: false });
	h.updateRosterShowRealNamesMock.mockResolvedValue(undefined);
	h.listLinkedIdentitiesMock.mockResolvedValue({ identities: [], truncated: false });
	h.mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: 'tok' });
	adminStore.set('admin');
	await goOnline();
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
	resetGate();
	resetOnLine();
});

const q = (c: ParentNode, testid: string) => c.querySelector(`[data-testid="${testid}"]`);

async function renderReadyOnline() {
	selectSampledb();
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'profile-field-name')).not.toBeNull());
	await waitFor(() => expect(q(container, 'profile-name-edit')).not.toBeNull());
	return container;
}

async function openNameEditor(container: HTMLElement): Promise<HTMLInputElement> {
	await fireEvent.click(q(container, 'profile-name-edit') as HTMLElement);
	return await waitFor(() => {
		const el = q(container, 'profile-name') as HTMLInputElement | null;
		expect(el).not.toBeNull();
		return el!;
	});
}

function writeControls(container: HTMLElement): HTMLElement[] {
	return [
		q(container, 'profile-name-edit') as HTMLElement,
		q(container, 'profile-email-edit') as HTMLElement,
		q(container, 'profile-roster-names') as HTMLElement,
		q(container, 'profile-link-another') as HTMLElement,
		// BUTTONS only: the visibility group also renders non-control nodes under a
		// `profile-vis-*` testid (the per-level state hint), and a <p> has nothing to
		// disable.
		...Array.from(container.querySelectorAll<HTMLElement>('button[data-testid^="profile-vis-"]'))
	].filter((el): el is HTMLElement => el !== null);
}

describe('/profile — writes while offline (#434 slice 6 review F1)', () => {
	it('offline: every write control is disabled and the reason is visible once', async () => {
		const container = await renderReadyOnline();
		expect(writeControls(container).length).toBeGreaterThanOrEqual(4);
		await goOffline();

		await waitFor(() => {
			for (const c of writeControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(true);
			}
		});
		expectVisibleReason(container, 'profile-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="profile-write-unavailable"]')).toHaveLength(1);
	});

	// The heart of the finding: the write with no button.
	it('offline: the 2s idle autosave never fires, and the typed text survives', async () => {
		const container = await renderReadyOnline();
		const input = await openNameEditor(container);
		await goOffline();
		h.applyProfileSaveMock.mockClear();

		// Fake timers ONLY here — `settle()` and testing-library's waitFor are real
		// -timer helpers, and the render above is already done.
		vi.useFakeTimers();
		await fireEvent.input(input, { target: { value: 'Ada Lovelace' } });
		vi.advanceTimersByTime(IDLE_MS * 3);
		await Promise.resolve();
		await Promise.resolve();
		vi.useRealTimers();

		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
		expect((q(container, 'profile-name') as HTMLInputElement).value).toBe('Ada Lovelace');
	});

	it('offline: a blur does not write either, and nothing is queued for the signal returning', async () => {
		const container = await renderReadyOnline();
		const input = await openNameEditor(container);
		await goOffline();
		h.applyProfileSaveMock.mockClear();

		await fireEvent.input(input, { target: { value: 'Ada Lovelace' } });
		await fireEvent.blur(input);
		await settle();
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();

		// The signal comes back: still nothing writes ON ITS OWN (no queue).
		await goOnline();
		await settle();
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
	});

	it('offline: the roster-names toggle writes nothing and snaps back to the stored value', async () => {
		const container = await renderReadyOnline();
		await waitFor(() => expect(q(container, 'profile-roster-names')).not.toBeNull());
		await goOffline();
		await settle();

		const select = q(container, 'profile-roster-names') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'real' } });
		await settle();

		expect(h.updateRosterShowRealNamesMock).not.toHaveBeenCalled();
		expect(select.value).toBe('profile');
	});

	// The sweep: every enabled control, re-queried after each interaction.
	it('offline: operating every enabled control calls no write seam', async () => {
		const container = await renderReadyOnline();
		await goOffline();
		await settle();
		h.applyProfileSaveMock.mockClear();
		h.applyConflictResolutionMock.mockClear();
		h.updateRosterShowRealNamesMock.mockClear();
		h.mintSelfLinkInviteMock.mockClear();

		const touched = await exerciseEveryEnabledControl(container);

		// Not vacuous: the language / time-format / install chrome and the storage
		// section are all local-only controls that stay live offline by design.
		expect(touched.length).toBeGreaterThan(1);
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
		expect(h.applyConflictResolutionMock).not.toHaveBeenCalled();
		expect(h.updateRosterShowRealNamesMock).not.toHaveBeenCalled();
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it('back online: the controls enable again, the sentence goes, and an edit autosaves', async () => {
		const container = await renderReadyOnline();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'profile-name-edit') as HTMLElement)).toBe(false);
		});
		expect(q(container, 'profile-write-unavailable')).toBeNull();

		const input = await openNameEditor(container);
		await fireEvent.input(input, { target: { value: 'Ada Lovelace' } });
		await fireEvent.blur(input);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
	});
});

// (*MVOX:Josquin* — #434 slice 6 review F1)
