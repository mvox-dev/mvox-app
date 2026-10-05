// Season-manage delete specs: the fixtures and helpers their files share.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { q } from '$lib/testing/pages/dom';

export async function armAndConfirmDelete(
	container: HTMLElement,
	kind: 'series' | 'event',
	id: string
): Promise<void> {
	await fireEvent.click(q(container, `season-manage-${kind}-delete-${id}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-manage-${kind}-delete-confirm-${id}`)).not.toBeNull();
	});
	await fireEvent.click(
		q(container, `season-manage-${kind}-delete-confirm-${id}`) as HTMLElement
	);
}

// Opens the season card, then waits for the panel and its series list.
export async function openPanelWithRows(container: HTMLElement): Promise<HTMLElement> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});
	return q(container, 'season-manage-panel') as HTMLElement;
}

// (*MVOX:Palestrina*) (*MVOX:Josquin*)
