import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { Lending } from './libraryData';

// T6.4/#73 — the library WRITE path (lending operations). Separated from
// libraryData.ts which is explicitly read-only (see its module header).

export interface CreateLendingPayload {
	copyId: string;
	memberId: string;
	assignedAt: string;
	assignedUntil?: string;
}

/**
 * Create a new lending entity under the library. Resolves the `lending` type-def
 * id, then POSTs the entity with copy/member references, assigned_at date, and
 * domain sharing. Returns the created Lending mapped from the payload + response.
 */
export async function createLending(
	cfg: EntuCfg,
	libraryId: string,
	payload: CreateLendingPayload,
	fetchImpl: typeof fetch = fetch
): Promise<Lending> {
	const typeId = await resolveTypeId(cfg, 'lending', fetchImpl);

	const props: Array<{ type: string; reference?: string; string?: string; date?: string }> = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: libraryId },
		{ type: 'copy', reference: payload.copyId },
		{ type: 'member', reference: payload.memberId },
		{ type: 'assigned_at', date: payload.assignedAt },
		{ type: '_sharing', string: 'domain' }
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
	const today = new Date().toISOString().slice(0, 10);
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

// ── #74 bulk checkout + return ──────────────────────────────────────────────

export interface BulkCheckoutPayload {
	copyIds: string[];
	memberId: string;
	assignedAt: string;
	assignedUntil?: string;
}

export interface BulkResult {
	succeeded: Lending[];
	failed: Array<{ copyId: string; error: string }>;
}

export interface BulkReturnResult {
	succeeded: string[];
	failed: Array<{ lendingId: string; error: string }>;
}

/**
 * Check out multiple copies to the same member in one batch. Uses
 * Promise.allSettled so partial failures don't abort the whole operation.
 */
export async function bulkCheckout(
	cfg: EntuCfg,
	libraryId: string,
	payload: BulkCheckoutPayload,
	fetchImpl: typeof fetch = fetch
): Promise<BulkResult> {
	const results = await Promise.allSettled(
		payload.copyIds.map((copyId) =>
			createLending(
				cfg,
				libraryId,
				{
					copyId,
					memberId: payload.memberId,
					assignedAt: payload.assignedAt,
					...(payload.assignedUntil ? { assignedUntil: payload.assignedUntil } : {})
				},
				fetchImpl
			)
		)
	);

	const succeeded: Lending[] = [];
	const failed: Array<{ copyId: string; error: string }> = [];

	results.forEach((result, i) => {
		if (result.status === 'fulfilled') {
			succeeded.push(result.value);
		} else {
			failed.push({
				copyId: payload.copyIds[i],
				error: result.reason instanceof Error ? result.reason.message : String(result.reason)
			});
		}
	});

	return { succeeded, failed };
}

/**
 * Return multiple lendings in one batch. Same allSettled partial-failure pattern.
 */
export async function bulkReturn(
	cfg: EntuCfg,
	lendingIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<BulkReturnResult> {
	const results = await Promise.allSettled(
		lendingIds.map((id) => returnLending(cfg, id, fetchImpl))
	);

	const succeeded: string[] = [];
	const failed: Array<{ lendingId: string; error: string }> = [];

	results.forEach((result, i) => {
		if (result.status === 'fulfilled') {
			succeeded.push(lendingIds[i]);
		} else {
			failed.push({
				lendingId: lendingIds[i],
				error: result.reason instanceof Error ? result.reason.message : String(result.reason)
			});
		}
	});

	return { succeeded, failed };
}

// (*MVOX:Josquin*)
