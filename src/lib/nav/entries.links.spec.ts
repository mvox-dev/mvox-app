import { describe, expect, it, vi } from 'vitest';

// The links entry (key 'links', i18n key 'nav_links') is visible to everyone; admin-only
// controls live on the page. The bare string 'link' belongs to OAuth account-linking.

vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		nav_agenda: () => 'Agenda',
		nav_roster: () => 'Roster',
		nav_profile: () => 'Profile',
		nav_library: () => 'Library',
		nav_links: () => 'Lingikogu'
	})
);

import { NAV_ENTRIES } from './entries';

describe('#256 — NAV_ENTRIES carries the links entry', () => {
	it('has exactly 5 entries (#338 removed collectives, #916 admin) and the 5th is links → /links', () => {
		expect(NAV_ENTRIES.map((e) => e.key)).toHaveLength(5);
		const fifth = NAV_ENTRIES[4];
		expect(fifth.key).toBe('links');
		expect(fifth.route).toBe('/links');
	});

	it('carries NO collectives entry — the route died with #338 (the picker lives in the agenda header)', () => {
		expect(NAV_ENTRIES.find((e) => e.key === 'collectives')).toBeUndefined();
		expect(NAV_ENTRIES.find((e) => e.route === '/collectives')).toBeUndefined();
	});

	it('links is visible to plain members — read access is everyone; the admin gate lives on the page controls, not the nav', () => {
		const links = NAV_ENTRIES.find((e) => e.key === 'links');
		expect(links).toBeDefined();
		expect(links!.visible({ hasMultipleCollectives: false })).toBe(true);
		expect(links!.visible({ hasMultipleCollectives: true })).toBe(true);
	});

	it('label resolves through m.nav_links() and the entry carries an inline svg icon', () => {
		const links = NAV_ENTRIES.find((e) => e.key === 'links')!;
		expect(links.label()).toBe('Lingikogu');
		expect(links.icon).toContain('<svg');
	});

	it('no entry is keyed bare "link" (the OAuth account-linking decoy)', () => {
		expect(NAV_ENTRIES.find((e) => e.key === 'link')).toBeUndefined();
	});
});

// (*MVOX:Tallis*)
