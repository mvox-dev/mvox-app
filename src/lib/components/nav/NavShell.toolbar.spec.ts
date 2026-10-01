// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import NavShell from './NavShell.svelte';
import type { NavEntry } from '$lib/nav/entries';

afterEach(() => {
	cleanup();
});

const children = createRawSnippet(() => ({
	render: () => '<div data-testid="page-content">Page Content</div>'
}));
const toolbar = createRawSnippet(() => ({
	render: () => '<button type="button">Close</button>'
}));
const overlay = createRawSnippet(() => ({
	render: () => '<div data-testid="overlay-content">Editor</div>'
}));

const entries: NavEntry[] = [
	{ key: 'agenda', label: () => 'Agenda', route: '/', icon: '<svg></svg>', visible: () => true },
	{ key: 'roster', label: () => 'Roster', route: '/roster', icon: '<svg></svg>', visible: () => true }
];

describe('NavShell — a toolbar and an overlay replace the nav', () => {
	it('renders the toolbar in place of the nav, and the overlay over the still-mounted page', () => {
		render(NavShell, {
			props: { children, entries, activeRoute: '/', toolbar, toolbarLabel: 'Tools', overlay }
		});

		expect(screen.queryByRole('navigation')).toBeNull();
		const bar = screen.getByRole('toolbar', { name: 'Tools' });
		expect(bar.querySelector('button')?.textContent).toBe('Close');
		expect(screen.getByTestId('overlay-content')).toBeTruthy();
		const page = screen.getByTestId('page-content');
		expect(page.closest('.nav-content')?.hasAttribute('inert')).toBe(true);
	});

	it('dropping them brings the nav back over the same page node', async () => {
		const { rerender } = render(NavShell, {
			props: { children, entries, activeRoute: '/', toolbar, toolbarLabel: 'Tools', overlay }
		});
		const page = screen.getByTestId('page-content');

		await rerender({ toolbar: undefined, overlay: undefined });

		expect(screen.queryByRole('toolbar')).toBeNull();
		expect(screen.queryByTestId('overlay-content')).toBeNull();
		expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(2);
		expect(screen.getByTestId('page-content')).toBe(page);
		expect(page.closest('.nav-content')?.hasAttribute('inert')).toBe(false);
	});
});
