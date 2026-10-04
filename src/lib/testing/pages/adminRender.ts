// Admin page render that waits for the admins list only; imports the page.
import { render, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import Page from '../../../routes/admin/+page.svelte';
import { q } from './dom';

export async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
	});
	return rendered;
}

// (*MVOX:Josquin*)
