// #193 — linked-identities read for the profile page.
//
// Display source per the SPIKE (2026-09-01, live-probed): the person entity's
// OWN `entu_user` array, read with the user's plain JWT — GET
// /{db}/entity/{personId}?props=entu_user. The prop-def is `_sharing: private`,
// and the user's self-`_editor` puts them in their own access set (entu-api
// utils/entity.js:575, utils/rights.js:84-93), so bound entries come back in
// full: {_id, uid, provider, email}. Un-redeemed invite placeholders come back
// MASKED as {_id, invite: '***'} (utils/entity.js:594-598) — they are NOT
// identities and must never be presented as one.
//
// READ-side exemption in the sole-invite-mechanism guard
// (lib/invite/singleInviteMechanism.spec.ts MINT_EXEMPT): this module reads the
// `entu_user` property but is not a mint mechanism — the trigger literal that
// actually mints (`INVITE_MINT_TRIGGER`) lives only in lib/invite/inviteData.ts.

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export interface LinkedIdentity {
	_id: string;
	uid: string;
	provider: string;
	email: string;
}

export interface LinkedIdentitiesResult {
	identities: LinkedIdentity[];
	pendingInvites: number;
}

interface StoredEntuUserEntry {
	_id: string;
	uid?: string;
	provider?: string;
	email?: string;
	/** Masked as '***' — presence alone marks an un-redeemed invite placeholder. */
	invite?: string;
}

/**
 * List the caller's OWN bound auth identities plus a count of un-redeemed
 * invite placeholders (never presented as identities). Fails loud on any HTTP
 * failure — never resolves to a silently-empty list.
 */
export async function listLinkedIdentities(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<LinkedIdentitiesResult> {
	const res = await entuFetch(
		cfg.db,
		`entity/${personId}?props=entu_user`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) {
		throw new Error(`listLinkedIdentities: identity read failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as { entity?: { entu_user?: StoredEntuUserEntry[] } };
	const entries = body.entity?.entu_user ?? [];

	const identities: LinkedIdentity[] = [];
	let pendingInvites = 0;
	for (const entry of entries) {
		if (typeof entry.invite === 'string') {
			pendingInvites += 1;
			continue;
		}
		identities.push({
			_id: entry._id,
			uid: entry.uid ?? '',
			provider: entry.provider ?? '',
			email: entry.email ?? ''
		});
	}

	return { identities, pendingInvites };
}

// (*MVOX:Josquin* — #193 GREEN: linked-identities display producer)
