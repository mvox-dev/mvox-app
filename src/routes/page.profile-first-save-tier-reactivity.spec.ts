// @vitest-environment happy-dom
//
// #160 — profile sharing tier reactivity on first save.
//
// Reported by Mihkel on the cleaned polyphony db: a first-time user (NO profile
// entity yet) fills the name, autosave CREATES the domain entity — but the
// sharing tier picker never notices. "Public" stays disabled until a full page
// reload re-fetches the profiles.
//
// Mechanics (why it's stale): the tier buttons' enabled-state derives from
// `loadedProfiles` (via resolveField().holders → movableFor), but the save
// path's reconcile/recordCreatedId callbacks only update `confirmed` —
// `loadedProfiles` is written ONLY by loadForSelected(). After the first
// create, holders is still [] → movable stays false → every inactive tier
// button stays disabled.
//
// SCOPE (post-review): the fix is the `loadedProfiles` mirror alone. A field
// with ZERO holders (an empty email) stays LOCKED — nothing downstream can
// honour that click (`onmove` bails on `holders.length !== 1`; ProfileField has
// no staged-target state), and a reload of the same server state renders it
// locked too. Pre-typing tier selection would be a separate feature needing
// real per-field staging state, not a widened enabled-flag.
//
// These tests are ROUTE-LEVEL integration: they render the real
// ./profile/+page.svelte (the actual /profile route component) and drive the
// real autosave → profileEditQueue → reconcile wiring; only the network-edge
// primitives (listMyProfiles / applyProfileSave / applyFieldMove) are mocked.
// No remount, no reload — reactivity must come from the component itself.
//
// Mock scaffolding inherited from page.profile.spec.ts /
// page.profile-session-expired.spec.ts.
//
// REAL timers throughout: blur fires the autosave synchronously (no debounce
// wait needed), and a not-yet-implemented waitFor must fail on its own ~1s
// default instead of hanging fake-timer-blocked to the 5s test timeout (see
// tallis.md GOTCHA, hit 2026-08-10 on #73).
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
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
	class ProfileSaveError extends Error {
		readonly createdProfileId?: string;
		constructor(message: string, createdProfileId?: string) {
			super(message);
			this.name = 'ProfileSaveError';
			this.createdProfileId = createdProfileId;
		}
	}
	return {
		ProfileSaveError,
		listMyProfilesMock: vi.fn(),
		applyProfileSaveMock: vi.fn(),
		applyFieldMoveMock: vi.fn()
	};
});
// Keep the READ model real (resolveField / profilesByLevel drive the very
// derived state under test) — mock only the network edge.
vi.mock('$lib/profile/profileData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/profile/profileData')>();
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});
vi.mock('$lib/profile/applyProfileSave', () => ({
	applyProfileSave: h.applyProfileSaveMock,
	ProfileSaveError: h.ProfileSaveError
}));
// Keep planLoadedDuplicateRepairs (repair banners) + applyConflictResolution
// real; mock ONLY the move write-primitive — AC2 asserts the move DISPATCHES.
vi.mock('$lib/profile/fieldMove', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/profile/fieldMove')>();
	return { ...actual, applyFieldMove: h.applyFieldMoveMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
// #193 — the profile page reads `?link_error` / `?linked` off `page.url` (the
// return leg of the provider-link round trip). Default: a clean /profile URL.
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
import { resetGate } from '$lib/profile/completionGate';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
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
const btn = (c: HTMLElement, testid: string) =>
	q(c, `[data-testid="${testid}"]`) as HTMLButtonElement;

// ── #205 — display-then-edit helpers ────────────────────────────────────────
// The profile fields are whole-field activators now (standing UX rule 4):
// `profile-<field>-edit` (a native button wrapping the value) activates the
// `profile-<field>` input. Contract pinned in page.profile-whole-field.spec.ts.

/** The display-state value element's text for a field (trimmed). */
function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
	return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
}

/** Activate a field's whole-field button; answers the revealed input. */
async function openEditor(
	container: HTMLElement,
	field: 'name' | 'email'
): Promise<HTMLInputElement> {
	const activator = q(
		container,
		`[data-testid="profile-${field}-edit"]`
	) as HTMLButtonElement | null;
	expect(activator, `profile-${field}-edit must render in display state`).not.toBeNull();
	await fireEvent.click(activator!);
	let editorInput: HTMLInputElement | null = null;
	await waitFor(() => {
		editorInput = q(container, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;
		expect(editorInput).not.toBeNull();
	});
	return editorInput!;
}

/** The domain entity the FIRST save creates (server-assigned id). */
const CREATED_DOMAIN = { _id: 'server-dom-1', name: 'Ada', email: '', _sharing: 'domain' as const };

/**
 * First-time user: initial load sees ZERO profile entities; every read AFTER
 * the create (completion-gate refresh, or a fix-driven re-fetch) sees the
 * created domain entity. Whether the fix patches `loadedProfiles` locally or
 * re-fetches, this arrangement lets it pass — but a page RELOAD is never
 * available to the component under test.
 */
function armFirstTimeUserThenCreated() {
	h.listMyProfilesMock.mockResolvedValueOnce([]); // initial load — clean db
	h.listMyProfilesMock.mockResolvedValue([CREATED_DOMAIN]); // any read after the create
	h.applyProfileSaveMock.mockResolvedValue({ profileId: CREATED_DOMAIN._id });
}

/** Render /profile and complete the first-time load (empty profile list). */
async function renderFirstTimeProfile(): Promise<HTMLElement> {
	selectPolyphony();
	const { container } = render(Page);
	await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
	return container;
}

/** Type a name and blur — blur fires the autosave synchronously. */
async function typeNameAndSave(container: HTMLElement, value: string): Promise<void> {
	const nameInput = await openEditor(container, 'name');
	await fireEvent.input(nameInput, { target: { value } });
	await fireEvent.blur(nameInput);
	await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
	// Sanity: this save is the entity-CREATE (no existing domain entity).
	expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
		level: 'domain',
		existingId: null,
		fields: { name: value, email: '' }
	});
}

beforeEach(() => {
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
	h.applyFieldMoveMock.mockReset();
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('/profile — #160 sharing tier reactivity on first save', () => {
	it('sanity (issue step 4): a first-time user renders the tier picker with the non-active tiers disabled', async () => {
		// Pins the REPRODUCE precondition, so the AC tests below cannot pass
		// vacuously off a wrong mock arrangement: with zero profile entities the
		// picker renders, domain is the active fallback tier, and public/private
		// are not selectable (nothing exists to move yet).
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();

		for (const field of ['name', 'email'] as const) {
			for (const level of ['private', 'domain', 'public'] as const) {
				expect(
					btn(container, `profile-vis-${field}-${level}`),
					`tier picker must render ${field}/${level}`
				).not.toBeNull();
			}
		}
		expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-pressed')).toBe('true');
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(true);
	});

	it('AC1: after the first save creates the profile entity, the public tier becomes enabled — NO reload', async () => {
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();

		// Before the save: first-time state, public not selectable.
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(true);

		await typeNameAndSave(container, 'Ada');

		// THE BUG: the entity now exists server-side (applyProfileSave resolved
		// with its id, reconcile ran) — the picker must notice reactively. The
		// component is NEVER remounted here: whatever the state source, it has to
		// update inside this same session.
		await waitFor(() => {
			expect(
				btn(container, 'profile-vis-name-public').disabled,
				'public must become selectable once the profile entity exists — without a page reload'
			).toBe(false);
		});
		// Domain (where the value now lives) is the active tier, and active tiers
		// are not move targets — it stays a disabled, pressed button.
		expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-pressed')).toBe('true');
		// Draft survived the save (no reload side effects).
		expect(displayValue(container, 'name')).toBe('Ada');
	});

	it('AC1 (email): a field with NO value keeps its tiers disabled — the entity existing is not enough', async () => {
		// Deliberately the INVERSE of the name case. The tier picker moves a
		// VALUE between entities; email is still empty after the name-only first
		// save, so there is nothing to move — `onmove` bails on
		// `holders.length !== 1` and the component carries no staged-target
		// state, so an enabled email button would silently swallow the click.
		// This is also exactly what a page reload of the same server state
		// renders (the created entity holds `name`, not `email`) — so there is
		// no reload parity to "restore" here.
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();
		expect(btn(container, 'profile-vis-email-private').disabled).toBe(true);

		await typeNameAndSave(container, 'Ada');

		// Synchronise on the name field waking up (the actual #160 fix landing),
		// so the email assertions below cannot pass merely because the reconcile
		// has not run yet.
		await waitFor(() => expect(btn(container, 'profile-vis-name-public').disabled).toBe(false));

		expect(
			btn(container, 'profile-vis-email-private').disabled,
			'email holds no value — its tiers must stay disabled, not become dead-enabled'
		).toBe(true);
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-domain').getAttribute('aria-pressed')).toBe('true');
	});

	it('AC1 (email, positive): once email HOLDS a value the tiers wake up and a click really moves it', async () => {
		// Drives behaviour instead of reading a flag: after the name-only first
		// save, type an email, let it reconcile onto the same domain entity, then
		// assert the picker both ENABLES and ACTS — a dispatched applyFieldMove
		// with the created entity's server id as the source.
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();
		await typeNameAndSave(container, 'Ada');
		await waitFor(() => expect(btn(container, 'profile-vis-name-public').disabled).toBe(false));

		// The email save lands on the SAME domain entity (existingId set now).
		h.applyProfileSaveMock.mockResolvedValue({ profileId: CREATED_DOMAIN._id });
		const emailInput = await openEditor(container, 'email');
		await fireEvent.input(emailInput, { target: { value: 'ada@example.org' } });
		await fireEvent.blur(emailInput);
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(2));
		expect(h.applyProfileSaveMock.mock.calls[1][0]).toMatchObject({
			level: 'domain',
			existingId: CREATED_DOMAIN._id,
			fields: { name: 'Ada', email: 'ada@example.org' }
		});

		// NOW email has exactly one holder — its inactive tiers become live.
		await waitFor(() =>
			expect(
				btn(container, 'profile-vis-email-public').disabled,
				'email now holds a value at domain — public must become a real move target'
			).toBe(false)
		);

		h.applyFieldMoveMock.mockReturnValueOnce(new Promise(() => {})); // never settles
		await fireEvent.click(btn(container, 'profile-vis-email-public'));

		await waitFor(() => expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(h.applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'email',
			fromLevel: 'domain',
			toLevel: 'public',
			value: 'ada@example.org',
			srcId: CREATED_DOMAIN._id,
			dstId: null,
			// Whole-pair discipline: the source entity's name must be preserved
			// on the delete-from-old rewrite.
			srcSibling: 'Ada'
		});
	});

	it('AC2: full first-session flow — create via autosave, then move name to PUBLIC, no reload anywhere', async () => {
		armFirstTimeUserThenCreated();
		const container = await renderFirstTimeProfile();
		await typeNameAndSave(container, 'Ada');

		// The move write-primitive settles only when we say so (deterministic
		// re-mock window for the post-move re-read).
		const d = deferred<{
			field: 'name';
			fromLevel: 'domain';
			toLevel: 'public';
			targetId: string;
			sourceId: string;
		}>();
		h.applyFieldMoveMock.mockReturnValueOnce(d.promise);

		// Public became clickable (AC1) — click it. Today this is a dead button:
		// the click either hits `disabled` or no-ops on holders.length !== 1.
		await waitFor(() =>
			expect(btn(container, 'profile-vis-name-public').disabled).toBe(false)
		);
		await fireEvent.click(btn(container, 'profile-vis-name-public'));

		await waitFor(() => expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(h.applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'name',
			fromLevel: 'domain',
			toLevel: 'public',
			value: 'Ada',
			// The source is the entity the FIRST SAVE created — the component must
			// know its server id without ever having reloaded.
			srcId: CREATED_DOMAIN._id,
			dstId: null
		});

		// Server confirms the move; the post-move re-read sees the value at public.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'server-pub-1', name: 'Ada', email: '', _sharing: 'public' }
		]);
		d.resolve({
			field: 'name',
			fromLevel: 'domain',
			toLevel: 'public',
			targetId: 'server-pub-1',
			sourceId: CREATED_DOMAIN._id
		});

		await waitFor(() => {
			expect(btn(container, 'profile-vis-name-public').getAttribute('aria-pressed')).toBe('true');
		});
		expect(displayValue(container, 'name')).toBe('Ada');
	});
});

/**
 * The RETURNING member — no first save involved. These pin that the #160 fix
 * (`upsertLoadedProfile` mirroring the save-path settles onto `loadedProfiles`)
 * does not disturb the already-loaded case: an unheld field stays locked, and a
 * re-save of a held field replaces its holder instead of duplicating it.
 */
describe('/profile — #160 no regression on the already-loaded profile', () => {
	const LOADED_DOMAIN = {
		_id: 'server-dom-1',
		name: 'Ada',
		email: '',
		_sharing: 'domain' as const
	};

	async function renderWithLoaded(profiles: typeof LOADED_DOMAIN[]): Promise<HTMLElement> {
		h.listMyProfilesMock.mockResolvedValue(profiles);
		selectPolyphony();
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
		await waitFor(() => expect(displayValue(container, 'name')).toBe(profiles[0].name));
		return container;
	}

	it('a loaded profile holding name but NOT email leaves the email tiers disabled', async () => {
		// Reachable with no save at all: `email` has zero holders, so there is
		// nothing to move and no code path that could honour a click on those
		// buttons. They must render disabled, exactly as before #160.
		const container = await renderWithLoaded([LOADED_DOMAIN]);

		// The held field IS movable — proves the fixture is not just globally inert.
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(false);

		expect(btn(container, 'profile-vis-email-private').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(true);
	});

	it('the symmetric case: a loaded profile holding email but NOT name leaves the name tiers disabled', async () => {
		const container = await renderWithLoaded([
			{ ...LOADED_DOMAIN, name: '', email: 'ada@example.org' }
		]);

		expect(btn(container, 'profile-vis-email-public').disabled).toBe(false);
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(true);
	});

	it('re-saving a loaded field REPLACES its holder — one domain entry, no conflict or repair banner', async () => {
		// `upsertLoadedProfile` must mirror what a reload would produce (one
		// entity per level). Appending instead would make `name` a two-holder
		// field: a phantom conflict, a repair banner, and a dead picker.
		const container = await renderWithLoaded([LOADED_DOMAIN]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: LOADED_DOMAIN._id });

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada Lovelace' } });
		await fireEvent.blur(nameInput);
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			existingId: LOADED_DOMAIN._id,
			fields: { name: 'Ada Lovelace', email: '' }
		});

		// No phantom duplicate: no repair banner, no conflict note.
		await waitFor(() =>
			expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-busy')).toBeNull()
		);
		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
		expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).toBeNull();

		// And the holder set is genuinely single — a move still dispatches, off the
		// SAME entity id, carrying the freshly saved value.
		h.applyFieldMoveMock.mockReturnValueOnce(new Promise(() => {})); // never settles
		expect(btn(container, 'profile-vis-name-public').disabled).toBe(false);
		await fireEvent.click(btn(container, 'profile-vis-name-public'));

		await waitFor(() => expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(h.applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'name',
			fromLevel: 'domain',
			toLevel: 'public',
			value: 'Ada Lovelace',
			srcId: LOADED_DOMAIN._id,
			dstId: null
		});
	});
});

/**
 * Review regression guard — the `upsertLoadedProfile` mirror rewrites the very
 * state `activeLevelFor` reads, so ORDER matters inside `reconcile`: the
 * saving/failed markers must be cleared against the PRE-save active level.
 * Otherwise a save that CLEARS a field drops its only holder, `activeLevelFor`
 * falls back to the 'domain' default, the `=== level` test misses, and the
 * field's `savingFields` entry is never released — a tier button stuck at
 * aria-busy="true" until an unrelated same-level save settles or the page is
 * reloaded.
 */
describe('/profile — #160 a save that CLEARS a field still releases its saving marker', () => {
	const LOADED_PUBLIC = {
		_id: 'server-pub-1',
		name: 'Ada',
		email: 'ada@example.org',
		_sharing: 'public' as const
	};

	async function renderLoadedAtPublic(): Promise<HTMLElement> {
		h.listMyProfilesMock.mockResolvedValue([LOADED_PUBLIC]);
		selectPolyphony();
		const { container } = render(Page);
		await waitFor(() => expect(displayValue(container, 'name')).toBe('Ada'));
		return container;
	}

	it('clearing the name held at PUBLIC leaves no tier reporting aria-busy', async () => {
		const container = await renderLoadedAtPublic();
		// Precondition: the value lives at public (NOT the 'domain' fallback), so
		// dropping the holder really does change what `activeLevelFor` returns.
		expect(btn(container, 'profile-vis-name-public').getAttribute('aria-pressed')).toBe('true');

		h.applyProfileSaveMock.mockResolvedValue({ profileId: LOADED_PUBLIC._id });
		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: '' } });
		await fireEvent.blur(nameInput);
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'public',
			existingId: LOADED_PUBLIC._id,
			// Whole-pair discipline: the cleared name plus the untouched sibling.
			fields: { name: '', email: 'ada@example.org' }
		});

		// Reconcile landed: with no holder left, the picker falls back to 'domain'.
		await waitFor(() =>
			expect(btn(container, 'profile-vis-name-domain').getAttribute('aria-pressed')).toBe('true')
		);

		for (const level of ['private', 'domain', 'public'] as const) {
			expect(
				btn(container, `profile-vis-name-${level}`).getAttribute('aria-busy'),
				`name/${level} must not stay busy after the clearing save reconciled`
			).toBeNull();
		}
		expect(q(container, '[data-testid="profile-vis-name-domain-saving"]')).toBeNull();
		// And the email — whose active level DID stay 'public' — is unaffected.
		expect(btn(container, 'profile-vis-email-public').getAttribute('aria-pressed')).toBe('true');
		expect(btn(container, 'profile-vis-email-public').getAttribute('aria-busy')).toBeNull();
	});
});

/**
 * The PARTIAL-FAILURE create path (`recordCreatedId`): the shell entity was
 * created but its fields were not written. The shell holds NO value, so it is
 * not a holder and cannot wake any tier up — what mirroring it onto
 * `loadedProfiles` actually buys is the `dst` lookup in `onmove`, i.e. a later
 * move into that tier REUSES the orphan shell instead of creating a second
 * entity at the same level.
 */
describe('/profile — #160 the created-but-unconfirmed shell', () => {
	const LOADED_PUBLIC_NAME = {
		_id: 'server-pub-1',
		name: 'Ada',
		email: '',
		_sharing: 'public' as const
	};

	/**
	 * Name lives at public; email has no holder, so its first save CREATEs a
	 * domain entity — the create lands, the field write does not.
	 */
	async function renderThenFailEmailCreate(): Promise<HTMLElement> {
		h.listMyProfilesMock.mockResolvedValue([LOADED_PUBLIC_NAME]);
		selectPolyphony();
		const { container } = render(Page);
		await waitFor(() => expect(displayValue(container, 'name')).toBe('Ada'));

		h.applyProfileSaveMock.mockRejectedValueOnce(
			new h.ProfileSaveError('field write failed after create', 'server-dom-1')
		);
		const emailInput = await openEditor(container, 'email');
		await fireEvent.input(emailInput, { target: { value: 'ada@example.org' } });
		await fireEvent.blur(emailInput);
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			existingId: null
		});
		await waitFor(() => expect(q(container, '[data-testid="profile-email-error"]')).not.toBeNull());
		return container;
	}

	it('holds no value, so it must not wake the email tiers up', async () => {
		const container = await renderThenFailEmailCreate();

		expect(
			btn(container, 'profile-vis-email-public').disabled,
			'an empty shell is not a holder — the email tiers stay locked'
		).toBe(true);
		expect(btn(container, 'profile-vis-email-private').disabled).toBe(true);
		expect(btn(container, 'profile-vis-email-domain').getAttribute('aria-pressed')).toBe('true');
	});

	it('is REUSED by the retry — the second save UPDATES it instead of creating a duplicate', async () => {
		const container = await renderThenFailEmailCreate();

		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const emailInput = await openEditor(container, 'email');
		await fireEvent.input(emailInput, { target: { value: 'ada@example.com' } });
		await fireEvent.blur(emailInput);
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(2));
		expect(h.applyProfileSaveMock.mock.calls[1][0]).toMatchObject({
			level: 'domain',
			existingId: 'server-dom-1'
		});

		// The retry confirmed: the error clears and email now really holds a value.
		await waitFor(() => expect(q(container, '[data-testid="profile-email-error"]')).toBeNull());
		expect(btn(container, 'profile-vis-email-public').disabled).toBe(false);
	});

	it('is the DESTINATION of a later move into that tier — no second domain entity', async () => {
		// This is what the `recordCreatedId` mirror actually buys: `onmove` resolves
		// `dst` off `loadedProfiles`, so without the mirrored shell the move would
		// pass `dstId: null` and CREATE a second domain entity beside the orphan.
		const container = await renderThenFailEmailCreate();

		h.applyFieldMoveMock.mockReturnValueOnce(new Promise(() => {})); // never settles
		expect(btn(container, 'profile-vis-name-domain').disabled).toBe(false);
		await fireEvent.click(btn(container, 'profile-vis-name-domain'));

		await waitFor(() => expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(h.applyFieldMoveMock.mock.calls[0][0]).toMatchObject({
			field: 'name',
			fromLevel: 'public',
			toLevel: 'domain',
			value: 'Ada',
			srcId: LOADED_PUBLIC_NAME._id,
			dstId: 'server-dom-1'
		});
	});
});

// (*MVOX:Tallis*)
