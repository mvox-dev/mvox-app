// src/lib/components/nav/NavShell.spec.ts
// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import NavShell from './NavShell.svelte';
import type { NavEntry } from '$lib/nav/entries';

afterEach(() => {
	cleanup();
});

// `children` is a required Snippet prop on NavShell (page content passed via
// `{@render children?.()}`). Real usage always supplies it (+layout.svelte);
// tests need a stand-in snippet to satisfy the type and to assert the content
// area actually renders it.
const testChildren = createRawSnippet(() => ({
	render: () => '<div data-testid="page-content">Page Content</div>',
}));

const testEntries: NavEntry[] = [
	{
		key: 'agenda',
		label: () => 'Agenda',
		route: '/',
		icon: '<svg data-testid="icon-agenda"></svg>',
		visible: () => true,
	},
	{
		key: 'roster',
		label: () => 'Roster',
		route: '/roster',
		icon: '<svg data-testid="icon-roster"></svg>',
		visible: () => true,
	},
	{
		key: 'profile',
		label: () => 'Profile',
		route: '/profile',
		icon: '<svg data-testid="icon-profile"></svg>',
		visible: () => true,
	},
	{
		key: 'invite',
		label: () => 'Invite',
		route: '/admin/invite',
		icon: '<svg data-testid="icon-invite"></svg>',
		visible: (ctx) => ctx.isAdmin,
	},
];

describe('NavShell', () => {
	it('renders nothing for anonymous users', () => {
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/',
				anonymous: true,
			},
		});
		expect(container.querySelector('nav')).toBeNull();
	});

	it('renders nav with member entries for authenticated user, hides admin entry', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/',
			},
		});
		expect(screen.getByRole('navigation')).toBeTruthy();
		expect(screen.getByText('Agenda')).toBeTruthy();
		expect(screen.getByText('Roster')).toBeTruthy();
		expect(screen.getByText('Profile')).toBeTruthy();
		expect(screen.queryByText('Invite')).toBeNull();
	});

	it('renders admin entry when isAdmin is true', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/',
				isAdmin: true,
			},
		});
		expect(screen.getByText('Invite')).toBeTruthy();
	});

	it('marks active route with aria-current="page"', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/roster',
			},
		});
		const rosterLink = screen.getByText('Roster').closest('a');
		const agendaLink = screen.getByText('Agenda').closest('a');
		expect(rosterLink?.getAttribute('aria-current')).toBe('page');
		expect(agendaLink?.getAttribute('aria-current')).toBeNull();
	});

	it('exact-matches root route', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/roster',
			},
		});
		const agendaLink = screen.getByText('Agenda').closest('a');
		expect(agendaLink?.getAttribute('aria-current')).toBeNull();
	});

	it('marks entries as disabled when completion-locked (except profile, which stays active)', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/profile',
				completionLocked: true,
			},
		});
		const agendaLink = screen.getByText('Agenda').closest('a');
		const rosterLink = screen.getByText('Roster').closest('a');
		const profileLink = screen.getByText('Profile').closest('a');

		expect(agendaLink?.getAttribute('aria-disabled')).toBe('true');
		expect(agendaLink?.getAttribute('href')).toBe('/profile');
		expect(agendaLink?.getAttribute('tabindex')).toBe('-1');

		expect(rosterLink?.getAttribute('aria-disabled')).toBe('true');
		expect(rosterLink?.getAttribute('href')).toBe('/profile');
		expect(rosterLink?.getAttribute('tabindex')).toBe('-1');

		expect(profileLink?.getAttribute('aria-disabled')).toBeNull();
		expect(profileLink?.getAttribute('href')).toBe('/profile');
		expect(profileLink?.getAttribute('tabindex')).toBe('0');
		expect(profileLink?.getAttribute('aria-current')).toBe('page');
	});

	it('does not disable entries when completion gate is not locked', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/',
				completionLocked: false,
			},
		});
		const agendaLink = screen.getByText('Agenda').closest('a');
		expect(agendaLink?.getAttribute('aria-disabled')).toBeNull();
		expect(agendaLink?.getAttribute('href')).toBe('/');
		expect(agendaLink?.getAttribute('tabindex')).toBe('0');
	});

	it('sets aria-label on nav element', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/',
			},
		});
		const nav = screen.getByRole('navigation');
		expect(nav.getAttribute('aria-label')).toBe('Main navigation');
	});

	it('renders children content inside the nav-content area', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/',
			},
		});
		const content = screen.getByTestId('page-content');
		expect(content.textContent).toBe('Page Content');
		expect(content.closest('.nav-content')).toBeTruthy();
	});

	it('renders children content even when anonymous (no nav chrome)', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/',
				anonymous: true,
			},
		});
		expect(screen.getByTestId('page-content')).toBeTruthy();
	});
});

describe('NavShell — collective switcher', () => {
	const entriesWithCollectives: NavEntry[] = [
		...testEntries,
		{
			key: 'collectives',
			label: () => 'Collectives',
			route: '/collectives',
			icon: '<svg></svg>',
			visible: (ctx) => ctx.hasMultipleCollectives,
		},
	];

	it('hides collectives entry when hasMultipleCollectives is false', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: entriesWithCollectives,
				activeRoute: '/',
				hasMultipleCollectives: false,
			},
		});
		expect(screen.queryByText('Collectives')).toBeNull();
	});

	it('shows collectives entry when hasMultipleCollectives is true', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: entriesWithCollectives,
				activeRoute: '/',
				hasMultipleCollectives: true,
			},
		});
		expect(screen.getByText('Collectives')).toBeTruthy();
	});

	it('shows both invite and collectives entries when both flags are true', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: entriesWithCollectives,
				activeRoute: '/',
				isAdmin: true,
				hasMultipleCollectives: true,
			},
		});
		expect(screen.getByText('Invite')).toBeTruthy();
		expect(screen.getByText('Collectives')).toBeTruthy();
	});
});

describe('NavShell — prefix route matching', () => {
	it('activates /roster when on /roster/123', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/roster/123',
			},
		});
		const rosterLink = screen.getByText('Roster').closest('a');
		expect(rosterLink?.getAttribute('aria-current')).toBe('page');
	});

	it('does not activate / when on /roster', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/roster',
			},
		});
		const agendaLink = screen.getByText('Agenda').closest('a');
		expect(agendaLink?.getAttribute('aria-current')).toBeNull();
	});

	it('activates /admin/invite exactly (prefix match on full path)', () => {
		render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/admin/invite',
				isAdmin: true,
			},
		});
		const inviteLink = screen.getByText('Invite').closest('a');
		expect(inviteLink?.getAttribute('aria-current')).toBe('page');
	});
});

describe('NavShell — no visible entries', () => {
	it('renders only children (no nav chrome) when entries list is empty', () => {
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: [],
				activeRoute: '/',
			},
		});
		expect(container.querySelector('nav')).toBeNull();
	});

	it('renders only children when all entries are filtered out by visibility', () => {
		const allHidden: NavEntry[] = [
			{
				key: 'invite',
				label: () => 'Invite',
				route: '/admin/invite',
				icon: '<svg></svg>',
				visible: (ctx) => ctx.isAdmin,
			},
		];
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: allHidden,
				activeRoute: '/',
				isAdmin: false,
			},
		});
		expect(container.querySelector('nav')).toBeNull();
	});
});
