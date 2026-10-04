// Arrange-view helpers and fixtures some roster specs had word for word.
import { waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import type { RosterRow } from '$lib/roster/rosterData';
import { q } from './dom';

export function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop2'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] },
		{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-tenor'] }
	];
}

export function rowOrder(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="arrange-row-"]')].map(
		(el) => el.getAttribute('data-testid') ?? ''
	);
}

export function row(container: HTMLElement, id: string): HTMLElement {
	return q(container, `arrange-row-${id}`) as HTMLElement;
}

export function dropZone(container: HTMLElement, id: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[data-drop-row="${id}"]`);
	expect(el, `drop zone for ${id}`).not.toBeNull();
	return el as HTMLElement;
}

export function makeDataTransfer() {
	const data: Record<string, string> = {};
	return {
		setData: (k: string, v: string) => {
			data[k] = v;
		},
		getData: (k: string) => data[k] ?? '',
		effectAllowed: '',
		dropEffect: ''
	};
}

export async function switchToOtherChoirArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-sop')).toBeNull();
}

// (*MVOX:Josquin*)
