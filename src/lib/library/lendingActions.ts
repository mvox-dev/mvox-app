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

// (*MVOX:Josquin*)
