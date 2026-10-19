// The library page's entry points: the one file that turns the read cache on for its reads.
import { CACHED_READ, CACHED_READ_STORE_ONLY } from '$lib/entu/fetchOptions';
import {
	listWorks,
	listLendings,
	listEditions,
	listCopies,
	listAllEditions,
	listAllCopies,
	resolveBorrowerNames,
	resolveCopyNames,
	resolveCopyChains,
	isActiveLending,
	type Work,
	type Edition,
	type Copy,
	type Lending,
	type LoanChain
} from './libraryData';
import { resolveLibraryEditRight, resolveMyLibraryId, type LibraryEditRightResult } from './libraryRights';
import { findMyMemberId } from '$lib/rsvp/rsvpData';
import { listActiveMembers, type ActiveMember } from '$lib/roster/rosterData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { ListRead } from '$lib/entu/listRead';

export interface LibraryListing {
	works: ListRead<Work>;
	lendings: ListRead<Lending>;
	borrowerNames: Map<string, string>;
}

function activeMemberIds(lendings: Lending[]): string[] {
	return lendings.filter(isActiveLending).map((l) => l.memberId);
}

export async function loadLibraryListing(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<LibraryListing> {
	const [works, lendings] = await Promise.all([
		listWorks(cfg, fetchImpl, CACHED_READ),
		listLendings(cfg, fetchImpl, CACHED_READ)
	]);
	const borrowerNames = await resolveBorrowerNames(
		cfg,
		activeMemberIds(lendings.items),
		fetchImpl,
		CACHED_READ
	);
	return { works, lendings, borrowerNames };
}

export async function loadLibraryEditions(
	cfg: EntuCfg,
	workId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<Edition>> {
	return listEditions(cfg, workId, fetchImpl, CACHED_READ);
}

export async function loadLibraryCopies(
	cfg: EntuCfg,
	editionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<Copy>> {
	return listCopies(cfg, editionId, fetchImpl, CACHED_READ);
}

// Store, never serve: a post-write re-read shows the live answer and moves the stored copy on.
export async function refreshLibraryLendings(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<{ lendings: ListRead<Lending>; borrowerNames: Map<string, string> }> {
	const lendings = await listLendings(cfg, fetchImpl, CACHED_READ_STORE_ONLY);
	const borrowerNames = await resolveBorrowerNames(
		cfg,
		activeMemberIds(lendings.items),
		fetchImpl,
		CACHED_READ_STORE_ONLY
	);
	return { lendings, borrowerNames };
}

// Cache-backed, so the offline screen shows the last-seen edit right, not a load error.
export async function loadLibraryEditRight(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<LibraryEditRightResult> {
	return resolveLibraryEditRight(cfg, personId, fetchImpl, undefined, CACHED_READ);
}

// Cached here, not in findMyMemberId: the RSVP write path resolves the same id before a POST.
export async function loadMyMemberId(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	return findMyMemberId(cfg, personId, fetchImpl, CACHED_READ);
}

export async function loadMyLoanCopyNames(
	cfg: EntuCfg,
	copyIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, string>> {
	return resolveCopyNames(cfg, copyIds, fetchImpl, CACHED_READ);
}

export async function loadMyLoanCopyChains(
	cfg: EntuCfg,
	copyIds: string[],
	works: Work[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, LoanChain>> {
	return resolveCopyChains(cfg, copyIds, works, fetchImpl, CACHED_READ);
}

export interface LibrarianPickers {
	editions: ListRead<Edition>;
	copies: ListRead<Copy>;
	members: ListRead<ActiveMember>;
}

export async function loadLibrarianPickers(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<LibrarianPickers> {
	const [editions, copies, members] = await Promise.all([
		listAllEditions(cfg, fetchImpl, CACHED_READ),
		listAllCopies(cfg, fetchImpl, CACHED_READ),
		listActiveMembers(cfg, fetchImpl, CACHED_READ)
	]);
	return { editions, copies, members };
}

export async function loadLibrarianMemberNames(
	cfg: EntuCfg,
	memberIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, string>> {
	return resolveBorrowerNames(cfg, memberIds, fetchImpl, CACHED_READ);
}

// Uncached on purpose: the `_parent` of a write is never served from the cache (readCache.ts).
export async function resolveWriteLibraryId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	return resolveMyLibraryId(cfg, fetchImpl);
}

// (*MVOX:Josquin*)
