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
// Data mechanics (clear-then-set wire, status-only write, _parent untouched)
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
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

	// #255 review round 2 F2 — `reinstateMember` is a clear-then-set pair, so two
	// concurrent runs both read the same status value id, the first DELETE wins,
	// the second gets a non-2xx and throws — rendering "couldn't be reinstated —
	// they're still not active" over a reinstate that DID happen. The in-flight
	// guard (the deactivate path already has one) makes that unreachable.
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
	});

	it('re-arming the confirm clears a previous failure alert — it is about the tap that just failed, not the row', async () => {
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
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull()
		);
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

// (*MVOX:Tallis*)
// (*MVOX:Josquin* — fail-LOUD regression block, #255 review F2)
