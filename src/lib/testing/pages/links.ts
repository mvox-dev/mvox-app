// Links page harness: the setup its specs had word for word. Specs import what they use.
import { cleanup } from '@testing-library/svelte';
import { vi } from 'vitest';
import type { LinkRow } from '$lib/links/linkData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { resetAppState } from '$lib/testing/appReset';
import { entuFetchMock } from '$lib/testing/mocks/seasons';
import { resetOnLine } from '$lib/testing/networkSignal';
import { signIn } from '$lib/testing/session';
import { qa } from './dom';

export const DB_ENTITY = 'db-ent-1';
export const TYPE_ID = 'type-link-1';

export function cleanupClearAdmin(): void {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
}

export function setAuthed(): void {
	signIn();
}

export function setAuthedAdmin(): void {
	signIn();
	adminStore.set('admin');
}

export function setAuthedWithTwoCollectives(): void {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		]
	});
}

export function rows(): LinkRow[] {
	return [
		{
			id: 'l-rec',
			name: 'Salvestused',
			url: 'https://f.io/GCkGMr5J',
			description: 'Crede recordings',
			displayOrder: 1
		},
		{ id: 'l-scores', name: 'Scores', url: 'example.com/x', description: null, displayOrder: 2 },
		{
			id: 'l-site',
			name: 'Website',
			url: 'https://crede.ee',
			description: 'Choir website',
			displayOrder: 3
		}
	];
}

export function rowEls(container: HTMLElement): HTMLElement[] {
	return qa(container, 'links-row');
}

export function rowNames(container: HTMLElement): string[] {
	return rowEls(container).map(
		(r) => r.querySelector('[data-testid="links-row-name"]')?.textContent?.trim() ?? ''
	);
}

export interface WireCall {
	db: string;
	path: string;
	method: string;
	body: unknown;
}

export function wireCalls(): WireCall[] {
	return (entuFetchMock.mock.calls as Array<[string, string, string, RequestInit | undefined]>).map(
		([db, path, , init]) => ({
			db,
			path: String(path),
			method: init?.method ?? 'GET',
			body: init?.body ? JSON.parse(String(init.body)) : undefined
		})
	);
}

export function cleanupClearResetAdminOnLine(): void {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
	resetOnLine();
}

// (*MVOX:Josquin*)
