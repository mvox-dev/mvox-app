// Admin, librarian, join-state and collective-name mocks shared across specs.
import { writable } from 'svelte/store';
import { vi } from 'vitest';
import type { EditRightState } from '$lib/nav/dbRights';

export const resolveDbEditRightMock = vi.fn();
export const dbEditRightStore = writable<EditRightState>('loading');
export const resolveDbRightMock = vi.fn();
export const resolveLibraryEditRightMock = vi.fn();
export const listJoinStatesMock = vi.fn();
export const resolveCollectiveNameMarkerMock = vi.fn();
export const updateCollectiveNameMock = vi.fn();
export const listAdminsMock = vi.fn();
export const addAdminMock = vi.fn();
export const removeAdminMock = vi.fn();
export const listLibrariansMock = vi.fn();
export const addLibrarianMock = vi.fn();
export const removeLibrarianMock = vi.fn();
export const resolveParentMock = vi.fn();
export const resolveInviteParentMock = vi.fn();
export const createInviteMock = vi.fn();
export const mintSelfLinkInviteMock = vi.fn();
export const sendInviteMock = vi.fn();
export const withdrawInviteMock = vi.fn();
export const listJoinStateDetailsMock = vi.fn();

export class InviteCreateError extends Error {
	readonly phase: string;
	readonly reason: string;
	readonly personId?: string;
	constructor(message: string, opts: { phase: string; reason: string; personId?: string }) {
		super(message);
		this.name = 'InviteCreateError';
		this.phase = opts.phase;
		this.reason = opts.reason;
		this.personId = opts.personId;
	}
}

export class RoleLockoutError extends Error {
	readonly code = 'role-lockout';
	constructor(entityId: string, personId: string) {
		super(`lockout ${entityId}/${personId}`);
		this.name = 'RoleLockoutError';
	}
}

export class RoleGrantMissingError extends Error {
	readonly code = 'role-grant-missing';
	constructor(entityId: string, personId: string) {
		super(`missing ${entityId}/${personId}`);
		this.name = 'RoleGrantMissingError';
	}
}

// 'dbEditRight': only resolveDbEditRight; 'both': resolveDbRight too.
export function dbRightsModule(wired: 'dbEditRight' | 'both' = 'both') {
	const base = { dbEditRight: dbEditRightStore, resolveDbEditRight: resolveDbEditRightMock };
	if (wired === 'dbEditRight') return base;
	return { ...base, resolveDbRight: resolveDbRightMock };
}

export function libraryRightsModule() {
	return { resolveLibraryEditRight: resolveLibraryEditRightMock };
}

export function joinStatesModule() {
	return { listJoinStates: listJoinStatesMock };
}

export function collectiveNameModule() {
	return {
		resolveCollectiveNameMarker: resolveCollectiveNameMarkerMock,
		updateCollectiveName: updateCollectiveNameMock
	};
}

const roleHandles = () => ({
	listAdmins: listAdminsMock,
	addAdmin: addAdminMock,
	removeAdmin: removeAdminMock,
	listLibrarians: listLibrariansMock,
	addLibrarian: addLibrarianMock,
	removeLibrarian: removeLibrarianMock
});

// errors: the module's error classes are the shared ones above.
export function roleManagementModule(opts: { errors?: boolean } = {}) {
	const errors = opts.errors ? { RoleLockoutError, RoleGrantMissingError } : {};
	return { ...errors, fetchRights: vi.fn(), ...roleHandles() };
}

export async function roleManagementOverRealModule(importOriginal: () => Promise<unknown>) {
	return { ...((await importOriginal()) as object), ...roleHandles() };
}

export function inviteDataModule(opts: { errors?: boolean } = {}) {
	return {
		...(opts.errors ? { InviteCreateError } : {}),
		resolvePersonParentId: resolveParentMock,
		resolveInviteParentId: resolveInviteParentMock,
		createInvite: createInviteMock,
		sendInvite: sendInviteMock
	};
}

export async function inviteDataOverRealModule(importOriginal: () => Promise<unknown>) {
	return {
		...((await importOriginal()) as object),
		resolvePersonParentId: resolveParentMock,
		createInvite: createInviteMock,
		sendInvite: sendInviteMock
	};
}

type Real = () => Promise<unknown>;
const real = async (importOriginal: Real) => (await importOriginal()) as object;

// withdraw: withdrawInvite is a shared handle too.
export async function inviteWritesModule(importOriginal: Real, opts: { withdraw: boolean }) {
	return {
		...(await real(importOriginal)),
		createInvite: createInviteMock,
		mintSelfLinkInvite: mintSelfLinkInviteMock,
		sendInvite: sendInviteMock,
		...(opts.withdraw ? { withdrawInvite: withdrawInviteMock } : {})
	};
}

export async function joinStateDetailsModule(importOriginal: Real) {
	return {
		...(await real(importOriginal)),
		listJoinStates: listJoinStatesMock,
		listJoinStateDetails: listJoinStateDetailsMock
	};
}

export async function dbRightsOverRealModule(importOriginal: Real) {
	return {
		...(await real(importOriginal)),
		resolveDbEditRight: resolveDbEditRightMock,
		resolveDbRight: resolveDbRightMock
	};
}

export async function dbRightOverRealModule(importOriginal: Real) {
	return { ...(await real(importOriginal)), resolveDbRight: resolveDbRightMock };
}

// (*MVOX:Josquin*)
