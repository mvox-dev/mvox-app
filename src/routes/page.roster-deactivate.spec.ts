// @vitest-environment happy-dom
//
// #255 RED — the roster page's DEACTIVATE flow (done-when 1/4/5/7) at the
// route level, so GREEN cannot satisfy the unit layer without wiring the
// feature into the actual page:
//
//   (A) admin-only control on another member's row, NEVER on the viewer's own
//       row (a member cannot deactivate herself — done-when 7), two-step
//       confirm reusing the page's existing destructive idiom (arm → confirm/
//       cancel — the section-remove shape, #110 F4), REFUSAL while the person
//       holds a manageable grant, with copy that names the remedy (Gama
//       binding: who holds what role and where to remove it — never a bare
//       "cannot deactivate"), and fail-CLOSED when the rights read itself
//       fails.
//   (B) the INACTIVE surface (done-when 4): out of the roster's normal flow
//       (hidden until its own toggle), shows each inactive member's SECTION
//       assignment (adopted binding — it explains the section ghost-blocker),
//       reinstates with ONE action and NO invitation.
//
// Data mechanics (atomic overwrite (#264), status-only write, _parent untouched)
// are pinned in memberLifecycle.spec.ts; this file pins the page wiring.
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

const {
	loadRosterMock,
	listSectionsMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn()
}));
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer; the SHARED,
// profile-names-only `loadRoster` belongs to the agenda / event page / admin roles
// (Henry's roster-only scope ruling — see rosterData.ts for both contracts).
vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
// Reinstate must NOT mint anything — the whole point of done-when 4 is
// "without a fresh invitation". Mocked so a wrong implementation is caught as
// a call, not a network error.
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: createInviteMock,
	mintSelfLinkInvite: mintSelfLinkInviteMock
}));
// The refusal read needs a library id when the collective has one; stubbed so
// no live lookup runs from a unit test, whichever resolution path GREEN picks.
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { LibraryLookupError, resolveMyLibraryId } from '$lib/library/librarianStore';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

// m1 is the VIEWER's own membership (personId matches the selected collective's
// person); m2 is another member — the only legitimate deactivate target here.
const rosterTwo = [
	{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: 'db-1' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
];

const altoSection = {
	id: 'sec-alto',
	name: 'Alto',
	displayOrder: 0,
	parentId: null,
	dbEntityId: 'db-1',
	depth: 0,
	children: []
};

beforeEach(() => {
	loadRosterMock.mockResolvedValue(rosterTwo);
	listSectionsMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue([]);
	listInactiveMembersMock.mockResolvedValue([]);
	// Restored per-test: the fail-closed case below makes it REJECT.
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

// Groups default COLLAPSED (TU.2/#110 finding #9) — expand Unassigned (where
// every fixture member lands, sections tree empty) to get rows on screen.
async function renderRosterAs(admin: 'admin' | 'not-admin') {
	const utils = render(Page);
	setAuthedWithOneCollective();
	adminStore.set(admin);
	await waitFor(() =>
		expect(
			utils.container.querySelector('[data-testid="section-toggle-unassigned"]')
		).not.toBeNull()
	);
	await fireEvent.click(
		utils.container.querySelector('[data-testid="section-toggle-unassigned"]')!
	);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="roster-row-m2"]')).not.toBeNull()
	);
	return utils;
}

describe('(A) deactivate — admin-only, never self (done-when 7)', () => {
	it('a collective admin sees the deactivate control on ANOTHER member\'s row', async () => {
		const { container } = await renderRosterAs('admin');
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull();
	});

	it("the viewer's OWN row never carries a deactivate control — self-deactivation is impossible at the UI", async () => {
		const { container } = await renderRosterAs('admin');
		expect(container.querySelector('[data-testid="member-deactivate-m1"]')).toBeNull();
	});

	it('a NON-admin member sees no deactivate control anywhere', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid="member-deactivate-m1"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});
});

describe('(A) two-step confirm — the page\'s existing destructive idiom, reused', () => {
	it('arming swaps in confirm + cancel and writes NOTHING', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});

	it('cancel disarms — the arm control returns, still nothing written', async () => {
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});

	it('confirm calls deactivateMember for THAT member and refetches the roster (she drops out of the active reads)', async () => {
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		expect(deactivateMemberMock.mock.calls[0][1]).toBe('m2');
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
	});
});

describe('(A) refusal while a manageable grant is held — names the remedy (Gama binding)', () => {
	it('an admin-grant blocker REFUSES: no write, and the message carries the collective so it can say where to remove the role — never a bare "cannot deactivate"', async () => {
		listDeactivateBlockersMock.mockResolvedValue([{ role: 'admin' }]);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const refused = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-refused-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		// The Proxy message mock stringifies params, so the collective name only
		// appears if GREEN actually passes it into the refusal copy.
		expect(refused.textContent).toContain('Polyphony');
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		// #286 done-when 5 — the refusal does NOT disarm: the pair stays ARMED
		// beside the alert (blockers listed; the admin cancels out or retries
		// after removing the grant). Pre-#286 the refusal branch nulled the arm
		// id in the same breath it set the refusal, so the alert stood against a
		// disarmed row — the exact done-when-4 lie, on EVERY refusal.
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('FAIL-CLOSED: when the rights read itself rejects, deactivate does NOT proceed', async () => {
		listDeactivateBlockersMock.mockRejectedValue(new Error('rights read failed'));
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalled());
		// settle any pending microtasks — the write must still not have fired
		await new Promise((r) => setTimeout(r, 0));
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		// #286 done-when 5 — a failed check leaves the pair ARMED beside its
		// alert, never a silently disarmed rest state.
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	// #255 review r3 F1 — the id fed to the rights read used to be
	// `row.dbEntityId ?? currentDbEntityId ?? ''`, and that empty string is not a
	// harmless default: `listAdmins` builds `entity/${id}?props=_owner,_editor`,
	// so '' turns it into entu-api's entity LIST route — 200, an `entities` array,
	// no `entity` key — the rights parse reads nothing, and the blocker list comes
	// back EMPTY. Fail-OPEN dressed as "no blockers", on the single check the
	// refuse-don't-strip design rests on. An unresolvable id is a FAILED check.
	it('FAIL-CLOSED: a roster with no resolvable database entity id NEVER deactivates', async () => {
		loadRosterMock.mockResolvedValue([
			{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [] },
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [] }
		]);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-failed-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		// Refused BEFORE any read went out, not after one came back empty.
		expect(resolveMyLibraryId).not.toHaveBeenCalled();
		expect(listDeactivateBlockersMock).not.toHaveBeenCalled();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		// #286 done-when 5 — the early bail-out is a FAILURE path like any other:
		// the pair stays armed beside the alert.
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	// #255 review round 2 F1 — the LIBRARY lookup is part of the same fail-closed
	// chain. `resolveMyLibraryId` throws on a non-2xx library list and reserves
	// `null` for the factual "no library under this collective"; swallowing the
	// throw into `null` would make `listDeactivateBlockers` skip the librarian
	// read and let the deactivate through past an unverified librarian grant.
	it('FAIL-CLOSED: when the LIBRARY lookup rejects, deactivate does NOT proceed and the row alerts', async () => {
		vi.mocked(resolveMyLibraryId).mockRejectedValue(
			new LibraryLookupError('library lookup failed: HTTP 500', 500)
		);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-failed-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		// Never reached the rights read, never reached the write.
		expect(listDeactivateBlockersMock).not.toHaveBeenCalled();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		// #286 done-when 5 — the pair stays armed beside the alert.
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	// The one factual emptiness `resolveMyLibraryId` may assert still skips the
	// librarian read — a collective with no library has no librarian grant.
	it('a genuine null library id still proceeds — no library is a FACT, not a failure', async () => {
		vi.mocked(resolveMyLibraryId).mockResolvedValue(null);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		expect(listDeactivateBlockersMock.mock.calls[0][3]).toBeNull();
	});
});

describe('(B) inactive surface — out of the normal flow, sections shown, reinstate without invite (done-when 4)', () => {
	const inactiveRoster = [
		{
			memberId: 'm9',
			personId: 'pp-9',
			name: 'Gone Girl',
			email: 'gone@example.com',
			sectionIds: ['sec-alto'],
			dbEntityId: 'db-1'
		}
	];

	async function renderWithInactive() {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(inactiveRoster);
		const utils = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		return utils;
	}

	it('OUT of the normal flow: inactive rows are NOT rendered until the toggle opens the surface', async () => {
		const { container } = await renderWithInactive();
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();
	});

	it('opening the surface loads and renders each inactive member WITH her section assignment (adopted binding — explains the section ghost-blocker)', async () => {
		const { container } = await renderWithInactive();
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		const row = await waitFor(() => {
			const el = container.querySelector('[data-testid="inactive-member-row-m9"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(row.textContent).toContain('Gone Girl');
		const section = container.querySelector('[data-testid="inactive-member-section-m9"]');
		expect(section).not.toBeNull();
		expect(section?.textContent).toContain('Alto');
	});

	it('reinstate is ONE action: calls reinstateMember for her, mints NO invitation, and refreshes both lists', async () => {
		const { container } = await renderWithInactive();
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);
		const rosterLoadsBefore = loadRosterMock.mock.calls.length;
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));
		expect(reinstateMemberMock.mock.calls[0][1]).toBe('m9');
		expect(createInviteMock).not.toHaveBeenCalled();
		expect(mintSelfLinkInviteMock).not.toHaveBeenCalled();
		// She is back in the active reads — the page re-reads rather than patching.
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(rosterLoadsBefore)
		);
	});

	// #255 review round 2 F2 / #264 — `reinstateMember` is an atomic overwrite
	// (#264): two concurrent runs both GET the same status value id, the first
	// POST's atomic overwrite consumes it, and the second POST still carries
	// that now-stale `_id` — it returns 200 and silently leaves the member
	// holding TWO `status` values, with nothing shown. The in-flight guard
	// (the deactivate path already has one) is the ONLY protection here — the
	// wire no longer complains.
	it('a second tap while the reinstate is in flight is refused — one write, no false failure alert', async () => {
		let release: () => void = () => {};
		reinstateMemberMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				})
		);
		const { container } = await renderWithInactive();
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);
		const button = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-reinstate-m9"]'
		)!;
		await fireEvent.click(button);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));
		expect(button.disabled).toBe(true);
		// Second tap, straight at the handler — the guard, not just the attribute.
		await fireEvent.click(button);
		button.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(reinstateMemberMock).toHaveBeenCalledTimes(1);
		release();
		await new Promise((r) => setTimeout(r, 0));
		// No failure copy: nothing failed.
		expect(container.querySelector('[data-testid="member-reinstate-failed-m9"]')).toBeNull();
	});

	// #255 review r3 F2(a) — the panel is the one surface `loadForSelected` does
	// not re-derive, so a switch used to leave the PREVIOUS collective's inactive
	// members on screen under the new roster, each with a live Reinstate button
	// aimed at a member id belonging to the collective the admin just left.
	it('switching collectives clears the panel — one collective\'s inactive members never render under another\'s roster', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(inactiveRoster);
		const { container } = render(Page);
		setToken('jwt-abc');
		authStore.set({
			status: 'authenticated',
			personIdByDb: { polyphony: 'person-p', 'other-choir': 'person-q' },
			expMs: Date.now() + 100_000
		});
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
				{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).not.toBeNull()
		);

		selectedCollectiveDbStore.set('other-choir');
		// The whole panel unmounts while the new roster is in flight, so wait for it
		// to come BACK before judging it — an assertion during the load would pass
		// against the unresolved fix too.
		await waitFor(() => {
			const toggle = container.querySelector('[data-testid="roster-inactive-toggle"]');
			expect(toggle).not.toBeNull();
			// CLOSED, not merely emptied: the panel was opened against a roster that
			// is no longer on screen, so it has to be reopened against this one.
			expect(toggle!.getAttribute('aria-expanded')).toBe('false');
		});
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-inactive-list"]')).toBeNull();
	});

	// #255 review r3 F2(b) — `handleReinstate` already reloads the panel after its
	// write; `handleDeactivateConfirm` refreshed only the ACTIVE roster, so the
	// two lifecycle paths disagreed and the member who had just left the active
	// list was missing from the open panel she now belongs in.
	it('a deactivate with the panel OPEN refreshes the panel too — she belongs in it now', async () => {
		loadInactiveRosterMock.mockResolvedValue([]);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		// From the write onward she is in the inactive read.
		loadInactiveRosterMock.mockResolvedValue([
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
		]);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="inactive-member-row-m2"]')).not.toBeNull()
		);
		// The refresh is a REFRESH, not a switch — the panel stays open through it.
		expect(
			container.querySelector('[data-testid="roster-inactive-toggle"]')?.getAttribute('aria-expanded')
		).toBe('true');
	});

	it('a FAILED panel refresh after a deactivate is not reported as a failed deactivate — the write landed', async () => {
		loadInactiveRosterMock.mockResolvedValue([]);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		loadInactiveRosterMock.mockRejectedValue(new Error('inactive read failed'));
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
	});

	it('a NON-admin gets no inactive surface (reinstate is an admin write, done-when 7 symmetry)', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(inactiveRoster);
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('not-admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="section-toggle-unassigned"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).toBeNull();
	});
});

// #255 review F2 — fail-CLOSED was already pinned above; these pin fail-LOUD.
// Every failure path used to end at `console.error` alone, so the admin saw the
// control disarm itself over an unchanged row and nothing else — a silent
// no-op. The page's own idiom (`removeError`, #110 F1/F3) is a role="alert"
// naming the target and saying the old state still stands.
describe('(A/B) fail-LOUD — no lifecycle failure is allowed to be silent', () => {
	it('a rejected RIGHTS READ surfaces a role=alert on that row (not just a console line)', async () => {
		listDeactivateBlockersMock.mockRejectedValue(new Error('rights read failed'));
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-failed-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		// Names the member — the alert renders in a list of rows.
		expect(alert.textContent).toContain('Berta Bass');
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		// #286 done-when 5 — the alert stands NEXT TO the still-armed pair,
		// re-enabled for direct retry; the rest-state trigger never returned.
		const confirmAfter = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-confirm-m2"]'
		);
		expect(confirmAfter).not.toBeNull();
		expect(confirmAfter!.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('a rejected STATUS WRITE surfaces the same alert, and the roster is NOT refetched as if it worked', async () => {
		deactivateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = await renderRosterAs('admin');
		const rosterLoadsBefore = loadRosterMock.mock.calls.length;
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		expect(loadRosterMock.mock.calls.length).toBe(rosterLoadsBefore);
		// #286 done-when 5 — the failed write leaves the pair ARMED and
		// re-enabled beside the error, for direct retry (the #273 lifecycle).
		const confirmAfter = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-confirm-m2"]'
		);
		expect(confirmAfter).not.toBeNull();
		expect(confirmAfter!.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	// #286 REWORK — this test used to click the plain trigger post-failure to
	// clear the alert. Under the stays-armed lifecycle (done-when 5) that
	// trigger no longer exists post-failure: the pair sits armed next to the
	// error. The alert is still about the tap, not the row — so leaving the
	// lifecycle (explicit cancel) clears it, and a FRESH arm starts clean.
	it('cancel-then-rearm after a failure: cancel disarms AND clears the alert; a fresh arm starts with no stale alert', async () => {
		deactivateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		// Post-flight cancel: disarms AND clears the alert (done-when 4 — no
		// alert may stand against a disarmed row). Under the stays-armed
		// lifecycle the cancel is still on screen next to the error.
		const cancel = container.querySelector('[data-testid="member-deactivate-cancel-m2"]');
		expect(cancel, 'the pair must still be armed beside the failure alert').not.toBeNull();
		await fireEvent.click(cancel!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
		// Re-arm: a clean pair, no stale alert riding along.
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
	});

	it('a rejected REINSTATE surfaces a role=alert next to that inactive row — otherwise the tap produces no visible change at all', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue([
			{
				memberId: 'm9',
				personId: 'pp-9',
				name: 'Gone Girl',
				email: 'gone@example.com',
				sectionIds: ['sec-alto'],
				dbEntityId: 'db-1'
			}
		]);
		reinstateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-reinstate-failed-m9"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('Gone Girl');
		// She is still inactive — the row stays exactly where it was.
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).not.toBeNull();
	});
});

// ── #286 RED — the armed deactivate pair stays HONEST through the in-flight
// chain (the #273 arm-state lifecycle, on this page's OTHER armed pair) ──
//
// Premise on record (issue #286 + pre-build research, drift-checked against
// roster/+page.svelte at branch base):
//
//   - `pendingDeactivateId` stays SET through the whole async chain (two
//     awaited reads — resolveMyLibraryId, listDeactivateBlockers — then the
//     write), so the pair stays MOUNTED in flight... carrying no `disabled`
//     and no `aria-busy`: a live cancel sits under the admin's finger while
//     the deactivation lands. Cancel mid-flight disarms the UI and the write
//     lands anyway — the #253/#264 lying-affordance shape.
//   - WIDER than the issue's cancel-race framing (research finding): the
//     refusal branch nulls `pendingDeactivateId` in the same synchronous
//     block that sets `deactivateRefusal`, and the failure catch nulls it
//     before setting `deactivateActionError` — while both alerts render
//     purely by memberId match, never checking arm state. So done-when 4
//     ("an error or refusal cannot surface against a row the admin has
//     disarmed") is violated today on EVERY refusal and EVERY failure, not
//     only via a cancel race. The reworked refusal/fail-closed/fail-loud
//     specs above pin the stays-armed half; this block pins the in-flight
//     half and the cancel semantics.
//   - The binding invariant is `deactivatePending` ITSELF — deliberately NOT
//     `structuralWritePending` (deactivation is not a section-structural
//     write; the page's own `reinstatePending`-gated member-reinstate button
//     is the precedent for a lifecycle write carrying its own flag).
//   - SECOND VECTOR (research-found, same lie, this control's surface):
//     `pendingDeactivateId` is a SINGLE slot, and `armDeactivate` is
//     unguarded — arming a DIFFERENT row mid-flight steals the slot and
//     orphans the in-flight row's UI. Pinned below: no second row can be
//     armed while a deactivation is in flight.
//   - Labels UNCHANGED during pending — no new i18n keys (the agenda model
//     disables in place, it does not swap copy).
//   - SCOPE-FENCE ANSWER (the issue asks whether a THIRD armed pair exists):
//     none — the section-remove pair (#273) and this one are the only two;
//     the record-editor and section-create cancels are direct-write forms (a
//     different class) and inline rename is a different UI shape.
//
// Timing proofs are deterministic (house method): release-controlled mocks,
// held at BOTH suspension kinds — the blocker read and the write.
describe('(A) #286 — the armed pair through the in-flight deactivate: mounted, disabled, aria-busy; cancel inert; one write; one arm slot', () => {
	function deferred<T = void>() {
		let resolve!: (v: T) => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	it('while the BLOCKER READ is in flight the pair stays mounted — both halves disabled, confirm aria-busy, labels unchanged', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		// Suspended INSIDE the read — the whole chain is one in-flight state.
		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el, 'confirm must stay mounted through the chain').not.toBeNull();
			expect(el!.disabled).toBe(true);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		);
		expect(cancel, 'cancel must stay mounted through the chain').not.toBeNull();
		expect(cancel!.disabled).toBe(true);
		// No new i18n keys: the pending face keeps the SAME labels (the Proxy
		// message mock renders key names, so these pin the keys themselves).
		expect(confirm.textContent).toContain('roster_member_deactivate_confirm');
		expect(cancel!.textContent).toContain('roster_member_deactivate_cancel');
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		// Release with no blockers: the chain completes honestly.
		gate.resolve([]);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
	});

	it('while the WRITE is in flight the pair is disabled + confirm aria-busy — a double-tap cannot fire two writes; release → she leaves the roster and the pair disarms', async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el, 'confirm must stay mounted through the write').not.toBeNull();
			expect(el!.disabled).toBe(true);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		expect(
			container.querySelector<HTMLButtonElement>('[data-testid="member-deactivate-cancel-m2"]')!
				.disabled
		).toBe(true);

		// Double-tap (the #273 spec shape): attribute AND guard — a second tap
		// on the still-mounted confirm writes nothing more.
		await fireEvent.click(confirm);
		confirm.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);

		// SUCCESS is the ONE outcome that disarms: from the write onward she is
		// out of the active reads — refetch, row gone, pair gone with it.
		loadRosterMock.mockResolvedValue([rosterTwo[0]]);
		gate.resolve();
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).toBeNull();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
	});

	it('CANCEL during the held BLOCKER READ is INERT — no disarm, the pair stays mounted; release → the outcome lands honestly', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		// The "cancel that does not cancel" (#253/#264 shape): mid-read, cancel
		// must do NOTHING — attribute and guard both.
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		await fireEvent.click(cancel);
		cancel.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			'the pair must not disarm while the chain is in flight'
		).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(
			container.querySelector('[data-testid="member-deactivate-m2"]'),
			'the rest-state trigger must never render while the chain is running'
		).toBeNull();

		// Release: the chain proceeds to the write — the tap changed nothing.
		gate.resolve([]);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
	});

	it('CANCEL during the held WRITE is INERT — release → the deactivation LANDS: refetch, row gone, never "stopped"', async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		await fireEvent.click(cancel);
		cancel.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			'cancel mid-write must not imply the deactivation was stopped'
		).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		// Release: the write LANDS and the UI says so — refetch, she is gone.
		// Nothing about the mid-flight cancel tap changed the outcome.
		loadRosterMock.mockResolvedValue([rosterTwo[0]]);
		gate.resolve();
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-row-m2"]')).toBeNull()
		);
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
	});

	it('a SECOND row cannot be armed mid-flight — the single arm slot is never stolen from the in-flight row', async () => {
		loadRosterMock.mockResolvedValue([
			...rosterTwo,
			{ memberId: 'm3', personId: 'pp-3', name: 'Carla Cantus', email: 'carla@example.com', sectionIds: [], dbEntityId: 'db-1' }
		]);
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m3"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		// Arming m3 while m2's write is in flight would repoint the single
		// `pendingDeactivateId` slot and ORPHAN m2's in-flight UI. Attribute
		// and guard both — a disabled attr alone does not stop a direct click.
		const trigger3 = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-m3"]'
		)!;
		await fireEvent.click(trigger3);
		trigger3.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m3"]'),
			'no second row may arm while a deactivation is in flight'
		).toBeNull();
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			"the in-flight row's pair must survive the attempted steal"
		).not.toBeNull();

		gate.resolve();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
	});

	it('REFUSAL (held read): the pair stays ARMED and re-enabled beside the refusal — explicit cancel disarms AND clears it (done-when 4)', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		gate.resolve([{ role: 'admin' }]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-refused-m2"]')).not.toBeNull()
		);
		// Blockers listed, pair armed and re-enabled: the admin cancels out, or
		// removes the grant elsewhere and retries through the SAME confirm.
		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el).not.toBeNull();
			expect(el!.disabled).toBe(false);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).not.toBe('true');
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		expect(cancel.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();

		// Post-flight cancel: disarm AND clear — no refusal may stand against a
		// disarmed row (done-when 4, by construction not by luck).
		await fireEvent.click(cancel);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-refused-m2"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
	});

	it('FAILURE (held write): the pair stays ARMED and re-enabled beside the error — direct retry through the SAME confirm succeeds', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		gate.reject(new Error('500'));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		// The #273 retry convention: armed id cleared ONLY on success — the pair
		// sits re-enabled next to the error, aria-busy gone, trigger never back.
		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el).not.toBeNull();
			expect(el!.disabled).toBe(false);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).not.toBe('true');
		expect(
			container.querySelector<HTMLButtonElement>('[data-testid="member-deactivate-cancel-m2"]')!
				.disabled
		).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		// Direct retry — the SAME still-armed confirm, no re-arming dance. The
		// retry's own start clears the stale failure alert.
		deactivateMemberMock.mockResolvedValue(undefined);
		loadRosterMock.mockResolvedValue([rosterTwo[0]]);
		await fireEvent.click(confirm);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

// #259 RED — filed from #255's round-4 review. The three inactive-panel
// loads (panel open, post-deactivate refresh, post-reinstate refresh) each
// await `loadInactiveRoster(cfg)` with cfg captured EARLIER and assign
// `inactiveRows` with no check that the selected collective is still the one
// the load was started for. The #255 switch-reset (pinned above by 'switching
// collectives clears the panel' — a POST-settle switch, a different case)
// closes and empties the panel; then the stale promise settles and silently
// repopulates `inactiveRows` while the panel is CLOSED, so the next open on
// the NEW collective renders the OLD collective's members — each with a live
// Reinstate button aimed at a member id that does not exist here.
//
// The race tests are deterministic (house method for timing proofs): the
// loadInactiveRoster mock is release-controlled (same shape as the 'second
// tap while the reinstate is in flight' test above), so the ordering is
// hold → switch → settle-stale → reopen, and the failure trips on the
// panel-content assertion — never on a timeout.
//
// The NON-race test is the trap detector: `loadForSelected()` bumps the
// route-load machine's generation unconditionally, and both lifecycle
// handlers call it BEFORE their panel reload — so a guard generation captured
// at function ENTRY is already stale by the vulnerable await and would
// silently skip the reload on EVERY ordinary deactivate/reinstate with the
// panel open (a broken normal path, worse than the race). The
// ordinary-reinstate refresh below and the existing 'a deactivate with the
// panel OPEN refreshes the panel too' above fail under exactly that
// mis-capture; the guard must be captured AFTER each handler's own
// loadForSelected() call (entry-capture is only correct in toggleInactive,
// which never self-refreshes).
describe('(B) #259 — in-flight inactive-panel loads must not outlive a collective switch', () => {
	type InactiveRow = {
		memberId: string;
		personId: string;
		name: string;
		email: string;
		sectionIds: string[];
		dbEntityId: string;
	};

	// Collective A's (polyphony's) inactive member — the rows a stale settle
	// tries to smuggle under collective B's roster.
	const goneGirl: InactiveRow = {
		memberId: 'm9',
		personId: 'pp-9',
		name: 'Gone Girl',
		email: 'gone@example.com',
		sectionIds: [],
		dbEntityId: 'db-1'
	};

	function setAuthedWithTwoCollectives() {
		setToken('jwt-abc');
		authStore.set({
			status: 'authenticated',
			personIdByDb: { polyphony: 'person-p', 'other-choir': 'person-q' },
			expMs: Date.now() + 100_000
		});
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
				{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');
	}

	// Every loadInactiveRoster call is HELD until the test releases it — the
	// deterministic race construction needs the settle order in the test's
	// hands, call by call.
	function holdInactiveLoads(): Array<(rows: InactiveRow[]) => void> {
		const settlers: Array<(rows: InactiveRow[]) => void> = [];
		loadInactiveRosterMock.mockImplementation(
			() =>
				new Promise<InactiveRow[]>((resolve) => {
					settlers.push(resolve);
				})
		);
		return settlers;
	}

	async function renderTwoCollectiveRoster() {
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		return utils;
	}

	async function switchToOtherChoir(container: HTMLElement) {
		selectedCollectiveDbStore.set('other-choir');
		// Wait for the NEW collective's roster to be on screen with the panel
		// reset (#255 r3 F2: switch closes it) before settling anything stale.
		await waitFor(() => {
			const toggle = container.querySelector('[data-testid="roster-inactive-toggle"]');
			expect(toggle).not.toBeNull();
			expect(toggle!.getAttribute('aria-expanded')).toBe('false');
		});
	}

	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("a PANEL-OPEN load that settles after a switch writes NOTHING — reopening on the new collective never renders the old one's rows", async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();

		// Start collective A's panel load and leave it in flight.
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));

		// Switch mid-flight; the #255 reset closes and empties the panel.
		await switchToOtherChoir(container);

		// The STALE promise settles with A's rows — a guarded site discards it.
		settlers[0]!([goneGirl]);
		await flush();

		// Reopen on B with B's OWN load still in flight: the template renders
		// whatever `inactiveRows` holds right now. Pre-fix the stale settle
		// repopulated it, so A's member renders here with a live Reinstate
		// button aimed at an id that does not exist in this collective.
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();

		// B's genuine load lands empty — the panel shows B's own truth.
		settlers[1]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();
	});

	it('a POST-DEACTIVATE panel reload that settles after a switch writes NOTHING', async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();
		// Rows live in the collapsed Unassigned group — expand to reach m2.
		await fireEvent.click(container.querySelector('[data-testid="section-toggle-unassigned"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-row-m2"]')).not.toBeNull()
		);

		// Panel open and idle on A (its own load settles empty, cleanly).
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		settlers[0]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);

		// Deactivate m2 with the panel open — the write lands, the roster
		// refetches, and the panel reload (the vulnerable await) goes in flight.
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));

		// Switch mid-flight, then settle the stale reload with A's view of her.
		await switchToOtherChoir(container);
		settlers[1]!([
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
		]);
		await flush();

		// Reopen on B: A's freshly-deactivated member must NOT be here.
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(3));
		expect(container.querySelector('[data-testid="inactive-member-row-m2"]')).toBeNull();

		settlers[2]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
	});

	it('a POST-REINSTATE panel reload that settles after a switch writes NOTHING', async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();

		// Panel open on A, showing her inactive member.
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		settlers[0]!([goneGirl]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);

		// Reinstate her — the write lands and the panel reload goes in flight.
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));

		// Switch mid-flight, then settle the stale reload with A's rows.
		await switchToOtherChoir(container);
		settlers[1]!([goneGirl]);
		await flush();

		// Reopen on B: A's rows must not have been smuggled in.
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(3));
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();

		settlers[2]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
	});

	// TRAP DETECTOR — must stay green through the fix. `handleReinstate` calls
	// `await loadForSelected()` (which bumps the generation) BEFORE its panel
	// reload, so a guard generation captured at function ENTRY reads stale on
	// every ORDINARY reinstate and silently skips this refresh: her row would
	// stay in the open panel after she went active. Together with the existing
	// 'a deactivate with the panel OPEN refreshes the panel too' (the
	// deactivate-side mirror, above), this pins the correct capture point:
	// AFTER each handler's own loadForSelected() call.
	it('NON-RACE: an ordinary reinstate with the panel open still refreshes it — she leaves the panel', async () => {
		loadInactiveRosterMock.mockResolvedValue([goneGirl]);
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);

		// From the write onward she is back in the ACTIVE reads only.
		loadInactiveRosterMock.mockResolvedValue([]);
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));

		// The panel REFRESHES (row gone, empty copy in) and STAYS OPEN — a
		// mis-captured guard would skip the reload and leave her row standing.
		await waitFor(() =>
			expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull()
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
		expect(
			container.querySelector('[data-testid="roster-inactive-toggle"]')?.getAttribute('aria-expanded')
		).toBe('true');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin* — fail-LOUD regression block, #255 review F2)
// (*MVOX:Tallis* — #259 in-flight-guard RED block)
// (*MVOX:Tallis* — #286 in-flight armed-pair RED block + stays-armed reworks)
