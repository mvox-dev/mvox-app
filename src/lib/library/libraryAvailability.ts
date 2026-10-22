// Library availability and the borrower lookups behind lent copies.
import { m } from '$lib/paraglide/messages.js';
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { listMyProfiles } from '$lib/profile/profileData';
import { resolveRealNameByPerson } from '$lib/roster/rosterData';
import type { Copy, Edition, Lending } from './libraryReads';

export type CopyAvailability =
	| { status: 'available' }
	| { status: 'lent'; memberId: string; assignedAt: string; assignedUntil: string };

// Two active lendings on one copy is bad data: warn and take the newest rather than break the page.
export function deriveCopyAvailability(copyId: string, lendings: Lending[]): CopyAvailability {
	const active = lendings.filter((l) => l.copyId === copyId && isActiveLending(l));
	if (active.length === 0) return { status: 'available' };
	if (active.length > 1) {
		console.warn(
			`deriveCopyAvailability: copy ${copyId} has ${active.length} concurrent active lendings`
		);
	}
	const chosen = active.reduce((a, b) => (a.assignedAt >= b.assignedAt ? a : b));
	return {
		status: 'lent',
		memberId: chosen.memberId,
		assignedAt: chosen.assignedAt,
		assignedUntil: chosen.assignedUntil
	};
}

// A member has no name: member -> person -> profile, domain or public only, as the roster does.
async function resolveBorrowerName(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<{ personId: string; profileName: string }> {
	const res = await entuFetch(cfg.db, `entity/${memberId}?props=person`, cfg.token, {}, fetchImpl, opts);
	if (!res.ok) throw new Error(`resolveBorrowerName: member ${memberId} lookup failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { person?: Array<{ reference: string }> } };
	const personId = body.entity?.person?.[0]?.reference;
	if (!personId) {
		throw new Error(`resolveBorrowerName: member ${memberId} carries no readable person reference`);
	}

	const profiles = await listMyProfiles(cfg, personId, fetchImpl, opts);
	let domain = '';
	let pub = '';
	for (const p of profiles) {
		if (p._sharing === 'domain' && p.name.trim() !== '') domain = p.name.trim();
		else if (p._sharing === 'public' && p.name.trim() !== '') pub = p.name.trim();
	}
	return { personId, profileName: domain !== '' ? domain : pub };
}

// Fails loud as a batch; the real-names overlay (#469) is read once, falling back to profile names.
export async function resolveBorrowerNames(
	cfg: EntuCfg,
	memberIds: string[],
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<Map<string, string>> {
	const unique = [...new Set(memberIds)];
	if (unique.length === 0) return new Map();
	const pairs = await Promise.all(
		unique.map(async (id) => [id, await resolveBorrowerName(cfg, id, fetchImpl, opts)] as const)
	);
	const { byPerson } = await resolveRealNameByPerson(cfg, fetchImpl, opts);
	return new Map(
		pairs.map(([id, { personId, profileName }]) => {
			const recordName = byPerson.get(personId)?.trim();
			return [id, recordName ? recordName : profileName] as const;
		})
	);
}

export function deriveEditionAvailability(
	editionId: string,
	copies: Copy[],
	lendings: Lending[]
): { available: number; total: number } {
	const editionCopies = copies.filter((c) => c.editionId === editionId);
	const available = editionCopies.filter(
		(c) => deriveCopyAvailability(c.id, lendings).status === 'available'
	).length;
	return { available, total: editionCopies.length };
}

export function deriveWorkAvailability(
	workId: string,
	editions: Edition[],
	copies: Copy[],
	lendings: Lending[]
): { available: number; total: number } {
	const editionIds = new Set(editions.filter((e) => e.workId === workId).map((e) => e.id));
	const workCopies = copies.filter((c) => editionIds.has(c.editionId));
	const activeLentCopyIds = new Set(
		lendings.filter(isActiveLending).map((l) => l.copyId)
	);
	const lent = workCopies.filter((c) => activeLentCopyIds.has(c.id)).length;
	return { available: workCopies.length - lent, total: workCopies.length };
}

export function isActiveLending(l: Lending): boolean {
	return l.returnedAt === '';
}

export function activeLendingForMemberInEdition(
	memberId: string,
	editionCopyIds: Set<string>,
	lendings: Lending[]
): Lending | undefined {
	return lendings.find(
		(l) => l.memberId === memberId && editionCopyIds.has(l.copyId) && isActiveLending(l)
	);
}

export function copyLabel(copy: Copy): string {
	if (copy.name) return copy.name;
	return copy.copyNumber
		? m.library_copy_number({ copyNumber: copy.copyNumber })
		: m.library_copy_name_unknown();
}
