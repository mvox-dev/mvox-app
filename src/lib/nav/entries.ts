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

const inviteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>';

const collectivesIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

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
		key: 'invite',
		label: () => m.nav_invite(),
		route: '/admin/invite',
		icon: inviteIcon,
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
