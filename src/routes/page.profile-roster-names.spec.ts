// @vitest-environment happy-dom
//
// #267 RED — the admin-only roster-names toggle on /profile: whether the
// roster shows members' REAL names or their PROFILE names. Released by Mihkel
// 2026-09-07 ("#267 is ready" — the widget detail settled AS PROPOSED; copy
// correctable at his live review).
//
// CONTRACT (GREEN implements in src/routes/profile/+page.svelte plus a new
// data seam src/lib/collective/rosterNames.ts — see rosterNames.spec.ts for
// the wire contract):
//
//   THE CONTROL — mirrors the time-format idiom verbatim, inserted AFTER the
//   time-format block as a sibling in the app-chrome column, OUTSIDE the
//   `status`-gated chain:
//     - <label for="profile-roster-names"> from profile_roster_names_label
//     - NATIVE <select id="profile-roster-names"
//         data-testid="profile-roster-names"> with EXACTLY two options, in
//       this order: 'profile' (profile_roster_names_profile — the DEFAULT)
//       then 'real' (profile_roster_names_real)
//     - hint <p data-testid="profile-roster-names-hint"> from
//       profile_roster_names_hint — the collective-wide fact ("Kehtib kogu
//       koorile, mitte ainult sinule."), distinguishing it from the two
//       per-device neighbours above it
//
//   VISIBILITY — rendered ONLY when $adminStore === 'admin' (a NEW import on
//   this page: adminStore from $lib/nav/adminStore, the roster precedent —
//   resolved app-wide in +layout, keyed to the selected collective).
//   'not-admin', 'loading' AND 'error' all render NOTHING — no disabled
//   control, no explanatory text (fail-closed, like roster's write controls).
//   The control is NOT gated on route-load `status` (app chrome): an admin
//   sees it even when the profile-fields load errored.
//
//   READ — on load, the page reads the collective's (database entity's)
//   `roster_show_real_names` via the new seam
//   readRosterNamesSetting(cfg) → { dbEntityId, showRealNames }; the key is
//   entirely ABSENT on the wire when unset → false → 'profile' selected.
//   The read joins the page's routeLoad load() body under the captured-
//   generation guard AND its state joins resetState() — omitting either
//   reproduces the #257/#260 stale-collective class, so BOTH are pinned by
//   deterministic collective-switch races below (held deferred → switch →
//   settle stale → must not land).
//
//   WRITE — server-confirmed, NEVER optimistic (#253/#264 class): onchange →
//   disable the select in flight → updateRosterShowRealNames(cfg, dbEntityId,
//   value) (the post-#264 atomic overwrite via replaceEntityProperty — a bare
//   POST would silently ACCUMULATE duplicate values per Entu append
//   semantics). The select reflects the new value ONLY after the await
//   resolves (the admin confirmNameEdit pattern — no optimistic assignment
//   anywhere). Write rights = the same owner/editor set the admin gate
//   checks; no new rights mechanism.
//
//   SUCCESS — announced via a NEW PERSISTENT sr-only role="status" region
//   [data-testid="profile-roster-names-status"] (the profile-repair-status
//   pattern verbatim: persistent mount, imperative text set from
//   profile_roster_names_saved, CLEARED at the START of the next attempt —
//   never on settle, never a timer), under the generation guard.
//
//   FAILURE TELLS THE TRUTH — the message (profile_roster_names_error, an
//   inline role="alert" p [data-testid="profile-roster-names-error"]) states
//   the setting was NOT changed; the select shows the SERVER's value again.
//   STATED CHOICE (the contract offers re-read vs captured): the select
//   returns to the PRE-WRITE CAPTURED server-confirmed value — NO re-read
//   (readRosterNamesSetting is not called again on failure). No success
//   claim, no value the server doesn't hold, select re-enabled.
//
//   IN-FLIGHT COLLECTIVE SWITCH ON THE WRITE — a write settling (resolve OR
//   reject) after a switch writes no state and no announcement for the stale
//   collective.
//
// Harness mirrors page.profile-time-format.spec.ts (the settings-column
// integration precedent) + page.profile-completion-gate-race.spec.ts (the
// deterministic held-deferred race method, #253 proof clause: every race is
// deterministically ordered, never a timeout).
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const h = vi.hoisted(() => ({
	listMyProfilesMock: vi.fn(),
	readRosterNamesMock: vi.fn(),
	updateRosterNamesMock: vi.fn()
}));
// Mock ONLY the network reads; keep resolveField/profilesByLevel real.
vi.mock('$lib/profile/profileData', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/profileData')>(
		'$lib/profile/profileData'
	);
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});
// The linked-identities read runs after every profile load; stubbed empty so
// it neither hits the network nor injects async noise into the race ordering.
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] })
}));
// The NEW data seam this slice creates (does not exist on the branch base —
// until GREEN creates src/lib/collective/rosterNames.ts the page never
// requests it, the control never renders, and every test below is RED).
vi.mock('$lib/collective/rosterNames', () => ({
	readRosterNamesSetting: h.readRosterNamesMock,
	updateRosterShowRealNames: h.updateRosterNamesMock
}));

import ProfilePage from './profile/+page.svelte';
import { m } from '$lib/paraglide/messages.js';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';

type RosterNamesSetting = { dbEntityId: string; showRealNames: boolean };

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const rosterSelect = (c: HTMLElement) =>
	q(c, '[data-testid="profile-roster-names"]') as HTMLSelectElement | null;
const rosterHint = (c: HTMLElement) => q(c, '[data-testid="profile-roster-names-hint"]');
const rosterStatus = (c: HTMLElement) => q(c, '[data-testid="profile-roster-names-status"]');
const rosterError = (c: HTMLElement) => q(c, '[data-testid="profile-roster-names-error"]');
const timeFormatSelect = (c: HTMLElement) =>
	q(c, '[data-testid="profile-time-format"]') as HTMLSelectElement | null;

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Drain the microtask queue so a just-settled promise chain fully lands. */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

const COLLECTIVE_A = { db: 'polyphony', name: 'Polyphony', personId: 'person-p' };
const COLLECTIVE_B = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

/** Per-collective profiles with DISTINCT names so "which collective's ready
 *  state is on screen" is observable in the DOM — switch sentinels are
 *  content-based, never a guess about render timing (#260 house method). */
function wireProfilesPerCollective(): void {
	h.listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'bravura'
			? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' as const }]
			: [{ _id: 'prof-a-dom', name: 'Ada', email: '', _sharing: 'domain' as const }]
	);
}

function signIn(collectives: Array<{ db: string; name: string; personId: string }>): void {
	setToken('jwt-member');
	collectiveState.set({ status: 'ready', collectives, erroredDbs: [] });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(collectives[0].db);
}

function displayName(container: HTMLElement): string {
	return (q(container, '[data-testid="profile-name-value"]')?.textContent ?? '').trim();
}

/** Wait until the profile surface shows THIS collective's loaded name — proof
 *  the context's load fully landed (not leftover DOM from the last one). */
async function waitReadyShowing(container: HTMLElement, name: string): Promise<void> {
	await waitFor(() => {
		expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull();
		expect(displayName(container)).toBe(name);
	});
}

async function renderAdminReady(
	setting: RosterNamesSetting = { dbEntityId: 'db-entity-a', showRealNames: false }
): Promise<HTMLElement> {
	wireProfilesPerCollective();
	h.readRosterNamesMock.mockResolvedValue(setting);
	adminStore.set('admin');
	signIn([COLLECTIVE_A]);
	const { container } = render(ProfilePage);
	await waitReadyShowing(container, 'Ada');
	await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
	return container;
}

beforeEach(() => {
	localStorage.clear();
	h.listMyProfilesMock.mockReset();
	h.readRosterNamesMock.mockReset();
	h.updateRosterNamesMock.mockReset();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

// ── the control: structure, placement, page invariants ───────────────────────

describe('/profile — roster-names control structure (admin view)', () => {
	it('renders a NATIVE <select> with exactly the two options profile/real (profile FIRST — the default), labelled via <label for>', async () => {
		const container = await renderAdminReady();
		const select = rosterSelect(container)!;
		expect(select.tagName).toBe('SELECT');
		expect(select.id).toBe('profile-roster-names');
		const options = [...select.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['profile', 'real']);
		expect(options[0].textContent?.trim()).toBe(m.profile_roster_names_profile());
		expect(options[1].textContent?.trim()).toBe(m.profile_roster_names_real());
		// Accessible name via the paired <label for="profile-roster-names">.
		const label = q(container, 'label[for="profile-roster-names"]');
		expect(label, 'label[for=profile-roster-names] missing').not.toBeNull();
		expect(label!.textContent?.trim()).toBe(m.profile_roster_names_label());
		expect(select.labels?.length).toBeGreaterThan(0);
		expect(select.tabIndex).toBeGreaterThanOrEqual(0);
	});

	it('renders the collective-wide hint DIRECTLY UNDER the select', async () => {
		const container = await renderAdminReady();
		const hintEl = rosterHint(container);
		expect(hintEl, 'profile-roster-names-hint missing').not.toBeNull();
		expect(hintEl!.textContent?.trim()).toBe(m.profile_roster_names_hint());
		expect(
			rosterSelect(container)!.compareDocumentPosition(hintEl!) &
				Node.DOCUMENT_POSITION_FOLLOWING,
			'the hint must come after the select in document order'
		).toBeTruthy();
	});

	it('sits AFTER the time-format control, as a SIBLING block in the same app-chrome column', async () => {
		const container = await renderAdminReady();
		const timeFormat = timeFormatSelect(container)!;
		const roster = rosterSelect(container)!;
		expect(timeFormat, 'the time-format control must be untouched').not.toBeNull();
		expect(
			timeFormat.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the roster-names control must come after the time-format control'
		).toBeTruthy();
		// Sibling in the SAME column: both wrapper blocks share a parent.
		expect(roster.closest('div')!.parentElement).toBe(timeFormat.closest('div')!.parentElement);
		// The neighbours are still there (their own specs stay green).
		expect(q(container, '[data-testid="profile-time-format-hint"]')).not.toBeNull();
	});

	it('page invariants hold: exactly one <main>, exactly one <h1>', async () => {
		const container = await renderAdminReady();
		expect(container.querySelectorAll('main')).toHaveLength(1);
		expect(container.querySelectorAll('h1')).toHaveLength(1);
	});

	it('is app chrome, NOT gated on route-load status: still rendered for an admin when the profile-fields load errored', async () => {
		wireProfilesPerCollective();
		h.listMyProfilesMock.mockRejectedValue(new Error('boom'));
		h.readRosterNamesMock.mockResolvedValue({ dbEntityId: 'db-entity-a', showRealNames: false });
		adminStore.set('admin');
		signIn([COLLECTIVE_A]);
		const { container } = render(ProfilePage);
		await waitFor(() => expect(q(container, '[data-testid="profile-load-error"]')).not.toBeNull());
		expect(rosterSelect(container), 'app chrome must survive a fields load-error').not.toBeNull();
	});
});

// ── visibility: fail-closed on every non-admin state ─────────────────────────

describe('/profile — roster-names visibility is admin-only (fail-closed)', () => {
	for (const state of ['not-admin', 'loading', 'error'] as AdminState[]) {
		it(`adminStore '${state}' → the control is ABSENT from the DOM (no disabled control, no text); it APPEARS when the store resolves 'admin'`, async () => {
			wireProfilesPerCollective();
			h.readRosterNamesMock.mockResolvedValue({
				dbEntityId: 'db-entity-a',
				showRealNames: true
			});
			adminStore.set(state);
			signIn([COLLECTIVE_A]);
			const { container } = render(ProfilePage);
			await waitReadyShowing(container, 'Ada');
			// The page itself rendered (neighbour control present)…
			expect(timeFormatSelect(container)).not.toBeNull();
			// …but nothing of the roster-names control exists.
			expect(rosterSelect(container)).toBeNull();
			expect(rosterHint(container)).toBeNull();
			expect(q(container, 'label[for="profile-roster-names"]')).toBeNull();
			expect(q(container, '#profile-roster-names')).toBeNull();

			// The gate is REACTIVE (the roster precedent: $derived($adminStore)) —
			// when the layout's resolution lands 'admin', the control appears.
			// This half also keeps the test honest against the branch base: a page
			// with no control at all fails HERE, not by passing the absence check.
			adminStore.set('admin');
			await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
			expect(rosterHint(container)).not.toBeNull();
		});
	}
});

// ── READ: server value → select, absent → 'profile' ──────────────────────────

describe('/profile — roster-names READ (integration: the page route drives the seam)', () => {
	it('on load, reads the setting through readRosterNamesSetting for the selected collective', async () => {
		const container = await renderAdminReady();
		expect(h.readRosterNamesMock).toHaveBeenCalled();
		expect(h.readRosterNamesMock.mock.calls[0][0]).toMatchObject({ db: 'polyphony' });
		expect(rosterSelect(container)!.value).toBe('profile');
	});

	it("server false (or absent → false) → 'profile' selected", async () => {
		const container = await renderAdminReady({ dbEntityId: 'db-entity-a', showRealNames: false });
		expect(rosterSelect(container)!.value).toBe('profile');
	});

	it("server true → 'real' selected", async () => {
		const container = await renderAdminReady({ dbEntityId: 'db-entity-a', showRealNames: true });
		await waitFor(() => expect(rosterSelect(container)!.value).toBe('real'));
	});

	it("RACE (deterministic, #257/#260 class): A's read held → switch to B (false, landed) → A settles true → the select stays on B's 'profile'", async () => {
		wireProfilesPerCollective();
		const staleRead = deferred<RosterNamesSetting>();
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? Promise.resolve({ dbEntityId: 'db-entity-b', showRealNames: false })
				: staleRead.promise
		);
		adminStore.set('admin');
		signIn([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');

		// A's read is in flight (held). Switch to B; B's own load fully lands.
		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await waitFor(() =>
			expect(
				h.readRosterNamesMock.mock.calls.some((c) => (c[0] as { db: string }).db === 'bravura')
			).toBe(true)
		);
		await flushMicrotasks();
		expect(rosterSelect(container)!.value).toBe('profile');

		// ONLY NOW settle A's stale read with the value that would flip the UI.
		staleRead.resolve({ dbEntityId: 'db-entity-a', showRealNames: true });
		await flushMicrotasks();
		expect(rosterSelect(container)!.value, "A's stale answer must never land on B").toBe(
			'profile'
		);
	});

	it("resetState joins: switching away from a collective showing 'real' resets to the DEFAULT while the new read is still in flight", async () => {
		wireProfilesPerCollective();
		const heldB = deferred<RosterNamesSetting>(); // never settles
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? heldB.promise
				: Promise.resolve({ dbEntityId: 'db-entity-a', showRealNames: true })
		);
		adminStore.set('admin');
		signIn([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)!.value).toBe('real'));

		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await waitFor(() =>
			expect(
				h.readRosterNamesMock.mock.calls.some((c) => (c[0] as { db: string }).db === 'bravura')
			).toBe(true)
		);
		// B's read has NOT settled: the previous collective's 'real' must not
		// bleed through — default 'profile' shows.
		expect(rosterSelect(container)!.value).toBe('profile');
	});
});

// ── WRITE: server-confirmed, never optimistic; success announced ─────────────

describe('/profile — roster-names WRITE (server-confirmed, never optimistic)', () => {
	it('onchange calls updateRosterShowRealNames(cfg, dbEntityId, true); the select is DISABLED in flight, no announcement yet; the new value shows only AFTER the await resolves, announced via the persistent status region', async () => {
		const container = await renderAdminReady();
		const write = deferred<void>();
		h.updateRosterNamesMock.mockReturnValueOnce(write.promise);

		// The status region is PERSISTENT: mounted (empty) before any attempt.
		const regionBefore = rosterStatus(container);
		expect(regionBefore, 'profile-roster-names-status must be mounted persistently').not.toBeNull();
		expect(regionBefore!.getAttribute('role')).toBe('status');
		expect(regionBefore!.textContent?.trim()).toBe('');

		const select = rosterSelect(container)!;
		await fireEvent.change(select, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));

		// The wire args: cfg for the selected collective, the dbEntityId the
		// READ resolved, the boolean for the chosen option.
		const call = h.updateRosterNamesMock.mock.calls[0];
		expect(call[0]).toMatchObject({ db: 'polyphony' });
		expect(call[1]).toBe('db-entity-a');
		expect(call[2]).toBe(true);

		// In flight: disabled (the single-flight guard replaceProperty's #264
		// header demands of every double-fireable caller), and NO success claim.
		await waitFor(() => expect(rosterSelect(container)!.disabled).toBe(true));
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		expect(rosterError(container)).toBeNull();

		write.resolve(undefined);
		await flushMicrotasks();
		await waitFor(() => {
			expect(rosterSelect(container)!.disabled).toBe(false);
			expect(rosterSelect(container)!.value).toBe('real');
		});
		// Announced — and on the SAME persistent node (never remounted with its
		// text already in it, which a live region announces as nothing).
		const regionAfter = rosterStatus(container);
		expect(regionAfter).toBe(regionBefore);
		expect(regionAfter!.textContent?.trim()).toBe(m.profile_roster_names_saved());
	});

	it('the announcement is CLEARED at the START of the next attempt (never on settle, never a timer) — a failed retry shows no stale confirmation', async () => {
		const container = await renderAdminReady();
		const write1 = deferred<void>();
		const write2 = deferred<void>();
		h.updateRosterNamesMock
			.mockReturnValueOnce(write1.promise)
			.mockReturnValueOnce(write2.promise);

		const select = rosterSelect(container)!;
		await fireEvent.change(select, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));
		write1.resolve(undefined);
		await flushMicrotasks();
		await waitFor(() =>
			expect(rosterStatus(container)!.textContent?.trim()).toBe(m.profile_roster_names_saved())
		);

		// Second attempt: the confirmation clears the moment the attempt STARTS.
		await fireEvent.change(rosterSelect(container)!, { target: { value: 'profile' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(2));
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');

		// The retry FAILS: still no stale success claim, the error tells the
		// truth, and the select returns to the server-confirmed value from
		// write 1 ('real' — the captured pre-write server state).
		write2.reject(new Error('entu 500'));
		await flushMicrotasks();
		await waitFor(() => expect(rosterError(container)).not.toBeNull());
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		expect(rosterSelect(container)!.value).toBe('real');
		expect(rosterSelect(container)!.disabled).toBe(false);
	});

	it('FORCED FAILURE tells the truth: error message says the setting was NOT changed, the select shows the pre-write SERVER value (no re-read), re-enabled', async () => {
		const container = await renderAdminReady(); // server: false → 'profile'
		const readCallsBefore = h.readRosterNamesMock.mock.calls.length;
		h.updateRosterNamesMock.mockImplementationOnce(() =>
			Promise.reject(new Error('updateRosterShowRealNames POST failed: 403'))
		);

		const select = rosterSelect(container)!;
		await fireEvent.change(select, { target: { value: 'real' } });
		await waitFor(() => expect(rosterError(container)).not.toBeNull());

		const error = rosterError(container)!;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent?.trim()).toBe(m.profile_roster_names_error());
		// The server's value, not the value the server doesn't hold:
		expect(rosterSelect(container)!.value).toBe('profile');
		expect(rosterSelect(container)!.disabled).toBe(false);
		// No success claim anywhere.
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		// STATED CHOICE pinned: pre-write captured server value — no re-read.
		expect(h.readRosterNamesMock.mock.calls.length).toBe(readCallsBefore);
	});

	it("WRITE RACE (deterministic): a write settling AFTER a collective switch announces nothing and writes no state for the stale collective; B's select is usable immediately", async () => {
		wireProfilesPerCollective();
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? Promise.resolve({ dbEntityId: 'db-entity-b', showRealNames: false })
				: Promise.resolve({ dbEntityId: 'db-entity-a', showRealNames: false })
		);
		const write = deferred<void>();
		h.updateRosterNamesMock.mockReturnValueOnce(write.promise);
		adminStore.set('admin');
		signIn([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)).not.toBeNull());

		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));

		// Switch while A's write is in flight. B's surface must not inherit the
		// in-flight lock (resetState clears it) nor A's pending value.
		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await flushMicrotasks();
		expect(rosterSelect(container)!.disabled).toBe(false);
		expect(rosterSelect(container)!.value).toBe('profile');

		// ONLY NOW the stale write succeeds — for a collective the user left.
		write.resolve(undefined);
		await flushMicrotasks();
		expect(rosterStatus(container)!.textContent?.trim(), 'no stale-collective announcement').toBe(
			''
		);
		expect(rosterError(container)).toBeNull();
		expect(rosterSelect(container)!.value).toBe('profile');
		expect(rosterSelect(container)!.disabled).toBe(false);
	});

	it('WRITE RACE variant: a stale write REJECTING after the switch surfaces no error for the collective the user left', async () => {
		wireProfilesPerCollective();
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? Promise.resolve({ dbEntityId: 'db-entity-b', showRealNames: false })
				: Promise.resolve({ dbEntityId: 'db-entity-a', showRealNames: false })
		);
		const write = deferred<void>();
		h.updateRosterNamesMock.mockReturnValueOnce(write.promise);
		adminStore.set('admin');
		signIn([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)).not.toBeNull());

		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));

		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await flushMicrotasks();

		write.reject(new Error('entu network down'));
		await flushMicrotasks();
		expect(rosterError(container), "A's stale failure must not surface on B").toBeNull();
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		expect(rosterSelect(container)!.value).toBe('profile');
	});
});

// ── WRITE PRECONDITION: no confirmed entity id → the control cannot lie ──────
//
// #267 review F1 (#253/#264 class). The admin gate ($adminStore) and the
// roster-names READ resolve on INDEPENDENT clocks: +layout resolves the store,
// this page fires its own read in load(). So 'admin' can be on screen while
// `rosterDbEntityId` is still null — either the read is in flight (a window
// that reopens on every collective switch) or it FAILED and left the
// documented default standing (null, permanently). The browser mutates
// <select>.value the instant the admin picks an option, and Svelte's
// `value={…}` effect only re-runs on a SIGNAL change, so a silent bail would
// leave the select showing 'Pärisnimed' with nothing written and nothing said.
// Both halves are pinned here, and each fails on its own reason without the
// other: the control is UNUSABLE until the id is confirmed, AND the residual
// bail restores the server-confirmed value and states the failure.

describe('/profile — roster-names WRITE precondition (no confirmed entity id)', () => {
	it('READ STILL IN FLIGHT: the control is rendered (adminStore landed first) but the select is DISABLED — a forced change writes nothing; it becomes usable when the read settles', async () => {
		wireProfilesPerCollective();
		const read = deferred<RosterNamesSetting>();
		h.readRosterNamesMock.mockReturnValueOnce(read.promise);
		adminStore.set('admin');
		signIn([COLLECTIVE_A]);
		const { container } = render(ProfilePage);
		// The admin gate is satisfied and the profile fields landed while the
		// roster-names read is still held: exactly the window under test.
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
		expect(rosterSelect(container)!.disabled, 'no confirmed entity id → unusable').toBe(true);

		// Even forced through (fireEvent dispatches regardless of `disabled`),
		// the handler writes NOTHING and leaves no value the server doesn't hold.
		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await flushMicrotasks();
		expect(h.updateRosterNamesMock).not.toHaveBeenCalled();
		expect(rosterSelect(container)!.value).toBe('profile');
		expect(rosterStatus(container)!.textContent?.trim(), 'no success claim').toBe('');

		// The read lands → the id is confirmed → the control becomes usable.
		read.resolve({ dbEntityId: 'db-entity-a', showRealNames: false });
		await flushMicrotasks();
		await waitFor(() => expect(rosterSelect(container)!.disabled).toBe(false));
		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));
		expect(h.updateRosterNamesMock.mock.calls[0][1]).toBe('db-entity-a');
	});

	it('READ FAILED: the control stays rendered on the documented default but DISABLED (the id never arrives); a forced change writes nothing, restores the select to the server value and says the setting was NOT changed', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			wireProfilesPerCollective();
			h.readRosterNamesMock.mockRejectedValue(new Error('entu 500'));
			adminStore.set('admin');
			signIn([COLLECTIVE_A]);
			const { container } = render(ProfilePage);
			await waitReadyShowing(container, 'Ada');
			await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
			await flushMicrotasks();

			// The read failed visibly (console.warn — the documented default
			// stands) and the control cannot be moved into an unsaved state.
			expect(warn).toHaveBeenCalled();
			expect(rosterSelect(container)!.value).toBe('profile');
			expect(rosterSelect(container)!.disabled, 'a failed read leaves no entity id').toBe(true);

			await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
			await flushMicrotasks();
			expect(h.updateRosterNamesMock).not.toHaveBeenCalled();
			// The residual bail TELLS THE TRUTH — never a silent return.
			await waitFor(() => expect(rosterError(container)).not.toBeNull());
			expect(rosterError(container)!.getAttribute('role')).toBe('alert');
			expect(rosterError(container)!.textContent?.trim()).toBe(m.profile_roster_names_error());
			expect(rosterSelect(container)!.value, 'never a value the server does not hold').toBe(
				'profile'
			);
			expect(rosterStatus(container)!.textContent?.trim(), 'no success claim').toBe('');
		} finally {
			warn.mockRestore();
		}
	});
});

// ── locale parity: every key this slice adds, ×4 locales, exact text ─────────
//
// et control strings are PO-pinned VERBATIM (issue #267 body, released
// 2026-09-07 "as proposed"; copy correctable at Mihkel's live review). The
// en/lv/uk strings and BOTH et feedback strings (error/saved) are engineering
// drafts in the profile_time_format_hint register — refinable at live review,
// pinned exactly here so a silent drift is a red test, not a surprise.
// `profile_roster_names_saved` is an engineering addition: the mandated
// role="status" announcement needs a string, and every persistent string is a
// paraglide message (issue: "All four strings are paraglide messages" — the
// announcement inherits the rule).

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

const NEW_KEYS = [
	'profile_roster_names_label',
	'profile_roster_names_profile',
	'profile_roster_names_real',
	'profile_roster_names_hint',
	'profile_roster_names_error',
	'profile_roster_names_saved'
] as const;

const PINNED_TEXT: Record<(typeof LOCALES)[number], Record<(typeof NEW_KEYS)[number], string>> = {
	en: {
		profile_roster_names_label: 'Names on the roster',
		profile_roster_names_profile: 'Profile names',
		profile_roster_names_real: 'Real names',
		profile_roster_names_hint: 'Applies to the whole collective, not only to you.',
		profile_roster_names_error: "Couldn't save — the roster setting was not changed.",
		profile_roster_names_saved: 'Roster name setting saved.'
	},
	et: {
		// PO-pinned verbatim (issue #267 body, released as proposed):
		profile_roster_names_label: 'Nimed rosteris',
		profile_roster_names_profile: 'Profiilinimed',
		profile_roster_names_real: 'Pärisnimed',
		profile_roster_names_hint: 'Kehtib kogu koorile, mitte ainult sinule.',
		// engineering drafts (truth-telling failure per #253/#264):
		profile_roster_names_error: 'Salvestamine ebaõnnestus — seadistus jäi muutmata.',
		profile_roster_names_saved: 'Rosteri nimede seadistus salvestatud.'
	},
	lv: {
		profile_roster_names_label: 'Vārdi dalībnieku sarakstā',
		profile_roster_names_profile: 'Profila vārdi',
		profile_roster_names_real: 'Īstie vārdi',
		profile_roster_names_hint: 'Attiecas uz visu kolektīvu, ne tikai uz jums.',
		profile_roster_names_error: 'Neizdevās saglabāt — iestatījums netika mainīts.',
		profile_roster_names_saved: 'Saraksta vārdu iestatījums saglabāts.'
	},
	uk: {
		profile_roster_names_label: 'Імена у списку учасників',
		profile_roster_names_profile: 'Імена профілів',
		profile_roster_names_real: 'Справжні імена',
		profile_roster_names_hint: 'Стосується всього колективу, а не лише вас.',
		profile_roster_names_error: 'Не вдалося зберегти — налаштування не змінено.',
		profile_roster_names_saved: 'Налаштування імен у списку збережено.'
	}
};

function readMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(__dirname, `../../messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('locale parity — #267 keys exist, non-empty, exact text, in en/et/lv/uk', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json carries every new key, non-empty`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
				expect(isMessageEmpty(messages[key]), `${locale}.json ${key} is empty`).toBe(false);
			}
		});

		it(`${locale}.json pins the exact text (et control strings PO-verbatim; the rest refinable drafts)`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(messages[key], `${locale}.json ${key}`).toBe(PINNED_TEXT[locale][key]);
			}
		});
	}
});

// (*MVOX:Tallis* — #267 RED)
