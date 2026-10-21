import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import type { EntuCfg } from '$lib/entu/cfg';
import { localDayKey } from '$lib/preferences/timeFormat';
import type { Lending } from './libraryData';
import { isActiveLending, listCopies } from './libraryData';

// The library write path (lending operations); libraryData.ts is read-only.

export interface CreateLendingPayload {
	copyId: string;
	memberId: string;
	assignedAt: string;
	assignedUntil?: string;
}

// Safe without setting `_sharing` (#133): Entu does not walk up the tree; it copies `_sharing`
// only from the parent named in the create request, here the library.
export async function createLending(
	cfg: EntuCfg,
	libraryId: string,
	payload: CreateLendingPayload,
	fetchImpl: typeof fetch = fetch
): Promise<Lending> {
	const typeId = await resolveTypeId(cfg, 'lending', fetchImpl);

	// `_sharing` copied at create from the library parent's own `domain` (which
	// the library itself inherited from the org) — #133.
	const props: Array<{ type: string; reference?: string; string?: string; date?: string }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: libraryId },
		{ type: 'copy', reference: payload.copyId },
		{ type: 'member', reference: payload.memberId },
		{ type: 'assigned_at', date: payload.assignedAt }
	];

	if (payload.assignedUntil) {
		props.push({ type: 'assigned_until', date: payload.assignedUntil });
	}

	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createLending failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };

	return {
		id: body._id,
		copyId: payload.copyId,
		memberId: payload.memberId,
		assignedAt: payload.assignedAt,
		assignedUntil: payload.assignedUntil ?? '',
		returnedAt: ''
	};
}

/**
 * Mark a lending as returned by posting today's date as `returned_at`.
 */
export async function returnLending(
	cfg: EntuCfg,
	lendingId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const today = localDayKey(new Date());
	const res = await entuFetch(
		cfg.db,
		`entity/${lendingId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'returned_at', date: today }])
		},
		fetchImpl
	);
	if (!res.ok) throw new Error(`returnLending failed: ${res.status}`);
}

// ── Bulk checkout: one lending per ticked member; each one fails on its own (#74) ──

/** Default copy resolver for bulkCheckout — fetches copies under the given edition. */
async function defaultResolveCopies(
	cfg: EntuCfg,
	editionId: string,
	fetchImpl: typeof fetch
): Promise<Array<{ id: string }>> {
	return (await listCopies(cfg, editionId, fetchImpl)).items;
}

export interface BulkCheckoutPayload {
	editionId: string;
	memberIds: string[];
	assignedAt: string;
	assignedUntil?: string;
}

export interface BulkResult {
	succeeded: Lending[];
	failed: Array<{ copyId: string; error: string }>;
}

// allSettled: a partial failure must not abort the other checkouts.
export async function bulkCheckout(
	cfg: EntuCfg,
	libraryId: string,
	payload: BulkCheckoutPayload,
	activeLendings: Lending[],
	fetchImpl: typeof fetch = fetch,
	resolveCopies: (cfg: EntuCfg, editionId: string, fetchImpl: typeof fetch) => Promise<Array<{ id: string }>> = defaultResolveCopies
): Promise<BulkResult> {
	// Step 1: resolve copies for this edition, then exclude already-lent ones
	const allCopies = await resolveCopies(cfg, payload.editionId, fetchImpl);
	const editionCopyIds = new Set(allCopies.map((c) => c.id));
	const lentCopyIds = new Set(
		activeLendings.filter(isActiveLending).map((l) => l.copyId)
	);
	const copies = allCopies.filter((c) => !lentCopyIds.has(c.id));

	// Step 1b: a stale snapshot could double-lend; drop holders and report them in `failed`.
	const membersAlreadyHolding = new Set(
		activeLendings
			.filter((l) => isActiveLending(l) && editionCopyIds.has(l.copyId))
			.map((l) => l.memberId)
	);
	const eligibleMembers = payload.memberIds.filter((id) => !membersAlreadyHolding.has(id));

	// Step 2: fail excess members who have no available copy
	const failed: Array<{ copyId: string; error: string }> = [];
	for (const memberId of payload.memberIds) {
		if (membersAlreadyHolding.has(memberId)) {
			failed.push({ copyId: '', error: `Member ${memberId} already holds a copy of this edition` });
		}
	}
	for (let i = copies.length; i < eligibleMembers.length; i++) {
		failed.push({ copyId: '', error: `No available copy for member ${eligibleMembers[i]}` });
	}

	// Step 3: attempt checkouts for feasible members (one copy per member)
	const feasibleMembers = eligibleMembers.slice(0, copies.length);
	const results = await Promise.allSettled(
		feasibleMembers.map((memberId, i) =>
			createLending(cfg, libraryId, {
				copyId: copies[i].id,
				memberId,
				assignedAt: payload.assignedAt,
				...(payload.assignedUntil ? { assignedUntil: payload.assignedUntil } : {})
			}, fetchImpl)
		)
	);

	const succeeded: Lending[] = [];
	results.forEach((result, i) => {
		if (result.status === 'fulfilled') {
			succeeded.push(result.value);
		} else {
			failed.push({
				copyId: copies[i].id,
				error: result.reason instanceof Error ? result.reason.message : String(result.reason)
			});
		}
	});

	return { succeeded, failed };
}

// (*MVOX:Josquin*)
