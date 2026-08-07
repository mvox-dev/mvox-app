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

// ── T4.6/#26 — profile EDIT surface (lazy create per visibility level + re-edit).
// These siblings live in this file ON PURPOSE: `createOwnProfile` is a thin wrapper
// over `createProfile` so the `_inheritrights` literal stays confined to this
// already-allowlisted file (soleCreatePath.spec.ts) — callers (the dispatcher) call
// `createOwnProfile` and never name the literal. The read/update helpers touch only
// `name`/`email`/`_sharing`-read and NEVER create an entity, so consolidating them
// here does not widen the guarded surface.

/** The three visibility levels — one `profile` entity per level (its own `_sharing`). */
export type Level = 'public' | 'domain' | 'private';

/** A profile entity as read back for the edit UI (projection of name/email/_sharing). */
export interface MyProfile {
	_id: string;
	name: string;
	email: string;
	_sharing: Level;
}

/**
 * Member self-create — she becomes the `_owner` (Entu auto-adds the caller;
 * `entu-api utils/entity.js:401-406`), so NO `ownerIds` is sent. Funnels through
 * `createProfile` with `_inheritrights:false` + the chosen level's `_sharing`,
 * confining the `_inheritrights` literal to this allowlisted file. Returns the new
 * profile `_id`; fails loud (inherits `createProfile`'s non-2xx + 2xx-no-`_id` throws).
 */
export async function createOwnProfile(
	cfg: EntuCfg,
	personId: string,
	level: Level,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	// Funnel through createProfile — the sole allowed create path — with NO ownerIds
	// (member self-create: Entu adds the caller as _owner itself). This confines the
	// `_inheritrights` literal to this already-allowlisted file (soleCreatePath.spec.ts).
	return createProfile(cfg, { personId, _inheritrights: false, _sharing: level }, fetchImpl);
}

const LEVELS: readonly Level[] = ['public', 'domain', 'private'];

function isLevel(value: string): value is Level {
	return (LEVELS as readonly string[]).includes(value);
}

/**
 * Read the member's up-to-three profile entities (children of her person). Projects
 * only `name,email,_sharing` (underscore — a bare `sharing` projection silently
 * returns empty, `entu-api utils/entity.js:198`). An explicit `limit` is mandatory
 * (every codebase query sets one). Fails loud on non-2xx; an unknown `_sharing`
 * value throws rather than being silently dropped.
 */
export async function listMyProfiles(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MyProfile[]> {
	// Profiles are children of the member's person (`_parent` = personId), mirroring
	// listMyRsvps' native own-person scoping. Project `_sharing` (underscore) — a bare
	// `sharing` projection silently returns empty (entu-api utils/entity.js:198). A
	// member has up to three profile entities; limit=10 is an explicit, ample bound.
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=profile&_parent.reference=${encodeURIComponent(personId)}&props=name,email,_sharing&limit=10`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listMyProfiles failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			email?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
		}>;
	};
	return (body.entities ?? []).map((raw) => {
		const sharing = raw._sharing?.[0]?.string ?? '';
		// Fail loud — an unknown _sharing is a data anomaly, never silently dropped or
		// coerced to a default level (the standing fail-loud rule; a fallback here would
		// hide the defect).
		if (!isLevel(sharing)) {
			throw new Error(
				`listMyProfiles: profile ${raw._id} carries an unknown _sharing value ${JSON.stringify(sharing)}`
			);
		}
		return {
			_id: raw._id,
			name: raw.name?.[0]?.string ?? '',
			email: raw.email?.[0]?.string ?? '',
			_sharing: sharing
		};
	});
}

/**
 * Pure — index profiles by level. A level with no entity is ABSENT from the map.
 * The anomalous duplicate-level case (should not occur pre-T4.7) is last-wins.
 */
export function profilesByLevel(ps: MyProfile[]): Partial<Record<Level, MyProfile>> {
	const by: Partial<Record<Level, MyProfile>> = {};
	for (const p of ps) {
		if (by[p._sharing]) {
			// Should not occur pre-T4.7 (one entity per level). Last-wins, but warn —
			// a silent overwrite would hide the anomaly.
			console.warn(`profilesByLevel: duplicate profile for level ${p._sharing} — last wins`);
		}
		by[p._sharing] = p;
	}
	return by;
}

// ── T4.7/#27 — narrower-wins READ resolver (AC2). Pure sibling of `profilesByLevel`,
// living beside the `Level`/`MyProfile` types + the rights ordering it ranks. Touches
// NO create surface (no `_inheritrights`, no `resolveTypeId(...,'profile')`), so it does
// not widen the sole-create-path guard's scope.

/**
 * The narrower-wins ordering (AC2). `private` is NARROWER than `domain` is NARROWER
 * than `public` — source-grounded in entu-api `cleanupEntity`'s reader-tier branch
 * order + the `_sharing`-literal push in `getAccessArray` (RECON A §1): the reader-set
 * inclusion is explicit-grant(private) ⊂ any-in-db-member(domain) ⊂ anyone(public). A
 * LOWER number = more restrictive = the safe render (fails toward privacy).
 */
export const NARROWNESS: Record<Level, number> = { private: 0, domain: 1, public: 2 };

/** The narrower-wins resolution of ONE field across the member's profile entities. */
export interface FieldResolution {
	/** The rendered value — the NARROWEST non-empty holder's value ('' when none holds it). */
	value: string;
	/**
	 * Every entity holding a non-empty value for the field, ordered narrow→wide.
	 * `holders.length > 1` is an interrupted-move DUPLICATE (AC3) — RETURNED, never
	 * collapsed: a silent collapse would HIDE the inconsistency (forbidden by the
	 * standing fail-loud rule; narrower-wins is a client render, NOT an Entu boundary,
	 * RECON A §2 / Flag 3).
	 */
	holders: { level: Level; id: string }[];
}

/**
 * Pure — resolve one field (`name`|`email`) across the member's up-to-three profile
 * entities by the narrower-wins rule (AC2): the rendered value comes from the entity
 * whose `_sharing` is most restrictive. RETURNS every non-empty holder ordered
 * narrow→wide (via `NARROWNESS`) so the caller can DETECT a duplicate — this is NOT
 * `profilesByLevel`'s last-wins (a different anomaly: same-level dupes, not a
 * cross-level field duplicate).
 */
export function resolveField(ps: MyProfile[], field: 'name' | 'email'): FieldResolution {
	// Only entities that actually HOLD a non-empty value are holders — an empty field
	// is not a duplicate. Order narrow→wide by NARROWNESS so `holders[0]` is the safest
	// (narrowest) render and any `holders.length > 1` is an interrupted-move duplicate.
	const withValue = ps
		.filter((p) => p[field] !== '')
		.slice()
		.sort((a, b) => NARROWNESS[a._sharing] - NARROWNESS[b._sharing]);
	return {
		value: withValue.length > 0 ? withValue[0][field] : '',
		holders: withValue.map((p) => ({ level: p._sharing, id: p._id }))
	};
}

/**
 * Replace `name`/`email` on an EXISTING profile entity. NEVER creates; never sends
 * `_type`/`_parent`/`_inheritrights`/`_sharing`. Because `POST entity/{id}` only
 * ADDS (never replaces), this mirrors `updateRsvpStatus` (rsvpData.ts:148-213): GET
 * the current value-ids → DELETE each stale name/email value → POST the new value.
 * A field whose value is '' is omitted from the POST; both empty → no POST issued.
 * On a FRESH shell (first-save create path) the GET returns no values → the DELETE
 * step is a no-op → step 3 is a pure add. Fails loud on any non-2xx.
 */
export async function saveProfileFields(
	cfg: EntuCfg,
	profileId: string,
	fields: { name: string; email: string },
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	// 1) GET the current name/email value-ids. POST entity/{id} only ADDS (never
	//    replaces), so a real value CHANGE is delete-then-add (the updateRsvpStatus
	//    pattern). On a fresh shell the GET returns no values → the DELETE step no-ops.
	const getRes = await entuFetch(
		cfg.db,
		`entity/${profileId}?props=name,email`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!getRes.ok) throw new Error(`saveProfileFields lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as {
		entity?: {
			name?: Array<{ _id: string }>;
			email?: Array<{ _id: string }>;
		};
	};
	const entity = body.entity ?? {};

	// 2) DELETE each stale name/email value.
	const toDelete = [...(entity.name ?? []), ...(entity.email ?? [])];
	for (const value of toDelete) {
		const delRes = await entuFetch(
			cfg.db,
			`property/${value._id}`,
			cfg.token,
			{ method: 'DELETE' },
			fetchImpl
		);
		if (!delRes.ok) throw new Error(`saveProfileFields delete failed: ${delRes.status}`);
	}

	// 3) POST the new values — a field whose value is '' is omitted (never write an
	//    empty string). Both empty → nothing to add, skip the POST entirely. Only
	//    name/email are ever sent — NEVER _type/_parent/_inheritrights/_sharing (this
	//    edits fields; it does not create an entity, keeping it out of the
	//    sole-create-path guard's scope).
	const props: Array<{ type: string; string: string }> = [];
	if (fields.name !== '') props.push({ type: 'name', string: fields.name });
	if (fields.email !== '') props.push({ type: 'email', string: fields.email });
	if (props.length === 0) return;

	const postRes = await entuFetch(
		cfg.db,
		`entity/${profileId}`,
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`saveProfileFields save failed: ${postRes.status}`);
}

// (*MVOX:Tallis* — interface + guards spec)
// (*MVOX:Josquin* — GREEN implementation)
