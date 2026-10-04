// Profile page harness (no page import): the setup its specs had word for word.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';
import { resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import type { MessageFile } from '$lib/testing/messageFile.js';
import { applyFieldMoveMock, applyProfileSaveMock } from '$lib/testing/mocks/profile';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { signIn } from '$lib/testing/session';

export { LOCALES } from './files';

export const COLLECTIVE_A = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
export const COLLECTIVE_B = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

export function selectSampledb(): void {
	signIn({ token: 'jwt-member' });
}

export function cleanupResetGate(): void {
	cleanup();
	resetAppState();
	resetGate();
}

export function realTimersCleanupResetGate(): void {
	vi.useRealTimers();
	cleanup();
	resetAppState();
	resetGate();
}

export function resetSaveMocks(): void {
	listMyProfilesMock.mockReset();
	applyProfileSaveMock.mockReset();
	applyFieldMoveMock.mockReset();
}

export async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

export function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
	return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
}

export async function openEditor(
	container: HTMLElement,
	field: 'name' | 'email'
): Promise<HTMLInputElement> {
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

export async function waitReady(container: HTMLElement): Promise<void> {
	await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
}

export function readMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

// (*MVOX:Josquin*)
