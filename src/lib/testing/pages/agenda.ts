// Root page agenda harness: sign-in, fixtures, filter chips and resets its specs had word for word.
import { cleanup } from '@testing-library/svelte';
import { expect } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';
import { setAgendaView } from '$lib/preferences/agendaView';
import { resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { signIn } from '$lib/testing/session';

export function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
}

export function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: 'org-a', name: 'Org A', personId: 'p1' }, { db: 'org-b', name: 'Org B', personId: 'p1' }] });
}

export type AppLocale = 'en' | 'et' | 'lv' | 'uk';

export function item(id: string, name: string, startDatetime: string, eventType: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType
	} as AgendaItem;
}

export const UP_CONCERT = item('up-con', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');

export const UP_REHEARSAL = item('up-reh', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');

export const UP_FREETEXT = item('up-proov', 'Eriproov', '2030-06-14T16:00:00.000Z', 'proov');

export function chipGroup(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[role="group"][aria-label="[msg:filter-group]"]');
}

export function chips(container: HTMLElement): HTMLButtonElement[] {
	const group = chipGroup(container);
	return group ? Array.from(group.querySelectorAll('button')) : [];
}

export function chip(container: HTMLElement, testid: string): HTMLButtonElement {
	const el = container.querySelector(`[data-testid="${testid}"]`);
	expect(el, `chip ${testid} must exist`).not.toBeNull();
	return el as HTMLButtonElement;
}

export function chipTestids(container: HTMLElement): (string | null)[] {
	return chips(container).map((b) => b.getAttribute('data-testid'));
}

export function chipTexts(container: HTMLElement): (string | undefined)[] {
	return chips(container).map((b) => b.textContent?.trim());
}

export function upcomingRowIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-row-', '')
	);
}

export function cleanupResetAgendaMocks(): void {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
}

export function cleanupResetAgendaGate(): void {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
	resetGate();
}

export function cleanupResetAgendaView(): void {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
	setAgendaView('list');
	if (typeof localStorage !== 'undefined') localStorage.clear();
}

// (*MVOX:Josquin*)
