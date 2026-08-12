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
import { MyOrgLookupError, resolveMyOrgId } from '$lib/org/myOrg';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

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
 */
export async function resolvePersonParentId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=database&limit=1',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) {
		// An HTTP/network failure is NEVER presented as "not admin" — it gets its own
		// reason so the UI can render it as a retryable load error.
		throw new InviteCreateError(
			`resolving the person parent failed: HTTP ${res.status} reading the database entity`,
			{ phase: 'person-parent-resolve', reason: 'http' }
		);
	}
	const body = (await res.json()) as {
		entities?: Array<{ _id?: string }>;
	};
	const entity = body.entities?.[0];
	if (!entity) {
		throw new InviteCreateError(
			'no database entity is readable — creating invites requires rights on the database entity that this account does not appear to have',
			{ phase: 'person-parent-resolve', reason: 'not-visible' }
		);
	}
	// The parent IS the database entity's own _id. A 2xx that read back an entity
	// without an _id is a contract violation (apparent-success trap) — fail loud
	// rather than POST a person with an empty `_parent`.
	if (!entity._id) {
		throw new InviteCreateError(
			'the database entity read back without an _id — cannot resolve the person parent',
			{ phase: 'person-parent-resolve', reason: 'contract' }
		);
	}
	return entity._id;
}

/**
 * Resolve the invite target org: the organization entity the new member gets
 * created under — the ACTING ADMIN'S OWN collective, read off her own active
 * `member` row's `_parent` (`resolveMyOrgId`, $lib/org/myOrg). No guessing.
 *
 * #67 (Mihkel ruling, 2026-08-08) stands as far as the UI goes: the invite
 * picker enumerates DATABASES, never organization entities — this is a single
 * internal resolve, not a user-facing list.
 *
 * TU.1/#109 review — what CHANGED, and why: this used to resolve
 * `entity?_type.string=organization&limit=1` and take the first hit, on the
 * premise that polyphony's extra org entities are ghosts nobody can read. That
 * premise is DISPROVEN (probe-67, 2026-08-12): the search answers `count: 6`,
 * all six org entities are `_sharing: domain` (so every authenticated member
 * reads all six), and the first hit is "Eesti Kammerkooride Liit"
 * (69c7f8718489bfcb0e81b05a) — the UMBRELLA FEDERATION — not the collective
 * "Eesti Filharmoonia Kammerkoor" (69c7f8718489bfcb0e81b065). Every member
 * created through /admin/invite was therefore parented under the umbrella, and
 * that wrong org then threads onward: the roster derives `RosterRow.orgId` from
 * the member's organization `_parent` and hands it to `createSection`, so the
 * bad parent would come straight back as a section under the umbrella. The
 * `limit=1` shape is retired here (and in `adminStore.resolveAdmin`); the one
 * remaining instance, `createSection`'s no-orgId fallback, now fails loud when
 * `count` > 1.
 *
 * Disposal of the legacy org entities stays on #37 — out of scope here.
 */
export async function resolveOrgId(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	if (!personId) {
		throw new InviteCreateError('resolveOrgId: personId must not be empty', {
			phase: 'org-resolve',
			reason: 'contract'
		});
	}
	let orgId: string | null;
	try {
		orgId = await resolveMyOrgId(cfg, personId, fetchImpl);
	} catch (e) {
		if (e instanceof MyOrgLookupError) {
			// 'http' keeps the retryable-load-error shape the page already renders;
			// an ambiguous membership is a contract problem, never "not admin".
			throw new InviteCreateError(`resolving the invite org failed: ${e.message}`, {
				phase: 'org-resolve',
				reason: e.reason === 'http' ? 'http' : 'contract'
			});
		}
		throw e; // e.g. AuthExpiredError — must reach the page's 401 branch untouched
	}
	if (!orgId) {
		throw new InviteCreateError(
			`no organization parent is readable for person ${personId} in db '${cfg.db}' — inviting requires an active membership whose organization parent this account can see`,
			{ phase: 'org-resolve', reason: 'not-visible' }
		);
	}
	return orgId;
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
	// name/email props: those prop-defs were deleted in T4.3. Explicit `_sharing`
	// (omission would silently copy the parent tier, utils/entity.js:296-327) and
	// explicit `_inheritrights` — no hidden defaults.
	const personProps: Prop[] = [
		{ type: '_type', reference: personTypeId },
		{ type: '_parent', reference: personParentId },
		{ type: 'entu_user', string: INVITE_MINT_TRIGGER },
		{ type: '_sharing', string: 'domain' },
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
	// findMyMemberId filters on (rsvpData.ts). `_sharing:'domain'` (#36): the
	// member→domain ruling unbreaks the roster query (#18/T3.2), which under
	// `private` returned only the invitee's own membership; domain sharing also
	// covers her own read, so the slice3-era explicit `_viewer` grant is retired.
	// NO `name` property (#36) — the member carries no name; that lives on a
	// separate per-visibility-level entity now (T4.3/T4.8).
	const memberProps: Prop[] = [
		{ type: '_type', reference: memberTypeId },
		{ type: '_parent', reference: input.orgId },
		{ type: 'person', reference: personId },
		{ type: 'status', string: 'active' },
		{ type: '_sharing', string: 'domain' },
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

