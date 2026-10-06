// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { REDACT_ATTR } from '$lib/redact/redact';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/profile/applyProfileSave', async () =>
	(await import('$lib/testing/mocks/profile')).applyProfileSaveModule('shared')
);
vi.mock('$lib/profile/fieldMove', async (importOriginal) =>
	(await import('$lib/testing/mocks/profile')).fieldMoveModule(importOriginal)
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './profile/+page.svelte';
import { applyFieldMoveMock, applyProfileSaveMock } from '$lib/testing/mocks/profile';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import {
	realTimersCleanupResetGate,
	resetSaveMocks,
	selectSampledb
} from '$lib/testing/pages/profile';

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const activator = (c: HTMLElement, field: 'name' | 'email') =>
	q(c, `[data-testid="profile-${field}-edit"]`) as HTMLButtonElement | null;
const valueEl = (c: HTMLElement, field: 'name' | 'email') =>
	q(c, `[data-testid="profile-${field}-value"]`) as HTMLElement | null;
const input = (c: HTMLElement, field: 'name' | 'email') =>
	q(c, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;

async function renderSeeded(): Promise<HTMLElement> {
	selectSampledb();
	listMyProfilesMock.mockResolvedValue([
		{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
	]);
	const { container } = render(Page);
	await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
	return container;
}

async function openEditor(c: HTMLElement, field: 'name' | 'email'): Promise<HTMLInputElement> {
	const btn = activator(c, field);
	expect(btn, `profile-${field}-edit must render in display state`).not.toBeNull();
	await fireEvent.click(btn as HTMLButtonElement);
	await waitFor(() => expect(input(c, field)).not.toBeNull());
	return input(c, field) as HTMLInputElement;
}

beforeEach(resetSaveMocks);

afterEach(realTimersCleanupResetGate);

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

			const value = valueEl(container, field);
			expect(value, `profile-${field}-value must render`).not.toBeNull();
			expect(btn!.contains(value)).toBe(true);
			expect(value!.textContent).toContain(field === 'name' ? 'Ada' : 'ada@x.io');

			expect(input(container, field)).toBeNull();
		});

		it(`${field}: the sr-only action label rides on the pinned Paraglide key`, async () => {
			const container = await renderSeeded();

			const srOnly = activator(container, field)!.querySelector('.sr-only');
			expect(srOnly, 'the activator must carry an sr-only action label').not.toBeNull();
			expect((srOnly as HTMLElement).textContent).toContain(`profile_${field}_edit_label`);
		});

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
		applyFieldMoveMock.mockResolvedValue(undefined);

		const pubBtn = q(
			container,
			'[data-testid="profile-vis-name-public"]'
		) as HTMLButtonElement;
		expect(pubBtn.disabled).toBe(false);
		await fireEvent.click(pubBtn);

		await waitFor(() => expect(applyFieldMoveMock).toHaveBeenCalledTimes(1));
		expect(input(container, 'name')).toBeNull();
	});
});

describe('#205 — /profile activation', () => {
	it('clicking the VALUE opens the editor, pre-filled and focused; the activator unmounts', async () => {
		const container = await renderSeeded();

		await fireEvent.click(valueEl(container, 'name') as HTMLElement);

		await waitFor(() => expect(input(container, 'name')).not.toBeNull());
		const nameInput = input(container, 'name') as HTMLInputElement;
		expect(nameInput.value).toBe('Ada');
		expect(document.activeElement).toBe(nameInput);
		expect(activator(container, 'name')).toBeNull();
		expect(applyProfileSaveMock).not.toHaveBeenCalled();
	});

	it('a first-time user (empty field) still gets an activator, opening an empty editor', async () => {
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const emailInput = await openEditor(container, 'email');
		expect(emailInput.value).toBe('');
		expect(emailInput.type).toBe('email');
	});

	it('activating a field during a #131 conflict PREVIEW exits the preview — the value shown is the value edited', async () => {
		vi.useRealTimers();
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
		expect(valueEl(container, 'name')?.textContent?.trim()).toBe('Ann');

		await fireEvent.click(q(container, '[data-testid="profile-vis-name-public"]') as HTMLElement);
		await waitFor(() => expect(valueEl(container, 'name')?.textContent?.trim()).toBe('Annie'));

		const nameInput = await openEditor(container, 'name');
		expect(nameInput.value, 'the editor edits the draft, so the preview must be gone').toBe('Ann');
		expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).toBeNull();

		await fireEvent.keyDown(nameInput, { key: 'Escape' });
		await waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent?.trim()).toBe('Ann');
	});
});

describe('#205 — /profile confirm and cancel', () => {
	it('Enter CONFIRMS: the flush fires (unchanged save seam), the editor closes, the display shows the new value', async () => {
		selectSampledb();
		listMyProfilesMock.mockResolvedValueOnce([]);
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'server-dom-1', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.keyDown(nameInput, { key: 'Enter' });

		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			existingId: null,
			personId: 'person-p',
			fields: { name: 'Ada', email: '' }
		});
		await waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');
	});

	it('blur CONFIRMS: same flush, editor closes back to display', async () => {
		selectSampledb();
		listMyProfilesMock.mockResolvedValueOnce([]);
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'server-dom-1', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');
	});

	it('Escape CANCELS: editor closes, draft reverts, NOTHING is written — not even by the idle autosave later', async () => {
		vi.useFakeTimers();
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([
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
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');
		expect(valueEl(container, 'name')?.textContent).not.toContain('Zed');

		vi.advanceTimersByTime(2_500);
		expect(applyProfileSaveMock).not.toHaveBeenCalled();
	});

	it('Escape after a mid-edit idle autosave WRITES the pre-edit value back — the display and Entu never diverge', async () => {
		vi.useFakeTimers();
		selectSampledb();
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await vi.waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		const btn = activator(container, 'name') as HTMLButtonElement;
		await fireEvent.click(btn);
		await vi.waitFor(() => expect(input(container, 'name')).not.toBeNull());
		const nameInput = input(container, 'name') as HTMLInputElement;

		await fireEvent.input(nameInput, { target: { value: 'Adam' } });
		await vi.advanceTimersByTimeAsync(2_500);
		expect(applyProfileSaveMock).toHaveBeenCalledTimes(1);
		expect(applyProfileSaveMock.mock.calls[0][0].fields.name).toBe('Adam');

		await fireEvent.input(nameInput, { target: { value: 'Adamant' } });
		await fireEvent.keyDown(nameInput, { key: 'Escape' });
		await vi.advanceTimersByTimeAsync(0);

		await vi.waitFor(() => expect(input(container, 'name')).toBeNull());
		expect(valueEl(container, 'name')?.textContent).toContain('Ada');

		expect(applyProfileSaveMock.mock.calls.length).toBeGreaterThan(1);
		const lastCall = applyProfileSaveMock.mock.calls.at(-1)![0];
		expect(lastCall.fields.name, 'Escape must flush the reverted value').toBe('Ada');
		expect(lastCall.level).toBe('domain');
		expect(lastCall.existingId).toBe('prof-dom');

		await vi.advanceTimersByTimeAsync(3_000);
		expect(applyProfileSaveMock.mock.calls.at(-1)![0].fields.name).toBe('Ada');
	});
});

describe('#205 review F3 — closing the editor lands focus back on the activator', () => {
	it('Enter: focus moves to profile-name-edit, not <body>', async () => {
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
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

// (*MVOX:Tallis*) (*MVOX:Josquin*)

describe('#361 — /profile: the displayed name value is marked', () => {
	it('name: the display-state value sits inside exactly one marker', async () => {
		const container = await renderSeeded();
		const value = valueEl(container, 'name');
		expect(value, 'profile-name-value must render').not.toBeNull();
		expectNameMarkedOnce(value!, 'Ada', 'in the profile name display value');
	});

	it('email: the display-state value sits inside exactly one marker (#618)', async () => {
		const container = await renderSeeded();
		const value = valueEl(container, 'email');
		expect(value, 'profile-email-value must render').not.toBeNull();
		expectNameMarkedOnce(value!, 'ada@x.io', 'in the profile email display value');
	});

	const markerAncestors = (el: Element): number => {
		let n = 0;
		for (let cur: Element | null = el; cur; cur = cur.parentElement) {
			if (cur.hasAttribute(REDACT_ATTR)) n += 1;
		}
		return n;
	};

	it('name: the edit-state input sits inside exactly one marker', async () => {
		const container = await renderSeeded();
		await fireEvent.click(valueEl(container, 'name') as HTMLElement);
		await waitFor(() => expect(input(container, 'name')).not.toBeNull());
		expect(markerAncestors(input(container, 'name') as HTMLInputElement)).toBe(1);
	});

	it('email: the edit-state input sits inside exactly one marker (#618)', async () => {
		const container = await renderSeeded();
		await fireEvent.click(valueEl(container, 'email') as HTMLElement);
		await waitFor(() => expect(input(container, 'email')).not.toBeNull());
		expect(markerAncestors(input(container, 'email') as HTMLInputElement)).toBe(1);
	});
});

// (*MVOX:Tallis* — #361 RED: profile name display value marked)
// (*MVOX:Josquin* — #618 RED: email marked)
