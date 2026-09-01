// @vitest-environment happy-dom
//
// #205 RED — profile name + email become whole-field display-then-edit.
//
// Standing UX rule 4 (Mihkel 2026-09-01) + the Mihkel overrule comment on
// #205: the profile fields ARE in scope — click-to-activate costs the same one
// click as click-to-focus — and every activator must also be TAB-to-activate.
//
// CONTRACT (defined HERE, implemented in GREEN — ProfileField grows a
// display state; the always-live <input> is retired):
//
//   DISPLAY (default) state, per field ∈ name | email:
//     • profile-<field>-edit    the whole-field activator: ONE native
//       <button type="button">, `w-full min-h-11` (the #165 F3 width-collapse
//       trap), sr-only ACTION label + the value INSIDE the button.
//     • profile-<field>-value   the value element, INSIDE the button. Shows the
//       field's current draft value — and stays preview-aware: during a #131
//       conflict preview it shows the previewed tier's value (pinned by the
//       amended page.profile.spec.ts AC2/AC4/AC6).
//     • profile-<field>         (the edit input) is NOT in the DOM.
//     • the visibility tier toolbar renders in display state, exactly as
//       before — the tier toggles are a SEPARATE concept and stay untouched.
//   ACTIVATION: clicking anywhere in the field area (the value included)
//     swaps display → edit: profile-<field> appears, pre-filled with the
//     draft, focused; the activator unmounts (the admin reference swap).
//   CONFIRM: Enter or blur — the editor closes back to display, and the
//     existing autosave flush fires exactly as the old blur did (the save
//     seam, queue and reconcile wiring are untouched).
//   CANCEL: Escape — the editor closes, the draft REVERTS to its pre-edit
//     value, and any idle-autosave pending for the cancelled typing never
//     fires. "Nothing is written" holds only while nothing WAS written: if the
//     2s idle window was crossed mid-edit the half-typed value already reached
//     Entu, and the revert has to be written back through the same save seam or
//     the display and the server diverge silently (review round 3, F1).
//   STRINGS: the two sr-only action labels are NEW Paraglide keys —
//     profile_name_edit_label / profile_email_edit_label — present in ALL FOUR
//     locales (en/et/lv/uk); guard below reads the real message files.
//
// Integration posture: real ./profile/+page.svelte (the actual /profile
// route) with the real ProfileField, real autosave/profileEditQueue wiring;
// only the network-edge primitives are mocked. Scaffolding inherited from
// page.profile-first-save-tier-reactivity.spec.ts.
//
// REAL timers by default: blur/Enter fire the flush synchronously, and a
// not-yet-implemented waitFor must fail on its own ~1s default instead of
// hanging fake-timer-blocked to the 5s test timeout (tallis.md GOTCHA). The
// one Escape-cancels-idle-save test opts into fake timers locally.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile';

// Full-fallback paraglide mock — every key renders `[key {params}]`, so the
// sr-only assertions below can pin WHICH key the label rides on.
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
// Keep the READ model real — mock only the network edge.
vi.mock('$lib/profile/profileData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/profile/profileData')>();
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});
vi.mock('$lib/profile/applyProfileSave', () => ({
	applyProfileSave: h.applyProfileSaveMock,
	ProfileSaveError: h.ProfileSaveError
}));
vi.mock('$lib/profile/fieldMove', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/profile/fieldMove')>();
	return { ...actual, applyFieldMove: h.applyFieldMoveMock };
});
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
import { resetGate } from '$lib/profile/completionGate';

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
const activator = (c: HTMLElement, field: 'name' | 'email') =>
	q(c, `[data-testid="profile-${field}-edit"]`) as HTMLButtonElement | null;
const valueEl = (c: HTMLElement, field: 'name' | 'email') =>
	q(c, `[data-testid="profile-${field}-value"]`) as HTMLElement | null;
const input = (c: HTMLElement, field: 'name' | 'email') =>
	q(c, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;

/** Render /profile seeded with a domain profile; settle on the DISPLAY state. */
async function renderSeeded(): Promise<HTMLElement> {
	selectPolyphony();
	h.listMyProfilesMock.mockResolvedValue([
		{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
	]);
	const { container } = render(Page);
	await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
	return container;
}

/** Open a field's editor via its whole-field activator. */
async function openEditor(c: HTMLElement, field: 'name' | 'email'): Promise<HTMLInputElement> {
	const btn = activator(c, field);
	expect(btn, `profile-${field}-edit must render in display state`).not.toBeNull();
	await fireEvent.click(btn as HTMLButtonElement);
	await waitFor(() => expect(input(c, field)).not.toBeNull());
	return input(c, field) as HTMLInputElement;
}

beforeEach(() => {
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
	h.applyFieldMoveMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

// ── display state: whole-field activator, value inside, no live input ──────────

describe('#205 — /profile display state: whole-field activators', () => {
	for (const field of ['name', 'email'] as const) {
		it(`${field}: ONE full-width native <button> wrapping the value; the raw input is NOT mounted`, async () => {
			const container = await renderSeeded();

			const btn = activator(container, field);
			expect(btn, `profile-${field}-edit must render once loaded`).not.toBeNull();
			expect(btn!.tagName).toBe('BUTTON');
			expect(
				btn!.getAttribute('tabindex'),
				'a native button is in the tab order by default — never opt it out'
			).not.toBe('-1');
			expect(btn!.disabled).toBe(false);

			const classes = Array.from(btn!.classList);
			expect(classes, 'the activator must reserve a 44px-tall touch target').toContain(
				'min-h-11'
			);
			expect(classes, 'the WHOLE field is the target (the #165 F3 collapse trap)').toContain(
				'w-full'
			);

			// The value lives INSIDE the button.
			const value = valueEl(container, field);
			expect(value, `profile-${field}-value must render`).not.toBeNull();
			expect(btn!.contains(value)).toBe(true);
			expect(value!.textContent).toContain(field === 'name' ? 'Ada' : 'ada@x.io');

			// Display-then-edit: the live input is retired from the default state.
			expect(input(container, field)).toBeNull();
		});

		it(`${field}: the sr-only action label rides on the pinned Paraglide key`, async () => {
			const container = await renderSeeded();

			const srOnly = activator(container, field)!.querySelector('.sr-only');
			expect(srOnly, 'the activator must carry an sr-only action label').not.toBeNull();
			expect((srOnly as HTMLElement).textContent).toContain(`profile_${field}_edit_label`);
		});

		// #205 review F1 — "the key renders" is not "the key is announced". The
		// first GREEN put `aria-labelledby="profile-<field>-label profile-<field>-value"`
		// ON the button; aria-labelledby SUPERSEDES an element's own contents in
		// the accname algorithm, so the computed name was "Name Ada" and the two
		// NEW locale keys were dead weight — rendered, never surfaced. Resolving
		// the button by its ACCESSIBLE NAME is the assertion that can see it.
		it(`${field}: the computed ACCESSIBLE NAME is "<action label> <value>"`, async () => {
			const container = await renderSeeded();

			const btn = activator(container, field) as HTMLButtonElement;
			const action = (btn.querySelector('.sr-only')?.textContent ?? '')
				.replace(/\s+/g, ' ')
				.trim();
			const value = (valueEl(container, field)?.textContent ?? '').replace(/\s+/g, ' ').trim();
			expect(action, 'action label').toContain(`profile_${field}_edit_label`);
			expect(value, 'value text').not.toBe('');

			expect(within(container).getByRole('button', { name: `${action} ${value}` })).toBe(btn);
			expect(btn.hasAttribute('aria-labelledby'), 'aria-labelledby supersedes contents').toBe(
				false
			);
			expect(btn.hasAttribute('aria-label'), 'aria-label supersedes contents').toBe(false);
		});
	}

	it('the visibility tier toolbar renders in DISPLAY state — the toggles are not gated behind the editor', async () => {
		const container = await renderSeeded();

		for (const field of ['name', 'email'] as const) {
			expect(input(container, field), 'sanity: display state').toBeNull();
			for (const level of ['private', 'domain', 'public'] as const) {
				expect(
					q(container, `[data-testid="profile-vis-${field}-${level}"]`),
					`profile-vis-${field}-${level} must render alongside the activator`
				).not.toBeNull();
			}
		}
	});

	it('tier toggles are still FUNCTIONAL from display state: clicking an inactive tier dispatches the move', async () => {
		const container = await renderSeeded();
		h.applyFieldMoveMock.mockResolvedValue(undefined);

		const pubBtn = q(
			container,
			'[data-testid="profile-vis-name-public"]'
		) as HTMLButtonElement;
		expect(pubBtn.disabled).toBe(false);
		await fireEvent.click(pubBtn);

		await waitFor(() => expect(h.applyFieldMoveMock).toHaveBeenCalledTimes(1));
		// The move never opened the editor.
		expect(input(container, 'name')).toBeNull();
	});
});

// ── activation ────────────────────────────────────────────────────────────────

describe('#205 — /profile activation', () => {
	it('clicking the VALUE opens the editor, pre-filled and focused; the activator unmounts', async () => {
		const container = await renderSeeded();

		await fireEvent.click(valueEl(container, 'name') as HTMLElement);

		await waitFor(() => expect(input(container, 'name')).not.toBeNull());
		const nameInput = input(container, 'name') as HTMLInputElement;
		expect(nameInput.value).toBe('Ada');
		expect(document.activeElement).toBe(nameInput);
		expect(activator(container, 'name')).toBeNull();
		// Opening the editor writes nothing.
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
	});

	it('a first-time user (empty field) still gets an activator, opening an empty editor', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const emailInput = await openEditor(container, 'email');
		expect(emailInput.value).toBe('');
		expect(emailInput.type).toBe('email');
	});

	// #205 review F4 — display renders `displayValue` (the previewed tier's value
	// while a #131 conflict preview is live) but the editor binds the underlying
	// draft. Leaving the preview live across the display→edit swap made the text
	// jump "Annie" → "Ann" with no explanation, and Escape then returned the user
	// to the PREVIEW rather than to what the editor had shown. Activating a field
	// exits preview mode, so the value clicked is the value edited.
	it('activating a field during a #131 conflict PREVIEW exits the preview — the value shown is the value edited', async () => {
		vi.useRealTimers();
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
		expect(valueEl(container, 'name')?.textContent?.trim()).toBe('Ann');

		// Preview the PUBLIC tier's conflicting value.
		await fireEvent.click(q(container, '[data-testid="profile-vis-name-public"]') as HTMLElement);
		await waitFor(() => expect(valueEl(container, 'name')?.textContent?.trim()).toBe('Annie'));

		const nameInput = await openEditor(container, 'name');
		expect(nameInput.value, 'the editor edits the draft, so the preview must be gone').toBe('Ann');
		expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).toBeNull();

		// Escape returns to the same value the editor was showing, not the preview.
		await fireEvent.keyDown(nameInput, { key: 'Escape' });
		await waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent?.trim()).toBe('Ann');
	});
});

// ── confirm / cancel ──────────────────────────────────────────────────────────

describe('#205 — /profile confirm and cancel', () => {
	it('Enter CONFIRMS: the flush fires (unchanged save seam), the editor closes, the display shows the new value', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValueOnce([]);
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'server-dom-1', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.keyDown(nameInput, { key: 'Enter' });

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			existingId: null,
			personId: 'person-p',
			fields: { name: 'Ada', email: '' }
		});
		await waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');
	});

	it('blur CONFIRMS: same flush, editor closes back to display', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValueOnce([]);
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'server-dom-1', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');
	});

	it('Escape CANCELS: editor closes, draft reverts, NOTHING is written — not even by the idle autosave later', async () => {
		// Fake timers so the 2s idle autosave window can be crossed inside the test.
		vi.useFakeTimers();
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Zed' } });
		await fireEvent.keyDown(nameInput, { key: 'Escape' });

		await waitFor(() => expect(input(container, 'name')).toBeNull());
		// The OLD value is back — the cancelled typing left no trace.
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');
		expect(valueEl(container, 'name')?.textContent).not.toContain('Zed');

		// The keystroke's pending idle save must have been cancelled with it.
		vi.advanceTimersByTime(2_500);
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
	});

	// #205 review round 3, F1 — the test above only covers the case where the
	// idle timer has NOT yet fired, so `cancel()`'s clearTimer is enough. Once
	// the 2s window is crossed MID-EDIT the draft is already in Entu, and
	// killing a timer that no longer exists undoes nothing: the display reverted
	// to the pre-edit value while the server kept the mid-edit one, with no
	// dirty indicator anywhere. Escape must be honest about the whole edit, not
	// just the keystrokes since the last autosave — so cancelling a field that
	// autosaved mid-edit has to WRITE the reverted value back through the same
	// save seam.
	it('Escape after a mid-edit idle autosave WRITES the pre-edit value back — the display and Entu never diverge', async () => {
		vi.useFakeTimers();
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await vi.waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const btn = activator(container, 'name') as HTMLButtonElement;
		await fireEvent.click(btn);
		await vi.waitFor(() => expect(input(container, 'name')).not.toBeNull());
		const nameInput = input(container, 'name') as HTMLInputElement;

		// Type, then PAUSE past the 2s idle window: the autosave fires and the
		// mid-edit value lands on the server.
		await fireEvent.input(nameInput, { target: { value: 'Adam' } });
		await vi.advanceTimersByTimeAsync(2_500);
		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1);
		expect(h.applyProfileSaveMock.mock.calls[0][0].fields.name).toBe('Adam');

		// Keep typing, then change your mind.
		await fireEvent.input(nameInput, { target: { value: 'Adamant' } });
		await fireEvent.keyDown(nameInput, { key: 'Escape' });
		await vi.advanceTimersByTimeAsync(0);

		await vi.waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');

		// The revert reached the SERVER, not just the display: the LAST write
		// carries the pre-edit value.
		expect(h.applyProfileSaveMock.mock.calls.length).toBeGreaterThan(1);
		const lastCall = h.applyProfileSaveMock.mock.calls.at(-1)![0];
		expect(lastCall.fields.name, 'Escape must flush the reverted value').toBe('Ada');
		expect(lastCall.level).toBe('domain');
		expect(lastCall.existingId).toBe('prof-dom');

		// And nothing lingers: no later timer resurrects the abandoned draft.
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.applyProfileSaveMock.mock.calls.at(-1)![0].fields.name).toBe('Ada');
	});
});

// ── focus return on close (#205 review F3) ───────────────────────────────────

describe('#205 review F3 — closing the editor lands focus back on the activator', () => {
	// The <input> is only mounted while editing, so every keyboard dismissal
	// UNMOUNTS the focused element. Without an explicit restore, focus falls to
	// <body> and a keyboard user tabbing in, pressing Enter to open, typing and
	// pressing Enter to confirm loses their place entirely. The house pattern is
	// roster's `cancelRename`/`submitRename` and admin's `namePencilRef`.
	it('Enter: focus moves to profile-name-edit, not <body>', async () => {
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const container = await renderSeeded();

		const nameInput = await openEditor(container, 'name');
		nameInput.focus();
		await fireEvent.input(nameInput, { target: { value: 'Ada L' } });
		await fireEvent.keyDown(nameInput, { key: 'Enter' });

		await waitFor(() => expect(input(container, 'name')).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(activator(container, 'name')));
	});

	it('Escape: focus moves to profile-name-edit, not <body>', async () => {
		const container = await renderSeeded();

		const nameInput = await openEditor(container, 'name');
		nameInput.focus();
		await fireEvent.input(nameInput, { target: { value: 'Zed' } });
		await fireEvent.keyDown(nameInput, { key: 'Escape' });

		await waitFor(() => expect(input(container, 'name')).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(activator(container, 'name')));
	});

	it('the email field restores its own activator too — the ref is per component instance', async () => {
		const container = await renderSeeded();

		const emailInput = await openEditor(container, 'email');
		emailInput.focus();
		await fireEvent.keyDown(emailInput, { key: 'Escape' });

		await waitFor(() => expect(input(container, 'email')).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(activator(container, 'email')));
	});

	it('BLUR does not yank focus back — the user already moved it somewhere deliberately', async () => {
		// admin's `restoreFocus` distinction: restore on the keyboard dismissals
		// only. Stealing focus back from wherever a Tab (or a click) just put it
		// would be worse than dropping it.
		const container = await renderSeeded();

		const nameInput = await openEditor(container, 'name');
		nameInput.focus();
		const tier = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		tier.focus(); // real focus move — dispatches the input's blur
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(document.activeElement).toBe(tier);
		expect(document.activeElement).not.toBe(activator(container, 'name'));
	});
});

// ── locale coverage for the NEW strings ───────────────────────────────────────

describe('#205 — new Paraglide keys land in ALL FOUR locales', () => {
	it('profile_name_edit_label + profile_email_edit_label exist non-empty in en/et/lv/uk', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as MessageFile;
			for (const key of ['profile_name_edit_label', 'profile_email_edit_label']) {
				expect(key in messages, `${locale}.json is missing ${key}`).toBe(true);
				expect(isMessageEmpty(messages[key]), `${locale}.json has an empty ${key}`).toBe(false);
			}
		}
	});
});

// (*MVOX:Tallis* — #205 RED; review round-3 flush-on-cancel case *MVOX:Josquin*)
