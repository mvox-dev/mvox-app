// @vitest-environment happy-dom
// #565: Enter-save disables the edit button while the save runs; focus must land on it after.
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

type Field = 'name' | 'email';
const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const activator = (c: HTMLElement, field: Field) =>
	q(c, `[data-testid="profile-${field}-edit"]`) as HTMLButtonElement | null;
const input = (c: HTMLElement, field: Field) =>
	q(c, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;

async function renderSeeded(): Promise<HTMLElement> {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
	h.listMyProfilesMock.mockResolvedValue([
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

describe('#565 — Enter-save returns focus to the edit button once the save settles', () => {
	const edits: Record<Field, string> = { name: 'Ada L', email: 'ada@y.io' };
	for (const field of ['name', 'email'] as const) {
		it(`${field}: focus lands on profile-${field}-edit after a held save resolves`, async () => {
			let settle!: (v: { profileId: string }) => void;
			h.applyProfileSaveMock.mockReturnValue(new Promise((r) => (settle = r)));
			const container = await renderSeeded();

			const el = await openEditor(container, field);
			await fireEvent.input(el, { target: { value: edits[field] } });
			await fireEvent.keyDown(el, { key: 'Enter' });

			await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
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
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
	});

	it('a focus move made during the save is not taken back', async () => {
		let settle!: (v: { profileId: string }) => void;
		h.applyProfileSaveMock.mockReturnValue(new Promise((r) => (settle = r)));
		const container = await renderSeeded();

		const el = await openEditor(container, 'name');
		await fireEvent.input(el, { target: { value: 'Ada L' } });
		await fireEvent.keyDown(el, { key: 'Enter' });
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));

		const other = activator(container, 'email') as HTMLButtonElement;
		other.focus();
		settle({ profileId: 'prof-dom' });
		await waitFor(() => expect(activator(container, 'name')?.disabled).toBe(false));
		expect(document.activeElement).toBe(other);
	});
});
