import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// TU.1/#109 review — the ONE way this app answers "which organization entity is
// THIS person's collective, in THIS db".
//
// WHY IT EXISTS (live-verified 2026-08-12, probe-67 output in
// scripts/migrations/seed-results/probe-67-organization-limit1-*.json):
// `entity?_type.string=organization&limit=1` answers `count: 6` and returns
// "Eesti Kammerkooride Liit" (69c7f8718489bfcb0e81b05a) — the UMBRELLA
// FEDERATION — not the collective "Eesti Filharmoonia Kammerkoor"
// (69c7f8718489bfcb0e81b065). All six org entities are `_sharing: domain`, so
// every authenticated member reads all six and that first-hit guess is wrong for
// every caller. Any code that needs "the org" must therefore derive it from the
// PERSON, never from a `limit=1` search.
//
// The person's own active `member` row carries the answer: its `_parent` holds
// exactly one `entity_type: 'organization'` entry (live-verified: 133/133 active
// polyphony members → EFK). Same query shape as `findMyMemberId`
// (rsvpData.ts:38-53), widened to project `_parent`.
//
// FAIL LOUD, never guess:
//   - non-2xx                    → MyOrgLookupError, reason 'http' (status named)
//   - `count` > 1 member rows    → MyOrgLookupError, reason 'ambiguous' (a person
//                                  with memberships in two orgs of the same db
//                                  cannot be resolved to one collective here)
//   - no member row / no org `_parent` visible → `null` (an ANSWER, not an
//     error: "this reader has no visible collective membership"). Callers decide
//     what that means for them — it is never silently replaced by another org.

export type MyOrgLookupReason = 'http' | 'ambiguous';

export class MyOrgLookupError extends Error {
	readonly reason: MyOrgLookupReason;
	/** HTTP status when `reason === 'http'`. */
	readonly status?: number;

	constructor(message: string, opts: { reason: MyOrgLookupReason; status?: number }) {
		super(message);
		this.name = 'MyOrgLookupError';
		this.reason = opts.reason;
		this.status = opts.status;
	}
}

/**
 * Resolve the organization entity id of the person's own collective in `cfg.db`,
 * read off her active `member` row's `_parent`. `null` when no active membership
 * (or no organization parent on it) is visible to this reader. See module header.
 */
export async function resolveMyOrgId(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	if (!personId) {
		throw new MyOrgLookupError('resolveMyOrgId: personId must not be empty', {
			reason: 'ambiguous'
		});
	}
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=member&person.reference=${encodeURIComponent(personId)}&status.string=active&props=_parent&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) {
		throw new MyOrgLookupError(
			`resolveMyOrgId: member lookup failed: HTTP ${res.status} in db '${cfg.db}'`,
			{ reason: 'http', status: res.status }
		);
	}
	const body = (await res.json()) as {
		entities?: Array<{ _id?: string; _parent?: Array<{ reference?: string; entity_type?: string }> }>;
		count?: number;
	};
	const entities = body.entities ?? [];
	// `count` is the FULL match count regardless of `limit` (entu-api
	// routes/[db]/entity/index.get.js:659) — the same field createSection's
	// multi-org guard reads. More than one active membership in one db means the
	// collective is genuinely ambiguous; never pick the first.
	const count = body.count ?? entities.length;
	if (count > 1) {
		throw new MyOrgLookupError(
			`resolveMyOrgId: person ${personId} has ${count} active member rows in db '${cfg.db}' — cannot tell which collective is meant`,
			{ reason: 'ambiguous' }
		);
	}
	const member = entities[0];
	if (!member) return null;
	return (member._parent ?? []).find((p) => p.entity_type === 'organization')?.reference ?? null;
}

// (*MVOX:Palestrina*)
