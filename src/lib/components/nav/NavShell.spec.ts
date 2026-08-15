// src/lib/components/nav/NavShell.spec.ts
// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { render, screen, cleanup, createEvent, fireEvent } from '@testing-library/svelte';
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

	// Two entries share the '/admin' prefix. A per-entry `startsWith` test marks
	// BOTH current on /admin/invite — two aria-current="page", two folder tabs
	// highlighted. The deepest matching route wins, and only it.
	it('activates only the MOST SPECIFIC entry when two routes share a prefix', () => {
		const nested: NavEntry[] = [
			...testEntries,
			{
				key: 'admin',
				label: () => 'Admin',
				route: '/admin',
				icon: '<svg></svg>',
				visible: (ctx) => ctx.isAdmin,
			},
		];
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: nested,
				activeRoute: '/admin/invite',
				isAdmin: true,
			},
		});
		const active = Array.from(container.querySelectorAll('a[aria-current="page"]'));
		expect(active.map((a) => a.getAttribute('href'))).toEqual(['/admin/invite']);
		expect(container.querySelectorAll('.nav-entry--active').length).toBe(1);
	});

	it('activates the parent entry when on the parent route itself', () => {
		const nested: NavEntry[] = [
			...testEntries,
			{
				key: 'admin',
				label: () => 'Admin',
				route: '/admin',
				icon: '<svg></svg>',
				visible: (ctx) => ctx.isAdmin,
			},
		];
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: nested,
				activeRoute: '/admin',
				isAdmin: true,
			},
		});
		const active = Array.from(container.querySelectorAll('a[aria-current="page"]'));
		expect(active.map((a) => a.getAttribute('href'))).toEqual(['/admin']);
	});

	it('does not activate an entry on a sibling route sharing a string prefix', () => {
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/rosters-archive',
			},
		});
		expect(container.querySelectorAll('a[aria-current="page"]').length).toBe(0);
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


// ---------------------------------------------------------------------------
// #156 — roving tabindex. The nav is the pattern's reference implementation in
// this app, so its invariants are pinned here rather than read off the source:
// exactly ONE link carries tabindex="0", arrows move focus (and wrap), Tab is
// left alone so focus can leave, and — review F2 — the single stop is NEVER
// parked on a completion-locked link, which would drop the whole nav out of the
// tab order and strand the user away from Profile, the one link that clears the
// lock.
// ---------------------------------------------------------------------------
describe('NavShell — roving tabindex (#156)', () => {
	function navLinks(container: HTMLElement): HTMLAnchorElement[] {
		return Array.from(container.querySelectorAll<HTMLAnchorElement>('nav a'));
	}
	function tabStops(container: HTMLElement): HTMLAnchorElement[] {
		return navLinks(container).filter((a) => a.getAttribute('tabindex') === '0');
	}

	it('exactly ONE link is the Tab stop, and it is the current route', () => {
		const { container } = render(NavShell, {
			props: { children: testChildren, entries: testEntries, activeRoute: '/roster' },
		});
		const stops = tabStops(container);
		expect(stops).toHaveLength(1);
		expect(stops[0].getAttribute('href')).toBe('/roster');
	});

	it('ArrowRight moves focus to the next link and WRAPS at the end; ArrowLeft wraps backwards', async () => {
		const { container } = render(NavShell, {
			props: { children: testChildren, entries: testEntries, activeRoute: '/' },
		});
		const links = navLinks(container);
		expect(links).toHaveLength(3); // agenda, roster, profile

		links[0].focus();
		await fireEvent.keyDown(links[0], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(links[1]);

		await fireEvent.keyDown(links[1], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(links[2]);

		// …and round the end back to the first.
		await fireEvent.keyDown(links[2], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(links[0]);

		// Backwards from the first wraps to the last.
		await fireEvent.keyDown(links[0], { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(links[2]);
	});

	it('the Tab stop TRAVELS with focus — after arrowing, the newly focused link is the only "0"', async () => {
		const { container } = render(NavShell, {
			props: { children: testChildren, entries: testEntries, activeRoute: '/' },
		});
		const links = navLinks(container);
		links[0].focus();
		await fireEvent.keyDown(links[0], { key: 'ArrowRight' });

		const stops = tabStops(container);
		expect(stops).toHaveLength(1);
		expect(stops[0]).toBe(links[1]);
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus can leave the group and links still activate', () => {
		const { container } = render(NavShell, {
			props: { children: testChildren, entries: testEntries, activeRoute: '/' },
		});
		const link = navLinks(container)[0];
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(link, { key });
			fireEvent(link, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});

	it('completion-locked on a NON-profile route: the single Tab stop is Profile, not the disabled current-route entry (review F2)', () => {
		// The layout's redirect to /profile is an $effect, so a locked user
		// renders at least once on the route they asked for. If `activeNavKey`
		// resolved to that (disabled) entry, EVERY link would read tabindex="-1".
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/roster',
				completionLocked: true,
			},
		});
		const stops = tabStops(container);
		expect(stops, 'the nav must not fall out of the tab order').toHaveLength(1);
		expect(stops[0].getAttribute('href')).toBe('/profile');
		expect(stops[0].textContent).toContain('Profile');
	});

	it('completion-locked: FOCUSING a disabled link does not steal the Tab stop (review F2 — Chrome focuses anchors on click)', async () => {
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/profile',
				completionLocked: true,
			},
		});
		const agendaLink = screen.getByText('Agenda').closest('a') as HTMLAnchorElement;
		expect(agendaLink.getAttribute('aria-disabled')).toBe('true');

		await fireEvent.focus(agendaLink);

		const stops = tabStops(container);
		expect(stops, 'a disabled link must never become the sole tab stop').toHaveLength(1);
		expect(stops[0].getAttribute('href')).toBe('/profile');
	});

	it('completion-locked: arrow navigation skips the disabled links entirely', async () => {
		const { container } = render(NavShell, {
			props: {
				children: testChildren,
				entries: testEntries,
				activeRoute: '/profile',
				completionLocked: true,
			},
		});
		const profileLink = screen.getByText('Profile').closest('a') as HTMLAnchorElement;
		profileLink.focus();
		// Only ONE enabled member, so the wrap lands back on itself — never on a
		// greyed entry.
		await fireEvent.keyDown(profileLink, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(profileLink);
	});
});
