// @vitest-environment happy-dom
//
// #257 RED — the three profile keys #229 held back reach their screens.
//
// The R1 key census (#229) found profile_repair_done / profile_visibility_title
// / profile_visibility_intro translated in all four locales but referenced only
// from spec mocks — the surfaces they were written for were never finished. PO
// ruling: keep all three, wire all three. This file pins the wiring:
//
//  1. A successful visibility repair ANNOUNCES itself. Today
//     VisibilityRepairBanner has zero success-path markup — `repairPlans` is
//     $derived off `loadedProfiles`, so a successful repair drops the field
//     and the banner unmounts with no announcement (silent in the strongest
//     sense: an unmount announces nothing to a screen reader). The fix must
//     match the app's ONE confirmation idiom (issue AC2 — do not invent a
//     second shape): a PERSISTENT `role="status"` `aria-live="polite"` region
//     whose text is set imperatively from plain state, exactly like
//     `event-create-status` (routes/+page.svelte) and `roster-reorder-status`
//     (routes/roster/+page.svelte) — NOT a conditionally-mounted node, and NOT
//     a setTimeout auto-dismiss (the app has zero timer-dismiss patterns;
//     "transient" here means cleared at the START of the next repair attempt,
//     the same way eventCreateStatus/reorderStatus are cleared at the top of
//     the next action).
//
//  2. The per-field visibility picker list gains its missing title and
//     operating instruction: a REAL h2 (the page's only sectioning precedent
//     is the Linked Accounts h2) carrying profile_visibility_title immediately
//     above the field list, with profile_visibility_intro as its explanatory
//     line. profile_intro stays where it is — page intro and control
//     explanation are complementary.
//
//  FOLD-IN (#260 review note 2, Gama-approved for this visit): the #260
//  stale-rejection guard in refreshCompletionGate swallows EVERY rejection —
//  including a LIVE (current-generation) failure to resolve membership
//  standing, which today vanishes without a trace. Pin: a live rejection
//  reaches console.error; a stale one stays silent (the existing race spec in
//  page.profile-completion-gate-race.spec.ts pins the stale half's
//  store/DOM silence — here the console-silence half is added, and that spec
//  MUST stay green untouched).
//
// Every test renders the REAL /profile route component (integration, not an
// isolated unit): the repair flow drives the real planLoadedDuplicateRepairs /
// fieldMoveQueue machinery (only the applyDuplicateRepair write primitive is
// mocked), so the announcement is pinned as wired into the actual page.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		profile_title: () => 'Your profile',
		profile_intro: () => 'Fill in your name and email.',
		profile_completion_required: () => 'Please add your name to continue.',
		profile_no_collective: () => 'Select a collective.',
		profile_load_error: () => 'Could not load your profile.',
		profile_load_retry: () => 'Retry',
		profile_field_name_label: () => 'Name',
		profile_field_email_label: () => 'Email',
		profile_name_edit_label: () => 'Edit name',
		profile_email_edit_label: () => 'Edit email',
		profile_level_public_label: () => 'Public',
		profile_level_public_hint: () => 'Anyone.',
		profile_level_domain_label: () => 'Collective',
		profile_level_domain_hint: () => 'Members.',
		profile_level_private_label: () => 'Private',
		profile_level_private_hint: () => 'Only you.',
		profile_save: () => 'Save',
		profile_saving: () => 'Saving…',
		profile_saved: () => 'Saved',
		profile_save_error: () => "Couldn't save — please try again.",
		profile_name_private_disabled: () => 'Name cannot be private',
		// #257 — the three held-back keys. The English mock strings below are
		// what the DOM assertions read, so a hit proves the COMPONENT calls the
		// m.* function (the house key-wiring proof, same as every other spec).
		profile_visibility_title: () => 'Who can see each field',
		profile_visibility_intro: () => 'Pick an icon to move a field.',
		profile_repair_done: () => 'Visibility change completed.',
		profile_visibility_active: (p: { level: string }) => `Visible at ${p.level}`,
		profile_visibility_move: (p: { field: string; level: string }) =>
			`Move ${p.field} to ${p.level}`,
		profile_visibility_moving: () => 'Moving…',
		profile_visibility_leak: (p: { level: string }) => `Still readable at ${p.level}`,
		profile_visibility_conflict: (p: { field: string }) =>
			`Your ${p.field} has different values at more than one level.`,
		profile_visibility_confirm_preview: (p: { level: string }) => `Tap again to keep ${p.level}`,
		profile_visibility_preview_note: () => 'Tap again to keep this version.',
		profile_move_error: () => "Couldn't change visibility. Nothing was lost — please try again.",
		profile_repair_title: () => 'Unfinished visibility change',
		profile_repair_body_tightening: (p: { field: string; level: string }) =>
			`Your ${p.field} is still readable at ${p.level}.`,
		profile_repair_body_widening: (p: { field: string; level: string }) =>
			`An old copy of your ${p.field} is still at ${p.level}.`,
		profile_repair_body_loaded: (p: { field: string; level: string }) =>
			`An unfinished change left your ${p.field} readable at ${p.level}.`,
		profile_repair_action: () => 'Finish now',
		profile_repair_working: () => 'Finishing…',
		profile_repair_error: (p: { field: string; level: string }) =>
			`Couldn't finish. Your ${p.field} is still readable at ${p.level}.`,
		profile_sign_out: () => 'Sign out',
		profile_signed_in_as: (p: { account: string; provider: string }) =>
			`Signed in as ${p.account} via ${p.provider}`,
		profile_language_label: () => 'Language',
		profile_time_format_label: () => 'Time format',
		profile_time_format_24h: () => '24-hour',
		profile_time_format_ampm: () => 'AM/PM',
		profile_time_format_hint: () => 'Applies on this device.',
		profile_linked_accounts_title: (p: { collective: string }) =>
			`Sign-ins that work for ${p.collective}`,
		profile_link_another: () => 'Link another account',
		profile_link_choose_provider: () => 'Choose a provider to link',
		profile_link_error_conflict: () => 'That account is already in use by another member here.',
		profile_link_error_dead: () => 'The link attempt expired or was already used.',
		profile_link_error_failed: () => 'Linking failed — you can try again.',
		profile_link_error_missing_rights: () =>
			'Your account is missing the rights needed to link another sign-in.',
		profile_link_error_already_linked: () => 'That sign-in is already linked to your account.',
		profile_link_error_step: (p: { step: string }) =>
			`Linking could not be completed — it stopped at step: ${p.step}. You can try again.`,
		profile_link_success: (p: { collective: string }) =>
			`That sign-in now works for ${p.collective}.`,
		profile_link_cancel: () => 'Cancel',
		auth_provider_smart_id: () => 'Smart-ID',
		auth_provider_mobile_id: () => 'Mobile-ID',
		auth_provider_id_card: () => 'ID-card',
		auth_provider_e_mail: () => 'E-mail',
		auth_provider_google: () => 'Google',
		auth_provider_apple: () => 'Apple'
	}
}));

const h = vi.hoisted(() => ({
	listMyProfilesMock: vi.fn(),
	applyProfileSaveMock: vi.fn(),
	applyDuplicateRepairMock: vi.fn(),
	resolveGateMock: vi.fn()
}));

// Mock ONLY the applyDuplicateRepair write primitive; planLoadedDuplicateRepairs
// and the rest of fieldMove stay REAL — the repair banners below are driven by
// the actual load-detection machinery (page.profile.spec.ts precedent for the
// applyConflictResolution partial mock).
vi.mock('$lib/profile/fieldMove', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/profile/fieldMove')>('$lib/profile/fieldMove');
	return { ...actual, applyDuplicateRepair: h.applyDuplicateRepairMock };
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
	ProfileSaveError: class ProfileSaveError extends Error {}
}));
// Override ONLY resolveGate; keep the REAL store so the fold-in assertions read
// the one SSOT instance (page.profile-completion-gate-race.spec.ts precedent).
vi.mock('$lib/profile/completionGate', async (importActual) => {
	const actual = await importActual<typeof import('$lib/profile/completionGate')>();
	return { ...actual, resolveGate: h.resolveGateMock };
});
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] })
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './profile/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { get } from 'svelte/store';
import { completionGateStore, resetGate, type GateState } from '$lib/profile/completionGate';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Drain the microtask queue so a just-settled promise chain fully lands
 *  (usable under fake timers, where waitFor's polling interval would hang). */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

function selectPolyphony() {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

async function waitReady(container: HTMLElement): Promise<void> {
	await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
}

/** The confirmation region — the house `role="status"` idiom
 *  (event-create-status / roster-reorder-status: a PERSISTENT live region whose
 *  text is set imperatively, never a conditionally-mounted node). */
function statusRegion(container: HTMLElement): HTMLElement | null {
	return q(container, '[data-testid="profile-repair-status"]') as HTMLElement | null;
}
function statusText(container: HTMLElement): string {
	return (statusRegion(container)?.textContent ?? '').trim();
}

// DOM-order helper: true when `b` comes after `a` in document order.
const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
function precedes(a: Element, b: Element): boolean {
	return (a.compareDocumentPosition(b) & FOLLOWING) !== 0;
}

/** Deepest element whose entire trimmed text equals `text` (querySelectorAll
 *  is document-order, parents before children — the last match is innermost). */
function byExactText(container: HTMLElement, text: string): Element | null {
	const all = Array.from(container.querySelectorAll('*')).filter(
		(el) => (el.textContent ?? '').trim() === text
	);
	return all.length > 0 ? all[all.length - 1] : null;
}

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
	h.applyDuplicateRepairMock.mockReset();
	h.resolveGateMock.mockReset();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

// ---------------------------------------------------------------------------
// 1. profile_repair_done — a successful repair announces itself.
// ---------------------------------------------------------------------------
describe('#257 — repair confirmation announcement (profile_repair_done)', () => {
	it('the status region is PERSISTENT: mounted (empty) from first ready render, role="status" aria-live="polite" — even with no repair pending', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);

		// No duplicate → no banner — the region must exist anyway (the house
		// idiom: a persistent live region a screen reader is already watching
		// BEFORE the announcement text arrives as a content change).
		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
		const region = statusRegion(container);
		expect(region, 'persistent profile-repair-status region must render with the ready surface').not.toBeNull();
		expect(region!.getAttribute('role')).toBe('status');
		expect(region!.getAttribute('aria-live')).toBe('polite');
		expect(statusText(container)).toBe('');
	});

	it('fail THEN succeed in one flow: failure shows profile_repair_error (no done announcement); the successful retry announces profile_repair_done and the banner unmounts', async () => {
		selectPolyphony();
		// Same value at two levels = an interrupted move → the REAL
		// planLoadedDuplicateRepairs mounts the repair banner for `name`.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull()
		);
		// Region present and empty BEFORE any attempt.
		expect(statusRegion(container)).not.toBeNull();
		expect(statusText(container)).toBe('');

		// Attempt 1 — the repair write FAILS. Today's error path must be
		// byte-unchanged: profile_repair_error inside the kept banner (its
		// outer div already carries role="alert"), and NO done announcement.
		h.applyDuplicateRepairMock.mockRejectedValueOnce(new Error('repair delete failed: 502'));
		const fix = q(
			container,
			'[data-testid="profile-visibility-repair-name-fix"]'
		) as HTMLButtonElement;
		await fireEvent.click(fix);
		await waitFor(() =>
			expect(
				q(container, '[data-testid="profile-visibility-repair-name-error"]')
			).not.toBeNull()
		);
		expect(
			q(container, '[data-testid="profile-visibility-repair-name-error"]')!.textContent
		).toBe("Couldn't finish. Your Name is still readable at Collective.");
		// Failure is NOT success — the confirmation region carries nothing.
		expect(statusText(container)).toBe('');
		// Preserve-on-error: the banner is kept.
		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull();

		// Attempt 2 — the repair SUCCEEDS. The reload now finds a single
		// holder, the banner unmounts (unchanged behavior), and the
		// announcement text arrives in the persistent region as a content
		// change — the screen-reader-audible confirmation that a change to who
		// can see this person's data actually landed.
		h.applyDuplicateRepairMock.mockResolvedValueOnce({
			field: 'name',
			clearedIds: ['prof-dom']
		});
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: '', email: '', _sharing: 'domain' }
		]);
		// #257 review F1 — the SAME node must carry the text afterwards. The
		// success path reloads, and the reload writes status='loading'
		// synchronously; a region living inside the ready branch would be
		// destroyed and remounted with its text already in place, which announces
		// NOTHING (a live region announces only changes to a region the AT was
		// already watching). Asserting final textContent alone cannot see that.
		const regionBefore = statusRegion(container);
		await fireEvent.click(fix);
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
			expect(statusText(container)).toBe('Visibility change completed.');
		});
		expect(
			statusRegion(container),
			'the live region must SURVIVE the post-repair reload — same node, not a remount'
		).toBe(regionBefore);

		// Full-shape: the repair write got the exact plan the banner surfaced —
		// keep the narrowest holder (private), clear the wider (domain) copy,
		// preserving its sibling email value.
		expect(h.applyDuplicateRepairMock).toHaveBeenCalledTimes(2);
		expect(h.applyDuplicateRepairMock.mock.calls[1][0]).toEqual({
			cfg: { db: 'polyphony', token: 'jwt-member' },
			field: 'name',
			clear: [{ id: 'prof-dom', sibling: '' }]
		});
	});

	it('transient per the house pattern: the announcement clears at the START of the next repair attempt — and NEVER by a timer', async () => {
		selectPolyphony();
		// BOTH fields duplicated → two independent repair plans, letting a
		// second attempt start after the first success.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'p-priv', name: 'Ada', email: 'ada@x.io', _sharing: 'private' },
			{ _id: 'p-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull();
			expect(q(container, '[data-testid="profile-visibility-repair-email"]')).not.toBeNull();
		});

		// Repair NAME successfully → announcement lands.
		h.applyDuplicateRepairMock.mockResolvedValueOnce({ field: 'name', clearedIds: ['p-dom'] });
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'p-priv', name: 'Ada', email: 'ada@x.io', _sharing: 'private' },
			{ _id: 'p-dom', name: '', email: 'ada@x.io', _sharing: 'domain' }
		]);
		await fireEvent.click(
			q(container, '[data-testid="profile-visibility-repair-name-fix"]') as HTMLButtonElement
		);
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
			expect(statusText(container)).toBe('Visibility change completed.');
		});

		// Start the EMAIL repair attempt, holding its write in flight: the
		// stale announcement must clear at the START of the attempt (the
		// eventCreateStatus/reorderStatus pattern — cleared at the top of the
		// next action), not when/if it settles.
		const emailWrite = deferred<{ field: string; clearedIds: string[] }>();
		h.applyDuplicateRepairMock.mockReturnValueOnce(emailWrite.promise);
		await fireEvent.click(
			q(container, '[data-testid="profile-visibility-repair-email-fix"]') as HTMLButtonElement
		);
		await waitFor(() => expect(statusText(container)).toBe(''));
		// The attempt really is in flight (banner kept, button busy).
		expect(q(container, '[data-testid="profile-visibility-repair-email"]')).not.toBeNull();

		// Settle the email repair under FAKE timers and prove the announcement
		// is NOT on a clock: it lands, then survives a full minute of timer
		// advance. (The app has zero setTimeout auto-dismiss patterns — a
		// timer here would be the first, and AC2 forbids inventing one.)
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'p-priv', name: 'Ada', email: 'ada@x.io', _sharing: 'private' },
			{ _id: 'p-dom', name: '', email: '', _sharing: 'domain' }
		]);
		vi.useFakeTimers();
		emailWrite.resolve({ field: 'email', clearedIds: ['p-dom'] });
		await flushMicrotasks();
		expect(statusText(container)).toBe('Visibility change completed.');
		expect(q(container, '[data-testid="profile-visibility-repair-email"]')).toBeNull();

		vi.advanceTimersByTime(60_000);
		await flushMicrotasks();
		expect(
			statusText(container),
			'the announcement must persist until the next attempt — no auto-dismiss timer'
		).toBe('Visibility change completed.');
	});

	// #257 review F1 — structural: the region lives OUTSIDE the `status` gate, so
	// it is mounted through the loading state the post-repair reload passes
	// through. Pinned on the initial load (same gate, observable without a repair).
	it('the region is outside the status gate: mounted while status is still loading, before the ready surface exists', async () => {
		selectPolyphony();
		const firstLoad = deferred<Array<Record<string, string>>>();
		h.listMyProfilesMock.mockReturnValueOnce(firstLoad.promise);
		const { container } = render(Page);

		await waitFor(() => expect(h.listMyProfilesMock).toHaveBeenCalledTimes(1));
		// Still loading — the ready surface is absent…
		expect(q(container, '[data-testid="profile-field-name"]')).toBeNull();
		// …and the live region is present anyway.
		expect(
			statusRegion(container),
			'profile-repair-status must not be gated on `status` — a region that mounts alongside its own text announces nothing'
		).not.toBeNull();

		firstLoad.resolve([{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }]);
		await waitReady(container);
	});

	// #257 review F2 — the same stale-settle class the #260 guard covers for
	// refreshCompletionGate. loadForSelected() RESOLVES on every branch, a
	// superseded one included, so an un-gated `.then()` would announce collective
	// A's repair over collective B's profile.
	it('a superseded post-repair reload never announces: switching collectives mid-reload leaves the new profile silent', async () => {
		setToken('jwt-member');
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
				{ db: 'bravura', name: 'Bravura', personId: 'person-b' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');
		// A loads with a duplicated `name` → the real machinery mounts the banner.
		h.listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'bravura'
				? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' }]
				: [
						{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
						{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
					]
		);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull()
		);

		// The repair write succeeds; A's post-repair reload is HELD in flight.
		h.applyDuplicateRepairMock.mockResolvedValueOnce({ field: 'name', clearedIds: ['prof-dom'] });
		const heldReload = deferred<Array<Record<string, string>>>();
		h.listMyProfilesMock.mockReturnValueOnce(heldReload.promise);
		await fireEvent.click(
			q(container, '[data-testid="profile-visibility-repair-name-fix"]') as HTMLButtonElement
		);
		await waitFor(() => expect(h.listMyProfilesMock).toHaveBeenCalledTimes(2));

		// Switch to B while A's reload is still pending — B's own load bumps the
		// generation and resetState()s repairStatus back to ''.
		selectedCollectiveDbStore.set('bravura');
		await waitFor(() =>
			expect((q(container, '[data-testid="profile-name-value"]')?.textContent ?? '').trim()).toBe(
				'Bea'
			)
		);
		expect(statusText(container)).toBe('');

		// A's reload settles now — superseded. It must announce nothing.
		heldReload.resolve([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: '', email: '', _sharing: 'domain' }
		]);
		await flushMicrotasks();
		expect(
			statusText(container),
			"a stale reload must not announce collective A's repair on collective B's profile"
		).toBe('');
	});
});

// ---------------------------------------------------------------------------
// 2. profile_visibility_title + profile_visibility_intro — the field list
//    becomes a titled, explained section.
// ---------------------------------------------------------------------------
describe('#257 — visibility section heading (profile_visibility_title / profile_visibility_intro)', () => {
	async function renderReady(): Promise<HTMLElement> {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);
		return container;
	}

	it('a REAL h2 carries profile_visibility_title immediately above the field list, with profile_visibility_intro as its explanatory line', async () => {
		const container = await renderReady();

		const fieldList = q(container, '[data-testid="profile-field-name"]')!;
		// Helper sanity on elements that exist TODAY (guards the DOM-order
		// helper itself): the page intro precedes the field list.
		const pageIntro = byExactText(container, 'Fill in your name and email.');
		expect(pageIntro).not.toBeNull();
		expect(precedes(pageIntro!, fieldList)).toBe(true);

		// The heading: a real <h2> in the page's existing hierarchy (the
		// Linked Accounts h2 is the page's one sectioning precedent — issue
		// AC7: a heading element, not a styled div).
		const headings = Array.from(container.querySelectorAll('h2'));
		const visHeading = headings.find(
			(el) => (el.textContent ?? '').trim() === 'Who can see each field'
		);
		expect(
			visHeading,
			'an <h2> carrying profile_visibility_title must render on the ready surface'
		).not.toBeUndefined();

		// Its explanatory line — the control's entire operating instruction
		// (one level per field; tapping an icon is what moves it).
		const introLine = byExactText(container, 'Pick an icon to move a field.');
		expect(
			introLine,
			'profile_visibility_intro must render as the section\'s explanatory line'
		).not.toBeNull();

		// Placement: heading → intro line → field list, all before the Linked
		// Accounts section.
		expect(precedes(visHeading!, introLine!)).toBe(true);
		expect(precedes(introLine!, fieldList)).toBe(true);
		const linkedHeading = headings.find((el) =>
			(el.textContent ?? '').includes('Sign-ins that work for')
		);
		expect(linkedHeading, 'the Linked Accounts h2 stays').not.toBeUndefined();
		expect(precedes(fieldList, linkedHeading!)).toBe(true);
	});

	it('profile_intro stays where it is — the page intro precedes the new section heading (the two are complementary, not merged)', async () => {
		const container = await renderReady();

		const pageIntro = byExactText(container, 'Fill in your name and email.');
		expect(pageIntro, 'profile_intro must stay on the page').not.toBeNull();

		const h1 = q(container, 'h1')!;
		expect(precedes(h1, pageIntro!)).toBe(true);

		const visHeading = Array.from(container.querySelectorAll('h2')).find(
			(el) => (el.textContent ?? '').trim() === 'Who can see each field'
		);
		expect(visHeading).not.toBeUndefined();
		expect(
			precedes(pageIntro!, visHeading!),
			'the page intro introduces the page — it stays ABOVE the visibility section heading'
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// FOLD-IN (#260 note 2) — refreshCompletionGate's rejection handler must
// distinguish stale from live: stale stays silent (the race fix), a LIVE
// failure to resolve membership standing reaches console.error.
// ---------------------------------------------------------------------------
describe('#257 fold-in — live resolveGate rejection is logged, stale stays silent (#260 note 2)', () => {
	const COLLECTIVE_A = { db: 'polyphony', name: 'Polyphony', personId: 'person-p' };
	const COLLECTIVE_B = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

	function wireProfilesPerCollective(): void {
		h.listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'bravura'
				? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' }]
				: [{ _id: 'prof-a-dom', name: 'Ada', email: '', _sharing: 'domain' }]
		);
	}

	function signInWithTwoCollectives(): void {
		setToken('jwt-member');
		collectiveState.set({
			status: 'ready',
			collectives: [COLLECTIVE_A, COLLECTIVE_B],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');
	}

	function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
		return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
	}

	async function waitReadyShowing(container: HTMLElement, name: string): Promise<void> {
		await waitFor(() => {
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull();
			expect(displayValue(container, 'name')).toBe(name);
		});
	}

	async function openEditor(container: HTMLElement, field: 'name' | 'email') {
		const btn = q(container, `[data-testid="profile-${field}-edit"]`) as HTMLButtonElement | null;
		expect(btn, `profile-${field}-edit must render in display state`).not.toBeNull();
		await fireEvent.click(btn!);
		let editorInput: HTMLInputElement | null = null;
		await waitFor(() => {
			editorInput = q(container, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;
			expect(editorInput).not.toBeNull();
		});
		return editorInput!;
	}

	/** Initiate the gate re-read the way the app does: a domain-level name
	 *  save settles → the queue's reconcile → refreshCompletionGate →
	 *  resolveGate, whose promise the test holds. */
	async function saveNameToInitiateGateRead(
		container: HTMLElement,
		newName: string
	): Promise<void> {
		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: newName } });
		await fireEvent.blur(nameInput);
		await waitFor(() => expect(h.resolveGateMock).toHaveBeenCalledTimes(1));
	}

	it('a LIVE (current-generation) resolveGate rejection reaches console.error — a real failure to resolve membership standing must not vanish', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		wireProfilesPerCollective();
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const liveRead = deferred<GateState>();
		h.resolveGateMock.mockReturnValueOnce(liveRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada M.');

		// NO switch — the read is still current when it rejects.
		const err = new Error('resolveGate: network down');
		liveRead.reject(err);
		await flushMicrotasks();

		// The failure is LOGGED (like every other failure in this file — the
		// house console.error shape), exactly once, carrying the error itself.
		const logged = consoleSpy.mock.calls.filter((args) => args.includes(err));
		expect(
			logged,
			'a live resolveGate rejection must reach console.error with the error object'
		).toHaveLength(1);
		// And it still writes nothing to the SSOT — logging, not corrupting.
		expect(get(completionGateStore)).toBe('loading');
		consoleSpy.mockRestore();
	});

	it('a STALE rejection (after a collective switch) stays fully silent — no console.error either', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		wireProfilesPerCollective();
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		h.resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada M.');

		// Switch to B while A's read is in flight, THEN reject it — stale.
		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		staleRead.reject(new Error('resolveGate: network down'));
		await flushMicrotasks();

		// The existing race spec pins the store/DOM silence; this pins the
		// CONSOLE silence — the stale half of the stale-silent/live-logged
		// split (#260 note 2).
		expect(consoleSpy).not.toHaveBeenCalled();
		expect(get(completionGateStore)).toBe('loading');
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis*)
