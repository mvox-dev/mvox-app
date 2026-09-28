// src/lib/library/libraryPageData.ts
//
// #434 slice 4/6 — the library's OWN entry points, the same role
// `agendaData.loadFullAgenda` (slice 2) and `eventPageData.ts` (slice 3) play
// for their screens: the ONE file allowed to switch the read-through cache on
// for the library page's reads, pinned in `readCache.optin-fence.spec.ts`'s
// allowlist.
//
// `libraryData.ts`'s listWorks / listLendings / listEditions / listCopies /
// resolveBorrowerNames are SHARED readers — they hard-wire no flag, and this
// file is where the cache decisions over them are taken:
//   - `loadLibraryListing` — the mounted screen's load: store AND serve, so
//     the works list, the lending log and the borrower-name overlay (member ->
//     person -> profile, real-names-overlaid) all give back the SAME answer
//     online or offline, and the served copy's age lands on `servedFromCache`
//     for the page's "as of <time>" line.
//   - `loadLibraryEditions` / `loadLibraryCopies` — the same store-and-serve
//     decision for a work/edition node's expansion, so an opened node stays
//     open offline too.
//   - `refreshLibraryLendings` — store only, never serve (same reasoning as
//     `eventPageData.ts`'s `refreshEventPageDetail`, slice 3 review round,
//     findings 1 and 2): the page's three post-write re-reads (inline
//     checkout, return, bulk checkout) must show the live answer, never a
//     stored copy of the pre-write availability, but an UNCACHED re-read
//     leaves the stored copy behind the write that just landed — a member who
//     checks out a copy and then goes offline would be shown the PRE-write
//     availability. Store-only stores exactly what the listing's lending read
//     stores, so a later offline listing shows the copy correctly returned/
//     checked out, and never touches `servedFromCache` (a background re-read
//     is not what the mounted screen is rendering).
import { CACHED_READ, CACHED_READ_STORE_ONLY } from '$lib/entu/fetchOptions';
import {
	listWorks,
	listLendings,
	listEditions,
	listCopies,
	resolveBorrowerNames,
	type Work,
	type Edition,
	type Copy,
	type Lending
} from './libraryData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { ListRead } from '$lib/entu/listRead';

export interface LibraryListing {
	works: ListRead<Work>;
	lendings: ListRead<Lending>;
	/** memberId -> display name, same real-names-overlaid map libraryData.ts's
	 *  resolveBorrowerNames produces — resolved over the ACTIVE lendings' member
	 *  ids only (the page's own load computes it the same way). */
	borrowerNames: Map<string, string>;
}

function activeMemberIds(lendings: Lending[]): string[] {
	return lendings.filter((l) => l.returnedAt === '').map((l) => l.memberId);
}

/**
 * The library page's cache-backed load — `+page.svelte`'s `loadForSelected`
 * is its only caller: the ONE read whose result this screen renders, and so
 * the ONE that may claim the screen is stale (`servedFromCache` ->
 * `data-testid="library-as-of"`).
 */
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

/** A work node's editions, cache-backed the same way as the listing. */
export async function loadLibraryEditions(
	cfg: EntuCfg,
	workId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<Edition>> {
	return listEditions(cfg, workId, fetchImpl, CACHED_READ);
}

/** An edition node's copies, cache-backed the same way as the listing. */
export async function loadLibraryCopies(
	cfg: EntuCfg,
	editionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<Copy>> {
	return listCopies(cfg, editionId, fetchImpl, CACHED_READ);
}

/**
 * The lending log + borrower names, STORED but never SERVED (#434 slice 3
 * review round, findings 1 and 2 — same shape as `eventPageData.ts`'s
 * `refreshEventPageDetail`). Live answer or nothing: online it stores exactly
 * what `loadLibraryListing` would, so the stored copy moves past the write
 * that just landed; offline the network rejection propagates untouched, and
 * `servedFromCache` is left exactly as the mounted screen's own reads left it.
 *
 * The page's three post-write re-reads (inline checkout, return, bulk
 * checkout) all call this — never `loadLibraryListing` (that would risk
 * serving a STORED, pre-write availability right after a write just landed)
 * and never the bare `listLendings`/`resolveBorrowerNames` (that would never
 * update the stored copy at all, leaving a member who writes and then goes
 * offline looking at her own superseded availability).
 */
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

// (*MVOX:Josquin* — #434 slice 4/6 GREEN)
