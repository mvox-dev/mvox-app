// A member's shared profile subset and the roster row built from it.
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyProfiles, resolveField, type MyProfile } from '$lib/profile/profileData';
import { hasVisibleName } from '$lib/profile/completionGate';
import type { ActiveMember } from './rosterData';

// Safe for any member's personId: entu-api withholds her private profile server-side,
// so this module has no private-tier filter and must never grow one.
export function listProfilesForPerson(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MyProfile[]> {
	return listMyProfiles(cfg, personId, fetchImpl);
}

export interface RosterRow {
	memberId: string;
	personId: string;
	name: string;
	email: string;
	sectionIds?: string[];
	dbEntityId?: string;
	// The profile name, kept beside a displayed real name for the row's own name surfaces.
	profileName?: string;
	createdAt?: string;
	ownerIds?: string[];
}

// The name is the domain-or-public scan hasVisibleName uses, never resolveField: narrower-wins
// would let a private-only name through. null is the #28 completeness gate, not a privacy filter.
export function toRosterRow(member: ActiveMember, profiles: MyProfile[]): RosterRow | null {
	if (hasVisibleName(profiles) === 'incomplete') return null;
	let domain: MyProfile | undefined;
	let pub: MyProfile | undefined;
	for (const p of profiles) {
		if (p._sharing === 'domain') domain = p;
		else if (p._sharing === 'public') pub = p;
	}
	const domainName = domain?.name.trim() ?? '';
	const publicName = pub?.name.trim() ?? '';
	return {
		memberId: member.memberId,
		personId: member.personId,
		name: domainName !== '' ? domainName : publicName,
		email: resolveField(profiles, 'email').value,
		sectionIds: member.sectionIds,
		dbEntityId: member.dbEntityId,
		createdAt: member.createdAt,
		ownerIds: member.ownerIds
	};
}
