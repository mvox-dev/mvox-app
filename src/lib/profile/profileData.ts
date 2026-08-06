import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

// T4.4/#25 — the SOLE code path allowed to create a `profile` entity (epic #21;
// design doc `docs/design/2026-08-06-T4.3-profile-type-and-person-reduction.md`).
// The one-profile-type ruling (T4.3) removed the type-level `_sharing` cap that
// would otherwise catch a mistake — the entity's OWN `_sharing` is the only
// remaining enforcement point (design doc §1). A create call that forgets to set
// `_inheritrights:false` or an explicit `_sharing` must not be WRITABLE: both
// fields are REQUIRED on `CreateProfileInput` (never optional, never defaulted),
// and `_inheritrights` is typed as the literal `false` — not `boolean` — so a call
// passing `true` is also a type error, not merely an omission. See
// `src/lib/profile/profileData.spec.ts` for the `@ts-expect-error` proofs (gated
// by `pnpm check`) and the runtime defense-in-depth for callers who bypass TS.
//
// Extends the half-precedent `createRsvp` (`src/lib/rsvp/rsvpData.ts:111-139`),
// which sets an explicit `_sharing` but no `_inheritrights`.

export interface CreateProfileInput {
	/** The person this profile is created under (`_parent`). */
	personId: string;
	/**
	 * MUST be the literal `false`. Person→Profile rights never propagate
	 * automatically once this is set — every grant is explicit (this field plus
	 * `ownerIds`). There is no valid `true` value for a profile create.
	 */
	_inheritrights: false;
	/** No default exists — every create states its own visibility explicitly. */
	_sharing: 'public' | 'domain' | 'private';
	/**
	 * Additional explicit `_owner` grants, beyond the creating identity (Entu
	 * itself always adds the caller as `_owner` on create — entu-api
	 * `utils/entity.js:404-410` — independent of `_inheritrights`). Needed for the
	 * admin-created path (T4.10 migration), which runs as db-root: the member
	 * herself gets nothing without an explicit grant here, since
	 * `_inheritrights:false` blocks any rights inherited from the person parent. A
	 * member self-create (T4.6) is already the creator and needs no grant — omit.
	 */
	ownerIds?: string[];
}

/**
 * Create a `profile` entity. This is the ONLY function permitted to do so — see
 * `src/lib/profile/soleCreatePath.spec.ts` for the structural guard that enforces
 * it against every other file in `src/`.
 *
 * Resolves the `profile` type id, then POSTs the entity with `_parent` (the
 * person), the non-defaulted `_inheritrights:false` + explicit `_sharing`, and one
 * `_owner` per `ownerIds` entry (none when absent — Entu adds the caller as
 * `_owner` itself, `entu-api utils/entity.js:404-410`). Fails loudly (epic #21): a
 * non-2xx response OR a 2xx body with no `_id` (the apparent-success trap) throws
 * rather than surfacing as a completed create.
 */
export async function createProfile(
	cfg: EntuCfg,
	input: CreateProfileInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	// Runtime defense-in-depth behind the non-omittable TS signature, for callers
	// who bypass the type system (`as any`, JSON-reconstructed data, a `.js` caller):
	// stop BEFORE any write, with a message naming the violated field. The design
	// doc (§1) explains why this is load-bearing — the one-profile-type ruling
	// removed the type-level `_sharing` cap, so the entity's own fields are the only
	// enforcement point.
	if (input._inheritrights !== false) {
		throw new Error(
			`createProfile: _inheritrights must be exactly false (got ${JSON.stringify(input._inheritrights)})`
		);
	}
	if (input._sharing !== 'public' && input._sharing !== 'domain' && input._sharing !== 'private') {
		throw new Error(
			`createProfile: _sharing must be one of public|domain|private (got ${JSON.stringify(input._sharing)})`
		);
	}

	const profileTypeId = await resolveTypeId(cfg, 'profile', fetchImpl);

	const props: Array<{ type: string; reference?: string; string?: string; boolean?: boolean }> = [
		{ type: '_type', reference: profileTypeId },
		{ type: '_parent', reference: input.personId },
		{ type: '_inheritrights', boolean: false },
		{ type: '_sharing', string: input._sharing },
		// One explicit _owner per id — the admin-created path (T4.10, runs as db-root)
		// needs it or the member gets nothing under `_inheritrights:false`. A member
		// self-create (T4.6) omits `ownerIds`: the creator IS the owner via Entu.
		...(input.ownerIds ?? []).map((id) => ({ type: '_owner', reference: id }))
	];

	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createProfile failed: ${res.status}`);

	const body = (await res.json()) as { _id?: string };
	if (!body._id) {
		throw new Error('createProfile: create response carried no _id (apparent-success trap)');
	}
	return body._id;
}

// (*MVOX:Tallis* — interface + guards spec)
// (*MVOX:Josquin* — GREEN implementation)
