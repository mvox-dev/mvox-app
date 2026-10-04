// Root page render for the season-manage specs whose sign-in comes from seasonManage.
import { render, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import Page from '../../../routes/+page.svelte';
import { q } from './dom';
import { setAuthedWithOneCollective } from './seasonManage';

export async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

// (*MVOX:Josquin*)
