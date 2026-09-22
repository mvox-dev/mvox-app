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
	/**
	 * Whether this caller was actually admitted to the `entu_user` property —
	 * i.e. whether `identities`/`pendingInvites` describe an OBSERVATION rather
	 * than an unanswered question. See THE WITHHELD-BUCKET TELL below: a
	 * refused read is an HTTP 200 with the property simply missing, so an empty
	 * result alone cannot tell "no identities" from "not allowed to look".
	 */
	readable: boolean;
}

interface StoredEntuUserEntry {
	_id: string;
	uid?: string;
	provider?: string;
	email?: string;
	/** Masked as '***' — presence alone marks an un-redeemed invite placeholder. */
	invite?: string;
}

// THE WITHHELD-BUCKET TELL (#454) — why this read asks for `_viewer` too.
// `entu_user` sits in the PRIVATE bucket, and a reader not admitted to it
// gets HTTP 200 with the property filtered out, never a refusal (entu-api
// utils/entity.js:569-586; the route 403s only when no bucket admits at all,
// routes/[db]/entity/[_id]/index.get.js:97-102). `_viewer` is written into
// that same bucket and names every admitted caller — `access` is the union
// of the four rights tiers plus `_sharing` (utils/rights.js:76-97) — so
// `_viewer` present ⇔ the bucket was read. Withheld ⇒ omit the person.
// The rows are counted, never retained: `.string` carries PII (ER-26).

/**
 * List the caller's OWN bound auth identities plus a count of un-redeemed
 * invite placeholders (never presented as identities). Fails loud on any HTTP
 * failure — never resolves to a silently-empty list. `readable: false` marks
 * the other refusal shape: a 200 whose private bucket was withheld.
 */
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

	return { identities, pendingInvites, readable };
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
// FAIL LOUD, in the two shapes a refusal takes. An HTTP failure propagates
// out of `Promise.all` and rejects the whole call. A 200 whose private
// bucket was withheld carries no status to catch, so `listLinkedIdentities`
// reports `readable: false` (THE WITHHELD-BUCKET TELL above) and this
// function OMITS that personId. "Absent" therefore means OBSERVED absent,
// never "not returned" (the rosterData.ts:123 class of trap): a missing key
// tells the caller this reader cannot see it, which is what the roster's
// chip condition already acts on.
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

// (*MVOX:Josquin* — #193 GREEN: linked-identities display producer)
// (*MVOX:Palestrina* — #294 GREEN: listJoinStates, reusing listLinkedIdentities)
// (*MVOX:Josquin* — #454 GREEN: a withheld private bucket is not an observation)
