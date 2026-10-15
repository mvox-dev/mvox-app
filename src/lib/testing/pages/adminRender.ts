// Profile page render, waiting for the admin section's admins list only (#916).
import { render, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import Page from '../../../routes/profile/+page.svelte';
import { q } from './dom';

export async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
	});
	return rendered;
}

// (*MVOX:Josquin*)
