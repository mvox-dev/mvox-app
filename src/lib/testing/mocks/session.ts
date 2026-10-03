// Session, profile, problem-report and locale mocks shared across specs.
import { vi } from 'vitest';

export const hydrateAuthMock = vi.fn();
export const hydrateCollectivesMock = vi.fn();
export const resolveGateMock = vi.fn();
export const resolveMembershipMock = vi.fn();
export const exchangeInviteMock = vi.fn();
export const listMyProfilesMock = vi.fn();
export const createOwnProfileMock = vi.fn();
export const saveProfileFieldsMock = vi.fn();
export const reportProblem = vi.fn();

type Real = () => Promise<unknown>;
const real = async (importOriginal: Real) => (await importOriginal()) as object;

export function sessionModule() {
	return { hydrateAuth: hydrateAuthMock };
}

export function collectivesStoreModule() {
	return { hydrateCollectives: hydrateCollectivesMock };
}

export async function completionGateModule(importOriginal: Real) {
	return { ...(await real(importOriginal)), resolveGate: resolveGateMock };
}

export async function membershipModule(importOriginal: Real) {
	return { ...(await real(importOriginal)), resolveMembership: resolveMembershipMock };
}

export function redeemModule() {
	return { exchangeSessionWithInvite: exchangeInviteMock };
}

export async function profileDataModule(importOriginal: Real) {
	return { ...(await real(importOriginal)), listMyProfiles: listMyProfilesMock };
}

export function profileWritesModule() {
	return { createOwnProfile: createOwnProfileMock, saveProfileFields: saveProfileFieldsMock };
}

export function reportProblemModule() {
	return { reportProblem };
}

// The spec switches the locale with localeMock.state.set('locale', …).
export const localeMock = {
	state: null as { get(k: string): string | undefined; set(k: string, v: string): unknown } | null
};

export async function localeRuntimeModule() {
	const { SvelteMap } = await import('svelte/reactivity');
	localeMock.state ??= new SvelteMap<string, string>([['locale', 'en']]);
	return {
		getLocale: () => localeMock.state!.get('locale'),
		setLocale: vi.fn(),
		locales: ['en', 'et', 'lv', 'uk'],
		overwriteGetLocale: vi.fn()
	};
}

// (*MVOX:Josquin*)
