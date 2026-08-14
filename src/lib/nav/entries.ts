// src/lib/nav/entries.ts
import * as m from '$lib/paraglide/messages';

export interface NavContext {
	isAdmin: boolean;
	hasMultipleCollectives: boolean;
}

export interface NavEntry {
	key: string;
	label: () => string;
	route: string;
	icon: string;
	visible: (ctx: NavContext) => boolean;
}

const agendaIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

const rosterIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>';

const profileIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/></svg>';

const libraryIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

const collectivesIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

const adminIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/></svg>';

export const NAV_ENTRIES: NavEntry[] = [
	{
		key: 'agenda',
		label: () => m.nav_agenda(),
		route: '/',
		icon: agendaIcon,
		visible: () => true,
	},
	{
		key: 'roster',
		label: () => m.nav_roster(),
		route: '/roster',
		icon: rosterIcon,
		visible: () => true,
	},
	{
		key: 'profile',
		label: () => m.nav_profile(),
		route: '/profile',
		icon: profileIcon,
		visible: () => true,
	},
	{
		key: 'library',
		label: () => m.nav_library(),
		route: '/library',
		icon: libraryIcon,
		visible: () => true,
	},
	{
		key: 'admin',
		label: () => m.nav_admin(),
		route: '/admin',
		icon: adminIcon,
		visible: (ctx) => ctx.isAdmin,
	},
	{
		key: 'collectives',
		label: () => m.nav_collectives(),
		route: '/collectives',
		icon: collectivesIcon,
		visible: (ctx) => ctx.hasMultipleCollectives,
	},
];

// (*MVOX:Palestrina*)
