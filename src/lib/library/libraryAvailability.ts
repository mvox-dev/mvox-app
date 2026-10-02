// Library availability and the name lookups behind lent copies and my-loans rows.
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyProfiles } from '$lib/profile/profileData';
import { resolveRealNameByPerson } from '$lib/roster/rosterData';
import type { Copy, Edition, Lending, Work } from './libraryReads';

export type CopyAvailability =
	| { status: 'available' }
	| { status: 'lent'; memberId: string; assignedAt: string; assignedUntil: string };

// Two active lendings on one copy is bad data: warn and take the newest rather than break the page.
export function deriveCopyAvailability(copyId: string, lendings: Lending[]): CopyAvailability {
	const active = lendings.filter((l) => l.copyId === copyId && l.returnedAt === '');
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

async function resolveCopyName(
	cfg: EntuCfg,
	copyId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${copyId}?props=name,copy_number`, cfg.token, {}, fetchImpl, opts);
	if (!res.ok) throw new Error(`resolveCopyName: copy ${copyId} lookup failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: { name?: Array<{ string: string }>; copy_number?: Array<{ number: number }> };
	};
	const name = body.entity?.name?.[0]?.string ?? '';
	if (name) return name;
	const num = body.entity?.copy_number?.[0]?.number;
	if (num !== undefined) return `#${num}`;
	return '';
}

// Shared readers: `opts` defaults the cache off and reaches every read.
export async function resolveCopyNames(
	cfg: EntuCfg,
	copyIds: string[],
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<Map<string, string>> {
	const unique = [...new Set(copyIds)];
	const pairs = await Promise.all(
		unique.map(async (id) => [id, await resolveCopyName(cfg, id, fetchImpl, opts)] as const)
	);
	return new Map(pairs);
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
		lendings.filter((l) => l.returnedAt === '').map((l) => l.copyId)
	);
	const lent = workCopies.filter((c) => activeLentCopyIds.has(c.id)).length;
	return { available: workCopies.length - lent, total: workCopies.length };
}

export function activeLendingForMemberInEdition(
	memberId: string,
	editionCopyIds: Set<string>,
	lendings: Lending[]
): Lending | undefined {
	return lendings.find(
		(l) => l.memberId === memberId && editionCopyIds.has(l.copyId) && l.returnedAt === ''
	);
}

export interface LoanChain {
	copyNumber: number;
	workName: string;
	editionName: string;
}

export function formatLoanChainLabel(chain: LoanChain): string {
	const context = `${chain.workName} / ${chain.editionName}`;
	if (!chain.copyNumber) return context;
	return `Copy #${chain.copyNumber} — ${context}`;
}

export async function resolveCopyChains(
	cfg: EntuCfg,
	copyIds: string[],
	works: Work[],
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<Map<string, LoanChain>> {
	const unique = [...new Set(copyIds)];
	const editionCache = new Map<string, { name: string; workId: string }>();

	const pairs = await Promise.all(
		unique.map(async (copyId) => {
			const copyRes = await entuFetch(cfg.db, `entity/${copyId}?props=copy_number,_parent`, cfg.token, {}, fetchImpl, opts);
			if (!copyRes.ok) throw new Error(`resolveCopyChains: copy ${copyId} lookup failed: ${copyRes.status}`);
			const copyBody = (await copyRes.json()) as {
				entity?: {
					copy_number?: Array<{ number: number }>;
					_parent?: Array<{ reference: string; entity_type?: string }>;
				};
			};
			const copyNumber = copyBody.entity?.copy_number?.[0]?.number ?? 0;
			const editionParent = (copyBody.entity?._parent ?? []).find((p) => p.entity_type === 'edition');
			if (!editionParent) {
				return [copyId, { copyNumber, workName: '', editionName: '' }] as const;
			}

			const editionId = editionParent.reference;
			if (!editionCache.has(editionId)) {
				const edRes = await entuFetch(cfg.db, `entity/${editionId}?props=name,_parent`, cfg.token, {}, fetchImpl, opts);
				if (!edRes.ok) throw new Error(`resolveCopyChains: edition ${editionId} lookup failed: ${edRes.status}`);
				const edBody = (await edRes.json()) as {
					entity?: {
						name?: Array<{ string: string }>;
						_parent?: Array<{ reference: string; entity_type?: string }>;
					};
				};
				const edName = edBody.entity?.name?.[0]?.string ?? '';
				const workParent = (edBody.entity?._parent ?? []).find((p) => p.entity_type === 'work');
				editionCache.set(editionId, { name: edName, workId: workParent?.reference ?? '' });
			}

			const ed = editionCache.get(editionId)!;
			const workName = works.find((w) => w.id === ed.workId)?.name ?? '';
			return [copyId, { copyNumber, workName, editionName: ed.name }] as const;
		})
	);
	return new Map(pairs);
}
