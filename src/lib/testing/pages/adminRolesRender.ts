// Profile page render, waiting for both of the admin section's role lists (#916).
import { render, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import Page from '../../../routes/profile/+page.svelte';
import { q } from './dom';

export async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
		expect(q(rendered.container, 'admin-roles-librarians')).not.toBeNull();
	});
	return rendered;
}

// (*MVOX:Josquin*)
