import { describe, expect, it, vi } from 'vitest';

// #256 RED — the Lingikogu nav entry. NAV_ENTRIES grew 6 → 7: a 'links'
// entry, routed to /links, visible to EVERYONE (members READ the collection;
// only the page's admin controls are tier-gated — the codebase-wide
// "absent, not disabled" idiom lives on the page, not the nav).
//
// #338 — back to 6: the 'collectives' entry dies with its page (the picker
// moved into the agenda header; src/no-collectives-route.spec.ts guards the
// route's death). The companion pins in page.navshell-merge.spec.ts (the two
// hardcoded nav-count assertions) are flipped 7 → 6 in that same RED —
// a legitimate spec flip, cited there.
//
// GREP DECOY (blast finding): the bare string 'link' is overloaded by OAuth
// account-linking (`intent: 'link'`). This feature's key is 'links' (plural),
// its i18n key 'nav_links' — never bare 'link'.

vi.mock('$lib/paraglide/messages', () => ({
	nav_agenda: () => 'Agenda',
	nav_roster: () => 'Roster',
	nav_profile: () => 'Profile',
	nav_library: () => 'Library',
	nav_admin: () => 'Admin',
	nav_links: () => 'Lingikogu'
}));

import { NAV_ENTRIES } from './entries';

describe('#256 — NAV_ENTRIES carries the links entry', () => {
	it('has exactly 6 entries (#338 removed collectives) and the 6th is links → /links', () => {
		expect(NAV_ENTRIES.map((e) => e.key)).toHaveLength(6);
		const sixth = NAV_ENTRIES[5];
		expect(sixth.key).toBe('links');
		expect(sixth.route).toBe('/links');
	});

	it('carries NO collectives entry — the route died with #338 (the picker lives in the agenda header)', () => {
		expect(NAV_ENTRIES.find((e) => e.key === 'collectives')).toBeUndefined();
		expect(NAV_ENTRIES.find((e) => e.route === '/collectives')).toBeUndefined();
	});

	it('links is visible to plain members — read access is everyone; the admin gate lives on the page controls, not the nav', () => {
		const links = NAV_ENTRIES.find((e) => e.key === 'links');
		expect(links).toBeDefined();
		expect(links!.visible({ isAdmin: false, hasMultipleCollectives: false })).toBe(true);
		expect(links!.visible({ isAdmin: true, hasMultipleCollectives: true })).toBe(true);
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

// (*MVOX:Tallis* — #256 RED)
