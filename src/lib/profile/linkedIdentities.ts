// The person's own `entu_user` identities (#193); a read, not an invite mechanism (MINT_EXEMPT).
// Bound entries come back whole; invite placeholders come back masked and are never identities.

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { reportProblem } from '$lib/problems/reportProblem';

export interface LinkedIdentity {
	_id: string;
	uid: string;
	provider: string;
	email: string;
}

export interface LinkedIdentitiesResult {
	identities: LinkedIdentity[];
	pendingInvites: number;
	// False when the private bucket was withheld: a 200 that answers nothing.
	readable: boolean;
	// At most one live placeholder exists: the mint sweeps stale ones first (#467).
	pendingInviteId?: string;
}

interface StoredEntuUserEntry {
	_id: string;
	uid?: string;
	provider?: string;
	email?: string;
	invite?: string;
}

// `_viewer` lives in the same private bucket, so `_viewer` present means the bucket was read
// (#454). Rows are counted, never kept: `.string` carries PII (ER-26).
// Fails loud on HTTP failure, never a silently empty list.
export async function listLinkedIdentities(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<LinkedIdentitiesResult> {
	const res = await entuFetch(
		cfg.db,
		`entity/${personId}?props=entu_user,_viewer`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) {
		throw new Error(`listLinkedIdentities: identity read failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as {
		entity?: { entu_user?: StoredEntuUserEntry[]; _viewer?: unknown[] };
	};
	const readable = (body.entity?._viewer?.length ?? 0) > 0;
	const entries = readable ? (body.entity?.entu_user ?? []) : [];

	const identities: LinkedIdentity[] = [];
	let pendingInvites = 0;
	let pendingInviteId: string | undefined;
	for (const entry of entries) {
		if (typeof entry.invite === 'string') {
			pendingInvites += 1;
			pendingInviteId = entry._id;
			continue;
		}
		identities.push({
			_id: entry._id,
			uid: entry.uid ?? '',
			provider: entry.provider ?? '',
			email: entry.email ?? ''
		});
	}

	return { identities, pendingInvites, readable, pendingInviteId };
}

// Join state from the entries' contents, never the property's presence (#294, Mihkel).
// A withheld bucket omits the person: "absent" always means observed absent.
export type JoinState = 'absent' | 'invited' | 'joined';

export async function listJoinStates(
	cfg: EntuCfg,
	personIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Record<string, JoinState>> {
	const entries = await Promise.all(
		personIds.map(async (personId) => {
			const { identities, pendingInvites, readable } = await listLinkedIdentities(
				cfg,
				personId,
				fetchImpl
			);
			if (!readable) return [personId, undefined] as const;
			const state: JoinState =
				identities.length > 0 ? 'joined' : pendingInvites > 0 ? 'invited' : 'absent';
			return [personId, state] as const;
		})
	);
	const result: Record<string, JoinState> = {};
	for (const [personId, state] of entries) {
		if (state !== undefined) result[personId] = state;
	}
	return result;
}

// Dated join state (#467): the entity read still fails loud; a failed stamp read skips one row.
export type JoinStateDetail = { state: JoinState; at?: string };

export async function listJoinStateDetails(
	cfg: EntuCfg,
	personIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Record<string, JoinStateDetail>> {
	const entries = await Promise.all(
		personIds.map(async (personId) => {
			const { identities, pendingInvites, pendingInviteId, readable } =
				await listLinkedIdentities(cfg, personId, fetchImpl);
			if (!readable) return [personId, undefined] as const;
			if (identities.length > 0) {
				const at = await readPropertyCreatedAt(cfg, identities[0]._id, fetchImpl);
				return [personId, { state: 'joined', at } as JoinStateDetail] as const;
			}
			if (pendingInvites > 0 && pendingInviteId !== undefined) {
				const at = await readPropertyCreatedAt(cfg, pendingInviteId, fetchImpl);
				return [personId, { state: 'invited', at } as JoinStateDetail] as const;
			}
			return [personId, { state: 'absent' } as JoinStateDetail] as const;
		})
	);
	const result: Record<string, JoinStateDetail> = {};
	for (const [personId, detail] of entries) {
		if (detail !== undefined) result[personId] = detail;
	}
	return result;
}

// `created.at` exists only on the property-value read; `created.by` is PII, never read (ER-26).
export async function readPropertyCreatedAt(
	cfg: EntuCfg,
	propertyId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string | undefined> {
	const res = await entuFetch(cfg.db, `property/${propertyId}`, cfg.token, {}, fetchImpl);
	if (!res.ok) {
		const error = new Error(`property ${propertyId}: HTTP ${res.status}`);
		reportProblem({ area: 'profile', action: 'reading when a linked account was added', error });
		return undefined;
	}
	const body = (await res.json()) as { created?: { at?: string } };
	const at = body.created?.at;
	// A null is as unusable as a missing key: it would format as 1970-01-01.
	if (typeof at !== 'string') {
		console.warn(`readPropertyCreatedAt: property ${propertyId} carries no created.at`);
		return undefined;
	}
	return at;
}

// (*MVOX:Josquin*) (*MVOX:Palestrina*)
