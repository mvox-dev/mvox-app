// Root page agenda render; imports the page, so root page specs only.
import { render, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import Page from '../../../routes/+page.svelte';
import { setAuthedWithOneCollective } from './agenda';

export async function renderAgenda(
	upcoming: AgendaItem[],
	recent: AgendaItem[] = []
): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming, recent }));
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
	});
	return container as HTMLElement;
}

// (*MVOX:Josquin*)
