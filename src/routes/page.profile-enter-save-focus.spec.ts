// @vitest-environment happy-dom
// #565: Enter-save disables the edit button while the save runs; focus must land on it after.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { applyFieldMoveMock, applyProfileSaveMock } from '$lib/testing/mocks/profile';
import { listMyProfilesMock } from '$lib/testing/mocks/session';

type Field = 'name' | 'email';
const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const activator = (c: HTMLElement, field: Field) =>
	q(c, `[data-testid="profile-${field}-edit"]`) as HTMLButtonElement | null;
const input = (c: HTMLElement, field: Field) =>
	q(c, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;

async function renderSeeded(): Promise<HTMLElement> {
	signIn({ token: 'jwt-member' });
	listMyProfilesMock.mockResolvedValue([
		{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
	]);
	const { container } = render(Page);
	await waitFor(() => expect(activator(container, 'name')).not.toBeNull());
	return container;
}

async function openEditor(c: HTMLElement, field: Field): Promise<HTMLInputElement> {
	await fireEvent.click(activator(c, field) as HTMLButtonElement);
	await waitFor(() => expect(input(c, field)).not.toBeNull());
	const el = input(c, field) as HTMLInputElement;
	el.focus();
	return el;
}

beforeEach(() => {
	listMyProfilesMock.mockReset();
	applyProfileSaveMock.mockReset();
	applyFieldMoveMock.mockReset();
});

afterEach(() => {
	cleanup();
	resetAppState();
	resetGate();
});

describe('#565 — Enter-save returns focus to the edit button once the save settles', () => {
	const edits: Record<Field, string> = { name: 'Ada L', email: 'ada@y.io' };
	for (const field of ['name', 'email'] as const) {
		it(`${field}: focus lands on profile-${field}-edit after a held save resolves`, async () => {
			let settle!: (v: { profileId: string }) => void;
			applyProfileSaveMock.mockReturnValue(new Promise((r) => (settle = r)));
			const container = await renderSeeded();

			const el = await openEditor(container, field);
			await fireEvent.input(el, { target: { value: edits[field] } });
			await fireEvent.keyDown(el, { key: 'Enter' });

			await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));
			expect(input(container, field)).toBeNull();
			expect(activator(container, field)?.disabled, 'disabled while the save runs').toBe(true);

			settle({ profileId: 'prof-dom' });
			await waitFor(() => expect(activator(container, field)?.disabled).toBe(false));
			await waitFor(() => expect(document.activeElement).toBe(activator(container, field)));
		});
	}

	it('Enter with no change returns focus at once and writes nothing', async () => {
		const container = await renderSeeded();

		const el = await openEditor(container, 'name');
		await fireEvent.keyDown(el, { key: 'Enter' });

		await waitFor(() => expect(document.activeElement).toBe(activator(container, 'name')));
		expect(applyProfileSaveMock).not.toHaveBeenCalled();
	});

	it('a focus move made during the save is not taken back', async () => {
		let settle!: (v: { profileId: string }) => void;
		applyProfileSaveMock.mockReturnValue(new Promise((r) => (settle = r)));
		const container = await renderSeeded();

		const el = await openEditor(container, 'name');
		await fireEvent.input(el, { target: { value: 'Ada L' } });
		await fireEvent.keyDown(el, { key: 'Enter' });
		await waitFor(() => expect(applyProfileSaveMock).toHaveBeenCalledTimes(1));

		const other = activator(container, 'email') as HTMLButtonElement;
		other.focus();
		settle({ profileId: 'prof-dom' });
		await waitFor(() => expect(activator(container, 'name')?.disabled).toBe(false));
		expect(document.activeElement).toBe(other);
	});
});
