// The app-wide completion gate (#28): a member with no visible name is sent to /profile.
import { writable, type Writable } from 'svelte/store';
import type { MyProfile } from './profileData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type GateState = 'loading' | 'complete' | 'incomplete';

export const completionGateStore: Writable<GateState> = writable('loading');

// One generation for every gate read, layout and /profile alike (#800): an answer is dropped
// when a newer read or a reset began, never because the page that asked has unmounted.
let gateGeneration = 0;

export function beginGateRead(): () => boolean {
	const g = ++gateGeneration;
	return () => g === gateGeneration;
}

export function resetGate(): void {
	++gateGeneration;
	completionGateStore.set('loading');
}

export function hasDomainName(profiles: MyProfile[]): 'complete' | 'incomplete' {
	let domain: MyProfile | undefined;
	for (const p of profiles) if (p._sharing === 'domain') domain = p;
	return domain && domain.name.trim() !== '' ? 'complete' : 'incomplete';
}

// #58: a domain or public name passes; a private one never does, so no resolveField here.
export function hasVisibleName(profiles: MyProfile[]): 'complete' | 'incomplete' {
	let domain: MyProfile | undefined;
	let pub: MyProfile | undefined;
	for (const p of profiles) {
		if (p._sharing === 'domain') domain = p;
		else if (p._sharing === 'public') pub = p;
	}
	const domainOk = domain !== undefined && domain.name.trim() !== '';
	const publicOk = pub !== undefined && pub.name.trim() !== '';
	return domainOk || publicOk ? 'complete' : 'incomplete';
}

// A failed read is 'loading', never a false 'incomplete' that redirects a complete member.
// profileData loads lazily: every member surface imports this module, without the $env chain.
export async function resolveGate(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<GateState> {
	try {
		const { listMyProfiles } = await import('./profileData');
		return hasVisibleName(await listMyProfiles(cfg, personId, fetchImpl));
	} catch {
		return 'loading';
	}
}

export class DomainNameInconsistencyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DomainNameInconsistencyError';
	}
}

// A domain name save that reported success must read back a domain name, or fail loudly.
export async function assertDomainNamePersisted(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const { listMyProfiles } = await import('./profileData');
	if (hasDomainName(await listMyProfiles(cfg, personId, fetchImpl)) !== 'complete') {
		throw new DomainNameInconsistencyError(
			`completion gate: domain profile for person ${personId} reported a successful ` +
				`name save but read-back returned no domain name`
		);
	}
}
