// T4.5 (#31), #34 — the SOLE Entu write path of the invite mechanism: admin creates
// the person (a fixed trigger constant in the entu_user prop → the server mints the
// invite JWT and deletes the string, entu-api utils/entity.js:462-468; the invitee's
// real email is never sent to Entu), grants the person self-`_editor` (parity with
// native auto-create, routes/auth/index.get.js createUserForAccount tail), then
// creates the member entity.
//
// Structurally enforced sole path: `entu_user` is the create-payload literal only
// this file may contain (see singleInviteMechanism.spec.ts). This module creates
// person + member entities ONLY — nothing else (YELLOW-T4.4.1 guard asserts that
// structurally in soleCreatePath.spec.ts).
//
// FAIL-LOUD contract (same bar as the T4.4 sole create path): input guards before any fetch;
// every HTTP failure throws with its phase; a 2xx without `_id` is an
// apparent-success trap and throws; partial failures NAME the orphaned person id
// and are never auto-rolled-back (a compensating delete can itself fail and would
// mask the true state). The invite token is a bearer secret — it is returned to
// the caller exactly once and never logged or persisted here.

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId, DatabaseEntityLookupError } from '$lib/collective/databaseEntity';

// #34 — the person-create `entu_user` property carries this fixed mint-trigger
// literal, NEVER the invitee's real email. Any truthy string makes the server
// mint an identical invite JWT (entu-api utils/entity.js:462-467), so the
// invitee's email is never sent to Entu.
export const INVITE_MINT_TRIGGER = 'trigger invite token';

export type InviteCreatePhase =
	| 'type-resolve'
	| 'person-parent-resolve'
	| 'org-resolve'
	| 'person-create'
	| 'invite-mint'
	| 'editor-grant'
	| 'member-create';

export type InviteCreateReason = 'not-visible' | 'http' | 'contract';

export class InviteCreateError extends Error {
	readonly phase: InviteCreatePhase;
	readonly reason: InviteCreateReason;
	/** Set from the 'invite-mint' phase onward — the already-created person entity. */
	readonly personId?: string;

	constructor(
		message: string,
		opts: { phase: InviteCreatePhase; reason: InviteCreateReason; personId?: string }
	) {
		super(message);
		this.name = 'InviteCreateError';
		this.phase = opts.phase;
		this.reason = opts.reason;
		this.personId = opts.personId;
	}
}

export interface CreateInviteInput {
	orgId: string;
}

export interface CreateInviteResult {
	personId: string;
	memberId: string;
	inviteToken: string;
}

/**
 * Resolve the parent for admin-created persons: the database entity's OWN `_id`.
 * entu-api sets a person's `_parent` to the database entity id at bootstrap
 * (setupDatabase.js:183-191); for polyphony that id equals the `add_user` value
 * that #22 deleted, so this is the SAME parent without depending on `add_user`.
 * `add_user` is never read — a future restored add_user field can never re-arm the
 * #22 public-auto-provision exposure through this path. No hardcoded ids.
 *
 * #161 review fix round 2 — this used to run its OWN
 * `entity?_type.string=database&limit=1` query, duplicating exactly the query
 * `resolveDatabaseEntityId` ($lib/collective/databaseEntity) already owns.
 * Delegates there now — same answer, `props=_id` for free, one lookup
 * implementation instead of two that could drift apart.
 */
export async function resolvePersonParentId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	let dbEntityId: string | null;
	try {
		dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
	} catch (e) {
		if (e instanceof DatabaseEntityLookupError) {
			// An HTTP/network failure is NEVER presented as "not admin" — it gets its
			// own reason so the UI can render it as a retryable load error.
			throw new InviteCreateError(
				`resolving the person parent failed: ${e.message}`,
				{ phase: 'person-parent-resolve', reason: 'http' }
			);
		}
		throw e; // e.g. AuthExpiredError — must reach the page's 401 branch untouched
	}
	if (!dbEntityId) {
		throw new InviteCreateError(
			'no database entity is readable — creating invites requires rights on the database entity that this account does not appear to have',
			{ phase: 'person-parent-resolve', reason: 'not-visible' }
		);
	}
	return dbEntityId;
}

/**
 * Resolve the invite target collective: the DATABASE entity the new member
 * gets created under (#161, collective = database, Mihkel ruling 2026-08-16).
 * No guessing — `resolveDatabaseEntityId` ($lib/collective/databaseEntity)
 * reads `entity?_type.string=database&limit=1`, exactly one per db.
 *
 * #67 (Mihkel ruling, 2026-08-08) stands as far as the UI goes: the invite
 * picker enumerates DATABASES, never organization entities — this is a single
 * internal resolve, not a user-facing list.
 *
 * #161 review fix round 2 — the dead `personId` parameter is DELETED from the
 * call contract (not merely renamed/shadowed): `resolveOrgId(cfg, fetchImpl?)`,
 * `.length === 1`, pinned in inviteData.spec.ts. The retired person -> active
 * member row -> organization `_parent` walk is gone — #159 deleted every
 * organization instance, so that chain could only ever answer wrong or empty.
 */
export async function resolveOrgId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	let dbEntityId: string | null;
	try {
		dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
	} catch (e) {
		if (e instanceof DatabaseEntityLookupError) {
			// 'http' keeps the retryable-load-error shape the page already renders.
			throw new InviteCreateError(`resolving the invite collective failed: ${e.message}`, {
				phase: 'org-resolve',
				reason: 'http'
			});
		}
		throw e; // e.g. AuthExpiredError — must reach the page's 401 branch untouched
	}
	if (!dbEntityId) {
		throw new InviteCreateError(
			`no database entity is readable in db '${cfg.db}' — inviting requires visibility into the collective`,
			{ phase: 'org-resolve', reason: 'not-visible' }
		);
	}
	return dbEntityId;
}

/**
 * The invite create sequence: person create (server mints the invite JWT into the
 * create response — the ONLY moment it is readable; every later entity GET masks
 * it as '***', entu-api utils/entity.js:594-598) → self-`_editor` grant → member
 * create. All reads precede all writes.
 */
export async function createInvite(
	cfg: EntuCfg,
	input: CreateInviteInput,
	fetchImpl: typeof fetch = fetch
): Promise<CreateInviteResult> {
	// Input guards BEFORE any fetch, each naming the offending field.
	if (!input.orgId) {
		throw new Error('createInvite: orgId must not be empty');
	}

	// ── All reads precede all writes ─────────────────────────────────────────────
	let personTypeId: string;
	let memberTypeId: string;
	try {
		personTypeId = await resolveTypeId(cfg, 'person', fetchImpl);
		memberTypeId = await resolveTypeId(cfg, 'member', fetchImpl);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		throw new InviteCreateError(`type resolution failed: ${message}`, {
			phase: 'type-resolve',
			reason: /failed: \d+/.test(message) ? 'http' : 'not-visible'
		});
	}
	const personParentId = await resolvePersonParentId(cfg, fetchImpl); // throws its own phased error

	type Prop = { type: string; reference?: string; string?: string; boolean?: boolean };

	// ── 1. Person create — the server mints the invite JWT from any truthy
	// entu_user string and deletes the string (entu-api utils/entity.js:462-467),
	// so a fixed trigger constant is sent, never the invitee's email (#34). No
	// name/email props: those prop-defs were deleted in T4.3. explicit `_inheritrights`
	// kept — no hidden default. NO explicit `_sharing` (#133 audit): the parent here
	// is the database ROOT entity (never the organization), which the #133 audit
	// found already carries a non-private tier, so Entu's create-time copy
	// (utils/entity.js:296-327) lands `domain` here without resending it.
	const personProps: Prop[] = [
		{ type: '_type', reference: personTypeId },
		{ type: '_parent', reference: personParentId },
		{ type: 'entu_user', string: INVITE_MINT_TRIGGER },
		{ type: '_inheritrights', boolean: true }
	];
	const personRes = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(personProps)
		},
		fetchImpl
	);
	if (!personRes.ok) {
		// An HTTP 400 'User not in parent _owner, _editor nor _expander property'
		// here IS the authoritative admin gate — Entu's parent-expander check
		// (utils/entity.js:256-261) refused this account. (A 403 on entity POST is
		// 'No user' — routes/[db]/entity/index.post.js:102-107 — NOT the admin gate.)
		throw new InviteCreateError(`person create failed: HTTP ${personRes.status}`, {
			phase: 'person-create',
			reason: 'http'
		});
	}
	const personBody = (await personRes.json()) as {
		_id?: string;
		properties?: Array<{ type?: string; invite?: string }>;
	};
	if (!personBody._id) {
		throw new InviteCreateError(
			'person create returned 2xx without _id (apparent-success trap) — never treated as a completed create',
			{ phase: 'person-create', reason: 'contract' }
		);
	}
	const personId = personBody._id;

	// ── 2. Invite extraction — the create response is the ONLY guaranteed read of
	// the token (every later entity GET masks it as '***', utils/entity.js:594-598).
	const inviteToken = (personBody.properties ?? []).find(
		(p) => p.type === 'entu_user' && typeof p.invite === 'string' && p.invite.length > 0
	)?.invite;
	if (!inviteToken) {
		throw new InviteCreateError(
			`person ${personId} was created but the create response carried no invite token — API contract drift; do not retry blindly, inspect the person entity`,
			{ phase: 'invite-mint', reason: 'contract', personId }
		);
	}

	// ── 3. Self-`_editor` grant — parity with entu-api's native auto-create tail
	// (routes/auth/index.get.js createUserForAccount); load-bearing for T4.6 lazy
	// creates (the person must be in her own `_expander` closure).
	const grantRes = await entuFetch(
		cfg.db,
		`entity/${personId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_editor', reference: personId }])
		},
		fetchImpl
	);
	if (!grantRes.ok) {
		throw new InviteCreateError(
			`self-_editor grant on person ${personId} failed: HTTP ${grantRes.status} — the person exists WITHOUT self-edit rights; repair in Entu before sending any link`,
			{ phase: 'editor-grant', reason: 'http', personId }
		);
	}

	// ── 4. Member create — `person` ref + `status:'active'` are what
	// findMyMemberId filters on (rsvpData.ts). The #36 member→domain ruling
	// unbreaks the roster query (#18/T3.2), which under `private` returned only
	// the invitee's own membership; domain sharing also covers her own read, so
	// the slice3-era explicit `_viewer` grant is retired. NO explicit `_sharing`
	// (#133): the direct parent is the database entity (#161, collective =
	// database), which carries `domain` + `_inheritrights:true`, so Entu's
	// create-time copy (utils/entity.js:296-327)
	// already lands `domain` on the member without resending it. `_inheritrights`
	// IS still sent explicitly here (kept per #133 audit). NO `name` property
	// (#36) — the member carries no name; that lives on a separate
	// per-visibility-level entity now (T4.3/T4.8).
	const memberProps: Prop[] = [
		{ type: '_type', reference: memberTypeId },
		{ type: '_parent', reference: input.orgId },
		{ type: 'person', reference: personId },
		{ type: 'status', string: 'active' },
		{ type: '_inheritrights', boolean: true }
	];
	const memberRes = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(memberProps)
		},
		fetchImpl
	);
	// NO compensating delete on failure — a rollback can itself fail and would mask
	// the true state; the error NAMES the orphaned person instead.
	if (!memberRes.ok) {
		throw new InviteCreateError(
			`member create failed: HTTP ${memberRes.status} — person ${personId} already exists and carries a live invite token; repair or remove it in Entu before retrying`,
			{ phase: 'member-create', reason: 'http', personId }
		);
	}
	const memberBody = (await memberRes.json()) as { _id?: string };
	if (!memberBody._id) {
		throw new InviteCreateError(
			`member create returned 2xx without _id (apparent-success trap) — person ${personId} already exists; inspect both in Entu before retrying`,
			{ phase: 'member-create', reason: 'contract', personId }
		);
	}

	return { personId, memberId: memberBody._id, inviteToken };
}

