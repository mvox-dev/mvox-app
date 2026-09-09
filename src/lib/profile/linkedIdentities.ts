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

// ── #294 — the roster's three-state join read ───────────────────────────────
//
// Mihkel (issue #294, verbatim): "Just check the person.entu_user. missing ->
// invite / present invite hash -> uninvite/reinvite / present username ->
// good!" — discriminated on the entry's CONTENTS, never on the property's
// presence (a presence check would badge an invited-but-never-joined member
// as "joined" — precisely the population the roster's controls exist for).
//
// Deliberately REUSES `listLinkedIdentities` per personId rather than a
// second discriminator: `identities.length > 0` is exactly "joined" (an entry
// carries `uid`), `pendingInvites > 0` is exactly "invited" (an entry carries
// only the masked `invite`), and neither is exactly "absent". Fanned out with
// `Promise.all`, mirroring the per-member profile fan-out `loadRoster` already
// does (rosterData.ts) — one read per row, genuinely independent.
//
// FAIL LOUD: a rejection on ANY person propagates out of `Promise.all` and
// rejects the whole call. The live probe (issue #294) observed a zero-rights
// caller get a clean TOTAL 403, never a 200 with the key silently omitted —
// so "absent" must mean OBSERVED absent, never "not returned" (the
// rosterData.ts:123 class of trap, kept out of this layer by refusing to
// guess).
export type JoinState = 'absent' | 'invited' | 'joined';

export async function listJoinStates(
	cfg: EntuCfg,
	personIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Record<string, JoinState>> {
	const entries = await Promise.all(
		personIds.map(async (personId) => {
			const { identities, pendingInvites } = await listLinkedIdentities(cfg, personId, fetchImpl);
			const state: JoinState =
				identities.length > 0 ? 'joined' : pendingInvites > 0 ? 'invited' : 'absent';
			return [personId, state] as const;
		})
	);
	const result: Record<string, JoinState> = {};
	for (const [personId, state] of entries) result[personId] = state;
	return result;
}

// (*MVOX:Josquin* — #193 GREEN: linked-identities display producer)
// (*MVOX:Palestrina* — #294 GREEN: listJoinStates, reusing listLinkedIdentities)
